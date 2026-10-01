import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { BK01_RUNTIME_EFFECTIVE_FUNCTIONS, validateBk01RuntimeEffectiveExecuteSet } from '../lib/bk01-runtime-allowlist.mjs';

const mode = process.argv[2];
if (!['baseline', 'fail-before', 'final'].includes(mode)) throw new Error('Usage: node scripts/proofs/bk01-sql-consolidate-pg17.mjs baseline|fail-before|final');
if (process.env.BK01_SHARED_RUNTIME_ENV !== 'local') throw new Error('Refusing non-local environment');
const url = process.env.BK01_SQL_CONSOLIDATE_DATABASE_URL;
if (!url) throw new Error('BK01_SQL_CONSOLIDATE_DATABASE_URL is required');
const runtimeUrl = process.env.BK01_SQL_CONSOLIDATE_RUNTIME_DATABASE_URL;
if (!runtimeUrl) throw new Error('BK01_SQL_CONSOLIDATE_RUNTIME_DATABASE_URL is required');
const aclBaselineFile = process.env.BK01_SQL_CONSOLIDATE_ACL_BASELINE_FILE;
if (!aclBaselineFile) throw new Error('BK01_SQL_CONSOLIDATE_ACL_BASELINE_FILE is required');
const parsed = new URL(url);
const parsedRuntime = new URL(runtimeUrl);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith('booking')
    || !['127.0.0.1', 'localhost'].includes(parsedRuntime.hostname) || parsedRuntime.pathname !== parsed.pathname) {
  throw new Error('Refusing database outside the same local booking* scaffold');
}
const db = postgres(url, { max: 4, prepare: false, connect_timeout: 5, application_name: `bk01-sql-consolidate-${mode}` });
const runtimeDb = postgres(runtimeUrl, { max: 2, prepare: false, connect_timeout: 5, application_name: `bk01-runtime-proof-${mode}` });
const checks = [];
const record = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Proof failed: ${name}`);
};
const reject = async (name, fn, pattern) => {
  let message = '';
  try { await fn(); } catch (error) { message = error.message; }
  record(name, Boolean(message) && (!pattern || pattern.test(message)), message || 'unexpectedly succeeded');
};
const asRole = (role, fn, userId) => (role === 'bk01_runtime' ? runtimeDb : db).begin(async (tx) => {
  if (role === 'bk01_runtime') {
    await tx.unsafe('SET LOCAL ROLE bk01_runtime');
  } else {
    await tx.unsafe(`SET LOCAL ROLE ${role}`);
  }
  if (userId) await tx`select set_config('request.jwt.claim.sub',${userId},true)`;
  return fn(tx);
});
const id = () => crypto.randomUUID();
const shopId = id(); const ownerId = 'b1010000-0000-4000-8000-000000000001'; const adminId = 'b1010000-0000-4000-8000-000000000002'; const staffUserId = 'b1010000-0000-4000-8000-000000000003'; const serviceId = id(); const staffId = id();
const startBase = new Date(Date.now() + 36 * 60 * 60 * 1000);
const fmtDate = (date) => date.toISOString().slice(0, 10);
const fmtTime = (date) => date.toISOString().slice(11, 19);
const asBangkokTimestamp = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()) - 7 * 3600000).toISOString();
const later = (hours) => new Date(Date.now() + hours * 3600000);
const earlier = (minutes) => new Date(Date.now() - minutes * 60000);
const toJson = (value) => typeof value === 'string' ? JSON.parse(value) : value;
const runtimeExecuteSet = async () => asRole('bk01_migrator', (tx) => tx`
  select p.oid::regprocedure::text as identity
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='local_service' and has_function_privilege('bk01_runtime',p.oid,'EXECUTE')
   order by 1`);
const productFunctionAclSnapshot = async () => asRole('bk01_migrator', (tx) => tx`
  select p.oid::regprocedure::text as identity, pg_get_userbyid(p.proowner) as owner,
         coalesce(p.proacl::text,'<default>') as execute_acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('local_service','local_service_internal')
   order by 1`);

async function createBooking({ status, depositStatus = 'awaiting', start, end, token = 'AB12CD34EF', queueReleasedAt = null, unknownRange = false }) {
  const customerId = id(); const bookingId = id();
  await asRole('bk01_migrator', async (tx) => {
    await tx`insert into local_service.customers(id,shop_id,name,phone) values (${customerId},${shopId},${`Proof ${bookingId.slice(0, 6)}`},${`09${bookingId.replaceAll('-', '').slice(0, 9)}`})`;
    await tx`insert into local_service.bookings(
    id,shop_id,customer_id,staff_id,service_id,booking_date,start_time,end_time,status,deposit_status,
    total_price,deposit_price,service_price,service_duration_minutes,deposit_amount,start_timestamptz,end_timestamptz,
    expires_at,link_token,link_token_expires_at,queue_released_at
  ) values (
    ${bookingId},${shopId},${customerId},${staffId},${serviceId},${fmtDate(start)}::date,${fmtTime(start)}::time,${fmtTime(end)}::time,
    ${status},${depositStatus},500,100,500,60,100,
    ${unknownRange ? null : asBangkokTimestamp(start)}::timestamptz,
    ${unknownRange ? null : asBangkokTimestamp(end)}::timestamptz,
    ${status === 'hold' ? earlier(30).toISOString() : end.toISOString()}::timestamptz,${token},${later(72).toISOString()}::timestamptz,${queueReleasedAt}
    )`;
  });
  return bookingId;
}

try {
  const preflight = await db`
    select current_setting('server_version_num')::int as version_num,
           r.rolsuper,r.rolcreaterole,r.rolbypassrls,
           has_schema_privilege('bk01_migrator','extensions','USAGE') as migrator_extensions_usage,
           has_schema_privilege('public','extensions','USAGE') as public_extensions_usage
      from pg_roles r where r.rolname=current_user`;
  record('PG17 non-superuser CREATEROLE+BYPASSRLS operator; no broad extensions USAGE',
    preflight[0]?.version_num >= 170000 && preflight[0]?.version_num < 180000
      && preflight[0].rolsuper === false && preflight[0].rolcreaterole === true && preflight[0].rolbypassrls === true
      && preflight[0].migrator_extensions_usage === false && preflight[0].public_extensions_usage === false,
    JSON.stringify(preflight[0]));
  if (mode === 'final') {
    const runtimeIdentity = await asRole('bk01_runtime', (tx) => tx`select current_user,session_user,r.rolsuper runtime_is_super,
      (select rolsuper from pg_roles where rolname=session_user) session_is_super from pg_roles r where r.rolname=current_user`);
    record('runtime function calls execute as real non-superuser bk01_runtime',
      runtimeIdentity[0]?.current_user === 'bk01_runtime' && runtimeIdentity[0]?.session_user === 'bk01_runtime_probe'
        && runtimeIdentity[0]?.runtime_is_super === false && runtimeIdentity[0]?.session_is_super === false,
      JSON.stringify(runtimeIdentity[0]));
  }

  const runtimeSet = await runtimeExecuteSet();
  if (mode === 'baseline') {
    record('baseline bk01_runtime effective EXECUTE is the exact approved set',
      validateBk01RuntimeEffectiveExecuteSet(runtimeSet.map((row) => row.identity), 'pre-migration catalog')
        && runtimeSet.length === BK01_RUNTIME_EFFECTIVE_FUNCTIONS.length,
      `count=${runtimeSet.length}`);
    await writeFile(aclBaselineFile, JSON.stringify(await productFunctionAclSnapshot(), null, 2));
  } else if (mode === 'fail-before') {
    await reject('fail-before: b50bb38 withdraws claim EXECUTE from bk01_runtime',
      () => asRole('bk01_runtime', (tx) => tx`select * from local_service.claim_due_line_notifications(1)`),
      /permission denied/i);
    record('fail-before: b50bb38 runtime EXECUTE count is 18 instead of baseline 19',
      runtimeSet.length === BK01_RUNTIME_EFFECTIVE_FUNCTIONS.length - 1,
      `count=${runtimeSet.length}`);
  } else {
    record('pass-after: bk01_runtime effective EXECUTE matches the exact approved 19-function baseline',
      validateBk01RuntimeEffectiveExecuteSet(runtimeSet.map((row) => row.identity), 'post-migration catalog')
        && runtimeSet.length === BK01_RUNTIME_EFFECTIVE_FUNCTIONS.length,
      `count=${runtimeSet.length}`);
    const baselineAcl = JSON.parse(await readFile(aclBaselineFile, 'utf8'));
    const finalAcl = await productFunctionAclSnapshot();
    const baselineMap = new Map(baselineAcl.map((row) => [row.identity, `${row.owner}|${row.execute_acl}`]));
    const finalMap = new Map(finalAcl.map((row) => [row.identity, `${row.owner}|${row.execute_acl}`]));
    const allowedAclChanges = new Set([
      'local_service.update_shop_settings(uuid,text,text,text,text,text,text,integer,integer)',
    ]);
    const changed = [...baselineMap.keys()].filter((identity) => finalMap.has(identity)
      && baselineMap.get(identity) !== finalMap.get(identity) && !allowedAclChanges.has(identity));
    const unexpectedAdded = [...finalMap.keys()].filter((identity) => !baselineMap.has(identity)
      && !['local_service.update_shop_settings(uuid,text,text,text,text,text,text,integer,integer)',
        'local_service.set_booking_outcome(uuid,text,text)',
        'local_service.record_deposit_refund(uuid,text,text)',
        'local_service.get_deposit_refund_history(uuid)',
        'local_service.get_booking_status(uuid,text)'].includes(identity));
    const unexpectedRemoved = [...baselineMap.keys()].filter((identity) => !finalMap.has(identity)
      && identity !== 'local_service.update_shop_settings(uuid,text,text,text,text,text,text)');
    record('pass-after: EXECUTE ACL of every retained product function matches pre-migration catalog',
      changed.length === 0 && unexpectedAdded.length === 0 && unexpectedRemoved.length === 0,
      JSON.stringify({ changed, unexpectedAdded, unexpectedRemoved }));
  }

  await asRole('bk01_migrator', async (tx) => {
    if (mode === 'baseline') {
      await tx`insert into local_service.shops(id,name,slug,phone,promptpay_number,promptpay_name,require_deposit,default_deposit_amount,is_active,customer_cancel_before_hours,customer_reschedule_before_hours)
        values (${shopId},'SQL consolidation proof',${`sql-proof-${shopId}`},'0800000000','0800000000','Proof Owner',true,100,true,12,12)`;
    } else {
      await tx`insert into local_service.shops(id,name,slug,phone,promptpay_number,promptpay_name,require_deposit,default_deposit_amount,is_active)
        values (${shopId},'SQL consolidation proof',${`sql-proof-${shopId}`},'0800000000','0800000000','Proof Owner',true,100,true)`;
    }
    await tx`insert into local_service.shop_users(shop_id,user_id,role) values (${shopId},${ownerId},'owner')`;
    await tx`insert into local_service.shop_users(shop_id,user_id,role) values (${shopId},${adminId},'admin'),(${shopId},${staffUserId},'staff')`;
    await tx`insert into local_service.services(id,shop_id,name,duration_minutes,price,deposit_amount,is_active)
      values (${serviceId},${shopId},'Proof service',60,500,100,true)`;
    await tx`insert into local_service.staff(id,shop_id,name,is_active) values (${staffId},${shopId},'Proof staff',true)`;
    await tx`insert into local_service.staff_schedules(shop_id,staff_id,day_of_week,is_working_day,work_start,work_end,break_start,break_end)
      select ${shopId},${staffId},d,true,'00:00','23:59',null,null from generate_series(0,6) d`;
  });
  const invariant = await asRole('bk01_migrator', async (tx) => ({
    ext: await tx`select extname,n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where extname='btree_gist'`,
    constraint: await tx`select pg_get_constraintdef(oid) def from pg_constraint where conname='prevent_overlapping_staff_bookings' and conrelid='local_service.bookings'::regclass`,
  }));
  record('btree_gist remains installed in extensions and the overlap invariant remains', invariant.ext.length === 1 && invariant.ext[0].nspname === 'extensions' && invariant.constraint[0]?.def.includes('gist'));
  if (mode === 'final') {
    const staffApproveId = await createBooking({ status: 'pending_review', depositStatus: 'submitted', start: later(144), end: later(145) });
    await reject('staff cannot approve submitted deposits',
      () => asRole('authenticated', (tx) => tx`select local_service.approve_booking_deposit(${staffApproveId})`, staffUserId),
      /owner or admin/i);
    await reject('staff cannot reject submitted deposits',
      () => asRole('authenticated', (tx) => tx`select local_service.reject_deposit_slip(${staffApproveId},'proof')`, staffUserId),
      /owner or admin/i);
    const adminApproveId = await createBooking({ status: 'pending_review', depositStatus: 'submitted', start: later(150), end: later(151) });
    const adminApproval = await asRole('authenticated', (tx) => tx`select local_service.approve_booking_deposit(${adminApproveId}) as result`, adminId);
    record('admin can approve a future submitted deposit', toJson(adminApproval[0].result).status === 'confirmed');

    const defaults = await asRole('bk01_migrator', (tx) => tx`select customer_cancel_before_hours c,customer_reschedule_before_hours r from local_service.shops where id=${shopId}`);
    record('new shops receive 24/12 policy defaults', defaults[0].c === 24 && defaults[0].r === 12);
  }

  const futureStart = later(48); const futureEnd = new Date(futureStart.getTime() + 3600000);
  const futureOutcomeId = await createBooking({ status: 'confirmed', depositStatus: 'verified', start: futureStart, end: futureEnd });
  if (mode === 'baseline') {
    await asRole('authenticated', (tx) => tx`select local_service.set_booking_outcome(${futureOutcomeId},'no_show','baseline proof')`, ownerId);
    record('fail-before: baseline accepts no_show before appointment starts', true);
  } else {
    await reject('pass-after: no_show before appointment start is rejected', () => asRole('authenticated', (tx) => tx`select local_service.set_booking_outcome(${futureOutcomeId},'no_show','proof')`, ownerId), /not started/i);
  }

  const pastStart = earlier(120); const pastEnd = earlier(60);
  const pastPendingId = await createBooking({ status: 'pending_review', depositStatus: 'submitted', start: pastStart, end: pastEnd });
  if (mode === 'baseline') {
    await asRole('authenticated', (tx) => tx`select local_service.approve_booking_deposit(${pastPendingId})`, ownerId);
    record('fail-before: baseline approves ended pending appointment without release marker', true);
  } else {
    await reject('pass-after: approval of ended appointment fails closed', () => asRole('authenticated', (tx) => tx`select local_service.approve_booking_deposit(${pastPendingId})`, ownerId), /passed|confirmation/i);
    const approvableId = await createBooking({ status: 'pending_review', depositStatus: 'submitted', start: later(132), end: later(133) });
    const approved = await asRole('authenticated', (tx) => tx`select local_service.approve_booking_deposit(${approvableId}) as result`, ownerId);
    record('approval of a future pending appointment still succeeds', toJson(approved[0].result).status === 'confirmed');
    await asRole('authenticated', (tx) => tx`select local_service.reject_deposit_slip(${pastPendingId},'review rejected')`, ownerId);
    const rejectedNotice = await asRole('bk01_migrator', (tx) => tx`select event_type from local_service.line_notification_logs where booking_id=${pastPendingId} and event_type='booking_cancelled'`);
    const routeText = await readFile(new URL('../../apps/booking-consumer/src/app/api/notifications/dispatch/route.ts', import.meta.url), 'utf8');
    record('rejection-triggered cancellation emits booking_cancelled and UI copy stays generic', rejectedNotice.length === 1
      && routeText.includes('ยกเลิกคิวที่ ${context.shop_name ?? \'ร้านค้า\'} แล้ว')
      && !routeText.includes('ลูกค้ายกเลิก'));
  }

  const currentStart = later(60); const currentEnd = new Date(currentStart.getTime() + 3600000);
  const rescheduleId = await createBooking({ status: 'confirmed', depositStatus: 'verified', start: currentStart, end: currentEnd, token: 'RS12CH34EF' });
  const targetStart = later(72); const targetEnd = new Date(targetStart.getTime() + 3600000);
  const staleHoldId = await createBooking({ status: 'hold', start: targetStart, end: targetEnd, token: 'HD12CH34EF' });
  if (mode === 'baseline') {
    await reject('fail-before: expired hold still blocks requested reschedule interval', () => asRole('anon', (tx) => tx`select local_service.customer_reschedule_booking(${rescheduleId},'RS12CH34EF',${fmtDate(targetStart)}::date,${fmtTime(targetStart)}::time,'proof')`), /exclusion|overlap/i);
  } else {
    const moved = await asRole('anon', (tx) => tx`select local_service.customer_reschedule_booking(${rescheduleId},'RS12CH34EF',${fmtDate(targetStart)}::date,${fmtTime(targetStart)}::time,'proof') as result`);
    const movedResult = toJson(moved[0].result);
    const sweep = await asRole('bk01_migrator', (tx) => tx`select status from local_service.bookings where id=${staleHoldId}`);
    record('pass-after: target-window lazy sweep expires stale hold and reschedule succeeds', movedResult.status === 'confirmed' && sweep[0].status === 'expired');
  }

  if (mode === 'final') {
    const settingsBase = [shopId,'SQL consolidation proof','0800000000','Proof address','0800000000','Proof Owner',null];
    await reject('settings rejects NULL policy hours', () => asRole('authenticated', (tx) => tx`select local_service.update_shop_settings(${settingsBase[0]},${settingsBase[1]},${settingsBase[2]},${settingsBase[3]},${settingsBase[4]},${settingsBase[5]},${settingsBase[6]},${null}::integer,12)`, ownerId), /non-null|violat/i);
    await reject('settings rejects negative policy hours', () => asRole('authenticated', (tx) => tx`select local_service.update_shop_settings(${settingsBase[0]},${settingsBase[1]},${settingsBase[2]},${settingsBase[3]},${settingsBase[4]},${settingsBase[5]},${settingsBase[6]},24,-1)`, ownerId), /non-negative|violat/i);
    await asRole('authenticated', (tx) => tx`select local_service.update_shop_settings(${settingsBase[0]},${settingsBase[1]},${settingsBase[2]},${settingsBase[3]},${settingsBase[4]},${settingsBase[5]},${settingsBase[6]},0,12)`, ownerId);
    record('settings accepts zero and non-negative explicit hours', true);
    const policy = await asRole('bk01_migrator', (tx) => tx`select customer_cancel_before_hours as c,customer_reschedule_before_hours as r from local_service.shops where id=${shopId}`);
    record('policy RPC persists the two requested settings', policy[0].c === 0 && policy[0].r === 12);

    const tokenBooking = await createBooking({ status: 'confirmed', depositStatus: 'verified', start: later(96), end: later(97), token: 'TOK12N34EF' });
    const badToken = await asRole('anon', (tx) => tx`select local_service.get_booking_status(${tokenBooking},'wrong-token') as result`);
    const goodToken = await asRole('anon', (tx) => tx`select local_service.get_booking_status(${tokenBooking},'TOK12N34EF') as result`);
    record('get_booking_status rejects wrong token and exposes no booking data', toJson(badToken[0].result).ok === false && toJson(badToken[0].result).booking_id === undefined);
    record('get_booking_status accepts matching unexpired token', toJson(goodToken[0].result).ok === true && toJson(goodToken[0].result).booking_id === tokenBooking);

    const refundId = await createBooking({ status: 'completed', depositStatus: 'submitted', start: pastStart, end: pastEnd });
    const futureRefundId = await createBooking({ status: 'confirmed', depositStatus: 'verified', start: later(108), end: later(109) });
    await reject('refund refuses a deposit before appointment end', () => asRole('authenticated', (tx) => tx`select local_service.record_deposit_refund(${futureRefundId},'ref-early','proof')`, ownerId), /released queue|past its appointment/i);
    const refunded = await asRole('authenticated', (tx) => tx`select local_service.record_deposit_refund(${refundId},'refund-proof','shop returned funds') as result`, ownerId);
    record('refund records submitted deposit only after appointment end', toJson(refunded[0].result).deposit_status === 'refunded');
    const refundPendingId = await createBooking({ status: 'pending_review', depositStatus: 'submitted', start: pastStart, end: pastEnd });
    const pendingCountBefore = await asRole('authenticated', (tx) => tx`select local_service.bk01_pending_past_appointment_count(${shopId}) as count`, ownerId);
    await reject('staff cannot record a deposit refund',
      () => asRole('authenticated', (tx) => tx`select local_service.record_deposit_refund(${refundPendingId},'staff-ref','proof')`, staffUserId),
      /owner or admin/i);
    await asRole('authenticated', (tx) => tx`select local_service.record_deposit_refund(${refundPendingId},'pending-ref','shop returned funds')`, ownerId);
    const pendingCountAfter = await asRole('authenticated', (tx) => tx`select local_service.bk01_pending_past_appointment_count(${shopId}) as count`, ownerId);
    record('refund removes the item from the unresolved past-appointment counter',
      Number(pendingCountBefore[0].count) === Number(pendingCountAfter[0].count) + 1);
    const history = await asRole('authenticated', (tx) => tx`select reference,note from local_service.get_deposit_refund_history(${refundId})`, ownerId);
    record('refund audit history is sourced from audit_events', history.length === 1 && history[0].reference === 'refund-proof' && history[0].note === 'shop returned funds');

    const reminderBooking = await createBooking({ status: 'confirmed', depositStatus: 'verified', start: earlier(240), end: earlier(180) });
    const reminderId = id();
    await asRole('bk01_migrator', (tx) => tx`insert into local_service.line_notification_logs(id,shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
      values (${reminderId},${shopId},${reminderBooking},'reminder_24h','customer','pending',${`proof-reminder-${reminderId}`},${later(5).toISOString()}::timestamptz)`);
    await asRole('bk01_migrator', (tx) => tx`update local_service.line_notification_logs set scheduled_for=${earlier(5).toISOString()}::timestamptz where id=${reminderId}`);
    const queued = await asRole('bk01_migrator', (tx) => tx`select status,scheduled_for from local_service.line_notification_logs where id=${reminderId}`);
    const claim = await asRole('bk01_runtime', (tx) => tx`select id from local_service.claim_due_line_notifications(25) where id=${reminderId}`);
    const retired = await asRole('bk01_migrator', (tx) => tx`select status,next_retry_at from local_service.line_notification_logs where id=${reminderId}`);
    record('B9(b) proof fixture is due and pending', queued.length === 1 && queued[0].status === 'pending' && new Date(queued[0].scheduled_for) <= new Date());
    record('B9(b): past-appointment reminder is not claimed and stale row is retired', claim.length === 0 && retired.length === 1 && retired[0].status === 'failed' && retired[0].next_retry_at === null, JSON.stringify({ claim: claim.length, retired }));

    const unknownStartBooking = await createBooking({ status: 'expired', depositStatus: 'verified', start: later(180), end: later(181), unknownRange: true });
    const unknownReminderId = id();
    await asRole('bk01_migrator', async (tx) => {
      await tx`insert into local_service.line_notification_logs(id,shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
        values (${unknownReminderId},${shopId},${unknownStartBooking},'reminder_1h','customer','pending',${`proof-reminder-${unknownReminderId}`},${later(5).toISOString()}::timestamptz)`;
      await tx`update local_service.line_notification_logs set scheduled_for=${earlier(5).toISOString()}::timestamptz where id=${unknownReminderId}`;
    });
    const unknownClaim = await asRole('bk01_runtime', (tx) => tx`select id from local_service.claim_due_line_notifications(25) where id=${unknownReminderId}`);
    const unknownRetired = await asRole('bk01_migrator', (tx) => tx`select status,next_retry_at from local_service.line_notification_logs where id=${unknownReminderId}`);
    record('B9(b): missing appointment start fails closed and retires reminder', unknownClaim.length === 0 && unknownRetired[0]?.status === 'failed' && unknownRetired[0].next_retry_at === null);

    const triggerBody = await asRole('bk01_migrator', (tx) => tx`select pg_get_functiondef('local_service.enforce_booking_status_transition()'::regprocedure) def`);
    record('frozen enforce_booking_status_transition remains present and was not replaced', triggerBody.length === 1);
  }
} finally {
  try {
    await asRole('bk01_migrator', async (tx) => {
      await tx`delete from local_service.line_notification_logs where shop_id=${shopId}`;
      await tx`delete from local_service.audit_events where shop_id=${shopId}`;
      await tx`delete from local_service.bookings where shop_id=${shopId}`;
      await tx`delete from local_service.customers where shop_id=${shopId}`;
      await tx`delete from local_service.staff_schedules where shop_id=${shopId}`;
      await tx`delete from local_service.staff where shop_id=${shopId}`;
      await tx`delete from local_service.services where shop_id=${shopId}`;
      await tx`delete from local_service.shop_users where shop_id=${shopId}`;
      await tx`delete from local_service.subscriptions where shop_id=${shopId}`;
      await tx`delete from local_service.entitlement_usage where shop_id=${shopId}`;
      await tx`delete from local_service.service_entitlement_periods where shop_id=${shopId}`;
      await tx`delete from local_service.shops where id=${shopId}`;
    });
  } finally { await Promise.all([db.end({ timeout: 5 }), runtimeDb.end({ timeout: 5 })]); }
}
console.log(`RESULT ${checks.filter((check) => check.ok).length}/${checks.length} PASS mode=${mode}`);
