import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { BK01_RUNTIME_EFFECTIVE_FUNCTIONS, validateBk01RuntimeEffectiveExecuteSet } from '../lib/bk01-runtime-allowlist.mjs';

const mode = process.argv[2];
if (!['baseline', 'fail-before', 'final'].includes(mode)) throw new Error('Usage: node scripts/proofs/bk01-pack-notify-group67-pg17.mjs baseline|fail-before|final');
if (process.env.BK01_SHARED_RUNTIME_ENV !== 'local') throw new Error('Refusing non-local environment');
const adminUrl = process.env.BK01_GROUP67_ADMIN_URL;
const operatorUrl = process.env.BK01_GROUP67_OPERATOR_URL;
const runtimeUrl = process.env.BK01_GROUP67_RUNTIME_URL;
const authenticatedUrl = process.env.BK01_GROUP67_AUTHENTICATED_URL;
const anonUrl = process.env.BK01_GROUP67_ANON_URL;
const proofDataDir = process.env.BK01_GROUP67_DATA_DIR?.replaceAll('\\', '/');
const snapshotPath = process.env.BK01_GROUP67_ACL_BASELINE_FILE;
if (![adminUrl, operatorUrl, runtimeUrl, authenticatedUrl, anonUrl, proofDataDir, snapshotPath].every(Boolean)) throw new Error('Local PG URLs, exact data directory, and ACL snapshot path are required');
const db = postgres(operatorUrl, { max: 2, prepare: false, connect_timeout: 5, application_name: `group67-proof-${mode}` });
const runtimeDb = postgres(runtimeUrl, { max: 2, prepare: false, connect_timeout: 5, application_name: `group67-runtime-${mode}` });
const authenticatedDb = postgres(authenticatedUrl, { max: 1, prepare: false, connect_timeout: 5, application_name: `group67-auth-${mode}` });
const anonDb = postgres(anonUrl, { max: 1, prepare: false, connect_timeout: 5, application_name: `group67-anon-${mode}` });
const adminDb = postgres(adminUrl, { max: 1, prepare: false, connect_timeout: 5, application_name: `group67-dir-guard` });
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`W-1 proof failed: ${name}`);
};
const guard = async () => {
  const rows = await adminDb`select current_setting('data_directory') as data_directory`;
  if (String(rows[0]?.data_directory).replaceAll('\\', '/') !== proofDataDir) throw new Error('PG17 data_directory does not match this task disposable cluster');
};
const asRole = (client, role, fn, claims) => client.begin(async (tx) => {
  await guard();
  await tx.unsafe(`SET LOCAL ROLE ${role}`);
  if (claims) await tx`select set_config('request.jwt.claims',${JSON.stringify(claims)},true)`;
  return fn(tx);
});
const snapshot = () => asRole(db, 'bk01_migrator', (tx) => tx`
  select p.oid::regprocedure::text as identity, pg_get_userbyid(p.proowner) as owner,
         coalesce(p.proacl::text,'<default>') as acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('local_service','local_service_internal') order by 1`);
const runtimeSet = () => asRole(db, 'bk01_migrator', (tx) => tx`
  select p.oid::regprocedure::text as identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='local_service' and has_function_privilege('bk01_runtime',p.oid,'EXECUTE') order by 1`);
const uid = () => crypto.randomUUID();
const shopId = uid();
const ownerId = '67010000-0000-4000-8000-000000000001';
const outsiderId = '67010000-0000-4000-8000-000000000002';
const customerId = uid();
const serviceId = uid();
const staffId = uid();
const bookingId = uid();
const futureStart = new Date(Date.now() + 4 * 60 * 60 * 1000);
const nearStart = new Date(Date.now() + 2 * 60 * 60 * 1000);
const ts = (d) => d.toISOString();
const bangkokParts = (d) => new Date(d.getTime() + 7 * 60 * 60 * 1000);
const date = (d) => bangkokParts(d).toISOString().slice(0, 10);
const time = (d) => bangkokParts(d).toISOString().slice(11, 19);
const bangkokStart = (d) => d.toISOString();

try {
  if (mode === 'final') {
    await guard();
    await db.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE bk01_migrator');
      await tx`delete from local_service.subscriptions where shop_id in (select id from local_service.shops where slug like 'group67-%')`;
      await tx`delete from local_service.shops where slug like 'group67-%'`;
    });
    await guard();
    await adminDb`delete from auth.users where id in (${ownerId},${outsiderId})`;
  }
  await guard();
  const posture = await db`select current_user as login, r.rolsuper, r.rolcreaterole, r.rolbypassrls,
      current_setting('server_version_num')::integer as version_num,
      has_schema_privilege('bk01_migrator','extensions','USAGE') as migrator_ext,
      has_schema_privilege('public','extensions','USAGE') as public_ext
    from pg_roles r where r.rolname=current_user`;
  record('W-1 is PG17 non-superuser operator with no extension USAGE relaxation',
    posture[0]?.version_num >= 170000 && posture[0]?.version_num < 180000
      && posture[0].login === 'operator' && !posture[0].rolsuper && posture[0].rolcreaterole && posture[0].rolbypassrls
      && !posture[0].migrator_ext && !posture[0].public_ext, JSON.stringify(posture[0]));
  const roleProof = await asRole(runtimeDb, 'bk01_runtime', (tx) => tx`select current_user,session_user,r.rolsuper from pg_roles r where r.rolname=current_user`);
  record('runtime proof executes under real non-superuser bk01_runtime', roleProof[0]?.current_user === 'bk01_runtime'
    && roleProof[0]?.session_user === 'bk01_runtime_probe' && roleProof[0]?.rolsuper === false, JSON.stringify(roleProof[0]));

  const functions = await runtimeSet();
  if (mode === 'baseline' || mode === 'fail-before') {
    const expected = BK01_RUNTIME_EFFECTIVE_FUNCTIONS.filter((identity) => identity !== 'local_service.claim_due_shop_email_notifications(integer)');
    record('fail-before effective EXECUTE is the exact 19-function pre-Group67 set',
      functions.length === 19 && JSON.stringify(functions.map((row) => row.identity)) === JSON.stringify(expected.slice().sort()),
      `count=${functions.length}`);
    if (mode === 'baseline') await writeFile(snapshotPath, JSON.stringify(await snapshot(), null, 2));
    const exists = await asRole(db, 'bk01_migrator', (tx) => tx`select to_regprocedure('local_service.claim_due_shop_email_notifications(integer)') is not null as exists`);
    record('fail-before email claim capability is absent', exists[0]?.exists === false);
    let error = '';
    await guard();
    await runtimeDb.unsafe('SET ROLE bk01_runtime');
    try { await runtimeDb`select * from local_service.claim_due_shop_email_notifications(1)`; }
    catch (cause) { error = String(cause.message); }
    await guard();
    await runtimeDb.unsafe('RESET ROLE');
    record('fail-before real bk01_runtime cannot call uninstalled email claim RPC', /does not exist|undefined function/i.test(error), error);
  } else {
    record('pass-after effective EXECUTE equals the exact 20-function allowlist',
      validateBk01RuntimeEffectiveExecuteSet(functions.map((row) => row.identity), 'post-Group67 catalog') && functions.length === 20,
      `count=${functions.length}`);
    const before = JSON.parse(await readFile(snapshotPath, 'utf8'));
    const after = await snapshot();
    const beforeMap = new Map(before.map((row) => [row.identity, `${row.owner}|${row.acl}`]));
    const afterMap = new Map(after.map((row) => [row.identity, `${row.owner}|${row.acl}`]));
    const changed = [...beforeMap.keys()].filter((identity) => afterMap.has(identity) && beforeMap.get(identity) !== afterMap.get(identity));
    const removed = [...beforeMap.keys()].filter((identity) => !afterMap.has(identity));
    const added = [...afterMap.keys()].filter((identity) => !beforeMap.has(identity)).sort();
    const expectedAdded = [
      'local_service.claim_due_shop_email_notifications(integer)',
      'local_service.enqueue_slip_notification_events()',
      'local_service.get_shop_notification_contact(uuid)',
      'local_service.set_shop_notification_contact(uuid)',
    ].sort();
    record('all pre-existing function owners and EXECUTE ACLs are unchanged', changed.length === 0 && removed.length === 0,
      JSON.stringify({ changed, removed }));
    record('new SQL function identities equal the four intended Group67 additions', JSON.stringify(added) === JSON.stringify(expectedAdded), JSON.stringify(added));
    const newRuntime = await asRole(runtimeDb, 'bk01_runtime', (tx) => tx`select * from local_service.claim_due_shop_email_notifications(1)`);
    record('pass-after real bk01_runtime can call email claim RPC', Array.isArray(newRuntime));

    const catalog = await asRole(db, 'bk01_migrator', (tx) => tx`
      select c.relrowsecurity, c.relforcerowsecurity,
        has_table_privilege('anon','local_service.shop_notification_contacts','SELECT') as anon_read,
        has_table_privilege('authenticated','local_service.shop_notification_contacts','SELECT') as auth_read,
        has_table_privilege('service_role','local_service.shop_notification_contacts','SELECT') as service_read,
        has_table_privilege('bk01_runtime','local_service.shop_notification_contacts','SELECT') as runtime_read,
        exists(select 1 from information_schema.columns where table_schema='local_service' and table_name='shops' and column_name='email') as email_on_shops
      from pg_class c where c.oid='local_service.shop_notification_contacts'::regclass`);
    record('contact table FORCE RLS is enabled, has no direct app grants, and shops stays untouched',
      catalog[0]?.relrowsecurity && catalog[0]?.relforcerowsecurity && !catalog[0]?.anon_read && !catalog[0]?.auth_read
       && !catalog[0]?.service_read && !catalog[0]?.runtime_read && !catalog[0]?.email_on_shops, JSON.stringify(catalog[0]));

    await guard();
    await adminDb`insert into auth.users(id,email,email_confirmed_at) values (${ownerId},'owner@example.test',now()),(${outsiderId},'other@example.test',now()) on conflict (id) do nothing`;
    await asRole(db, 'bk01_migrator', async (tx) => {
      await tx`insert into local_service.shops(id,name,slug,phone,promptpay_number,promptpay_name,require_deposit,default_deposit_amount,is_active)
        values (${shopId},'Group67 proof shop',${`group67-${shopId}`},'0800000000','0800000000','Proof Owner',false,0,true)`;
      await tx`insert into local_service.shop_users(shop_id,user_id,role) values (${shopId},${ownerId},'owner')`;
      await tx`insert into local_service.customers(id,shop_id,name,phone,line_user_id) values (${customerId},${shopId},'Proof Customer','0899990000','U-proof')`;
      await tx`insert into local_service.services(id,shop_id,name,duration_minutes,price,deposit_amount,is_active) values (${serviceId},${shopId},'Proof service',60,500,100,true)`;
      await tx`insert into local_service.staff(id,shop_id,name,is_active) values (${staffId},${shopId},'Proof staff',true)`;
      await tx`insert into local_service.staff_schedules(shop_id,staff_id,day_of_week,is_working_day,work_start,work_end)
        select ${shopId},${staffId},d,true,'00:00','23:59' from generate_series(0,6) d`;
      await tx`update local_service.subscriptions set plan='basic_490',status='active',current_period_end=now()+interval '30 days' where shop_id=${shopId}`;
      await tx`insert into local_service.bookings(id,shop_id,customer_id,staff_id,service_id,booking_date,start_time,end_time,status,deposit_status,
        total_price,deposit_price,service_price,service_duration_minutes,deposit_amount,start_timestamptz,end_timestamptz,link_token,link_token_expires_at)
        values (${bookingId},${shopId},${customerId},${staffId},${serviceId},${date(futureStart)}::date,${time(futureStart)}::time,
        ${time(new Date(futureStart.getTime()+3600000))}::time,'confirmed','awaiting',500,100,500,60,100,
        ${bangkokStart(futureStart)}::timestamptz,${bangkokStart(new Date(futureStart.getTime()+3600000))}::timestamptz,'GROUP6712AB',now()+interval '2 days')`;
    });
    const trialEntitlement = await asRole(db, 'bk01_migrator', async (tx) => {
      await tx`update local_service.subscriptions set status='trialing',current_period_end=now()+interval '7 days' where shop_id=${shopId}`;
      return tx`select local_service.bk01_shop_effective_plan(${shopId}) as plan`;
    });
    record('an active trial resolves to Basic entitlement through the existing effective-plan helper', trialEntitlement[0]?.plan === 'basic_490');
    const reminders = await asRole(db, 'bk01_migrator', (tx) => tx`select event_type,scheduled_for from local_service.line_notification_logs where booking_id=${bookingId} order by event_type`);
    const reminder3h = reminders.find((row) => row.event_type === 'reminder_3h');
    record('confirmed booking at least three hours away gets exactly reminder_3h at start minus three hours',
      reminders.filter((row) => row.event_type === 'reminder_3h').length === 1
        && !reminders.some((row) => row.event_type === 'reminder_24h')
        && Math.abs(new Date(reminder3h?.scheduled_for).getTime() - (futureStart.getTime()-3*3600000)) < 1000);

    const closeBooking = uid();
    await asRole(db, 'bk01_migrator', (tx) => tx`insert into local_service.bookings(id,shop_id,customer_id,staff_id,service_id,booking_date,start_time,end_time,status,deposit_status,
      total_price,service_duration_minutes,start_timestamptz,end_timestamptz,link_token,link_token_expires_at)
      values (${closeBooking},${shopId},${customerId},${staffId},${serviceId},${date(nearStart)}::date,${time(nearStart)}::time,
      ${time(new Date(nearStart.getTime()+3600000))}::time,'confirmed','awaiting',500,60,${bangkokStart(nearStart)}::timestamptz,
      ${bangkokStart(new Date(nearStart.getTime()+3600000))}::timestamptz,'GROUP67NEAR',now()+interval '2 days')`);
    const closeReminders = await asRole(db, 'bk01_migrator', (tx) => tx`select count(*)::integer as n from local_service.line_notification_logs where booking_id=${closeBooking} and event_type='reminder_3h'`);
    record('confirmation with less than three hours remaining creates no reminder row', Number(closeReminders[0]?.n) === 0);

    const oldStart = new Date(Date.now() + 30 * 60 * 60 * 1000);
    const rescheduleId = uid();
    await asRole(db, 'bk01_migrator', (tx) => tx`insert into local_service.bookings(id,shop_id,customer_id,staff_id,service_id,booking_date,start_time,end_time,status,deposit_status,
      total_price,service_duration_minutes,start_timestamptz,end_timestamptz,link_token,link_token_expires_at)
      values (${rescheduleId},${shopId},${customerId},${staffId},${serviceId},${date(oldStart)}::date,${time(oldStart)}::time,
      ${time(new Date(oldStart.getTime()+3600000))}::time,'confirmed','verified',500,60,${bangkokStart(oldStart)}::timestamptz,
      ${bangkokStart(new Date(oldStart.getTime()+3600000))}::timestamptz,'RS12CH34EF',now()+interval '2 days')`);
    const newStart = new Date(Date.now() + 30 * 60 * 1000);
    await asRole(anonDb, 'anon', (tx) => tx`select local_service.customer_reschedule_booking(
      ${rescheduleId},'RS12CH34EF',${date(newStart)}::date,${time(newStart)}::time,'Group67 proof')`);
    const rescheduledReminders = await asRole(db, 'bk01_migrator', (tx) => tx`select status,scheduled_for from local_service.line_notification_logs
      where booking_id=${rescheduleId} and event_type='reminder_3h'`);
    record('reschedule retires the old reminder and creates none when the new slot is under three hours',
      rescheduledReminders.length === 1 && rescheduledReminders[0].status === 'failed');

    const nullStartRescheduleId = uid();
    const nullRescheduleStaffId = uid();
    await asRole(db, 'bk01_migrator', async (tx) => {
      await tx`insert into local_service.staff(id,shop_id,name,is_active) values (${nullRescheduleStaffId},${shopId},'NULL reschedule staff',true)`;
      await tx`insert into local_service.bookings(id,shop_id,customer_id,staff_id,service_id,booking_date,start_time,end_time,status,deposit_status,
        total_price,service_duration_minutes,start_timestamptz,end_timestamptz,link_token,link_token_expires_at)
        values (${nullStartRescheduleId},${shopId},${customerId},${nullRescheduleStaffId},${serviceId},${date(oldStart)}::date,${time(oldStart)}::time,
        ${time(new Date(oldStart.getTime()+3600000))}::time,'confirmed','verified',500,60,null,null,'RSNULL1234',now()+interval '2 days')`;
    });
    let nullRescheduleError = '';
    try {
      await asRole(anonDb, 'anon', (tx) => tx`select local_service.customer_reschedule_booking(
        ${nullStartRescheduleId},'RSNULL1234',${date(newStart)}::date,${time(newStart)}::time,'Group67 NULL proof')`);
    } catch (error) { nullRescheduleError = String(error.message); }
    record('reschedule fails closed for NULL original appointment start', /window is closed or appointment time is missing/i.test(nullRescheduleError), nullRescheduleError);

    const nullStartCancelId = uid();
    const nullCancelStaffId = uid();
    await asRole(db, 'bk01_migrator', async (tx) => {
      await tx`insert into local_service.staff(id,shop_id,name,is_active) values (${nullCancelStaffId},${shopId},'NULL cancellation staff',true)`;
      await tx`insert into local_service.bookings(id,shop_id,customer_id,staff_id,service_id,booking_date,start_time,end_time,status,deposit_status,
        total_price,service_duration_minutes,start_timestamptz,end_timestamptz,link_token,link_token_expires_at)
        values (${nullStartCancelId},${shopId},${customerId},${nullCancelStaffId},${serviceId},${date(oldStart)}::date,${time(oldStart)}::time,
        ${time(new Date(oldStart.getTime()+3600000))}::time,'confirmed','verified',500,60,null,null,'CANCELNULL1',now()+interval '2 days')`;
    });
    let nullCancelError = '';
    try { await asRole(anonDb, 'anon', (tx) => tx`select local_service.customer_cancel_booking(${nullStartCancelId},'CANCELNULL1','Group67 NULL proof')`); }
    catch (error) { nullCancelError = String(error.message); }
    record('customer cancellation fails closed for NULL original appointment start', /window is closed or appointment time is missing/i.test(nullCancelError), nullCancelError);

    const nullEndRefundId = uid();
    const nullRefundStaffId = uid();
    await asRole(db, 'bk01_migrator', async (tx) => {
      await tx`insert into local_service.staff(id,shop_id,name,is_active) values (${nullRefundStaffId},${shopId},'NULL refund staff',true)`;
      await tx`insert into local_service.bookings(id,shop_id,customer_id,staff_id,service_id,booking_date,start_time,end_time,status,deposit_status,
        total_price,deposit_price,service_price,service_duration_minutes,deposit_amount,start_timestamptz,end_timestamptz,link_token,link_token_expires_at)
        values (${nullEndRefundId},${shopId},${customerId},${nullRefundStaffId},${serviceId},${date(oldStart)}::date,${time(oldStart)}::time,
        ${time(new Date(oldStart.getTime()+3600000))}::time,'confirmed','verified',500,100,500,60,100,${bangkokStart(oldStart)}::timestamptz,null,'REFUNDNULL1',now()+interval '2 days')`;
    });
    let nullRefundError = '';
    try {
      await asRole(authenticatedDb, 'authenticated', (tx) => tx`select local_service.record_deposit_refund(${nullEndRefundId},'GROUP67-NULL-END','proof')`,
        { sub: ownerId, role: 'authenticated' });
    } catch (error) { nullRefundError = String(error.message); }
    const nullRefundState = await asRole(db, 'bk01_migrator', (tx) => tx`select deposit_status from local_service.bookings where id=${nullEndRefundId}`);
    record('refund fails closed for confirmed booking with NULL appointment end', /Only a released queue or a booking past its appointment/i.test(nullRefundError)
      && nullRefundState[0]?.deposit_status === 'verified', nullRefundError);

    const pastStart = new Date(Date.now() - 60 * 60 * 1000);
    const pastBookingId = uid();
    await asRole(db, 'bk01_migrator', (tx) => tx`insert into local_service.bookings(id,shop_id,customer_id,staff_id,service_id,booking_date,start_time,end_time,status,deposit_status,
      total_price,service_duration_minutes,start_timestamptz,end_timestamptz,link_token,link_token_expires_at)
      values (${pastBookingId},${shopId},${customerId},${staffId},${serviceId},${date(pastStart)}::date,${time(pastStart)}::time,
      ${time(new Date(pastStart.getTime()+3600000))}::time,'confirmed','verified',500,60,${bangkokStart(pastStart)}::timestamptz,
      ${bangkokStart(new Date(pastStart.getTime()+3600000))}::timestamptz,'GROUP67PAST',now()+interval '2 days')`);
    const overdueId = uid();
    await asRole(db, 'bk01_migrator', async (tx) => {
      await tx`insert into local_service.line_notification_logs(id,shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
        values (${overdueId},${shopId},${pastBookingId},'reminder_3h','customer','pending',${`group67-overdue-${overdueId}`},now()+interval '5 minutes')`;
      await tx`update local_service.line_notification_logs set scheduled_for=now()-interval '1 minute' where id=${overdueId}`;
    });
    const overdueClaim = await asRole(runtimeDb, 'bk01_runtime', (tx) => tx`select id from local_service.claim_due_line_notifications(100) where id=${overdueId}`);
    const overdueStatus = await asRole(db, 'bk01_migrator', (tx) => tx`select status from local_service.line_notification_logs where id=${overdueId}`);
    record('runtime claim retires an overdue reminder without returning it for delivery', overdueClaim.length === 0 && overdueStatus[0]?.status === 'failed');

    const contact = await asRole(authenticatedDb, 'authenticated', (tx) => tx`select * from local_service.set_shop_notification_contact(${shopId})`,
      { sub: ownerId, email: 'owner@example.test', email_verified: true, role: 'authenticated' });
    record('owner RPC stores only the verified JWT email claim', contact[0]?.email === 'owner@example.test' && contact[0]?.verified_at != null);
    await asRole(db, 'bk01_migrator', async (tx) => {
      await tx`insert into local_service.line_notification_logs(shop_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
        values (${shopId},'shop_email_slip','shop_owner','pending',${`group67-email-${shopId}`},now())`;
      await tx`insert into local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
        values (${shopId},${bookingId},'reminder_3h','customer','sent',${`group67-sent-a-${shopId}`},now())`;
      await tx`insert into local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
        values (${shopId},${bookingId},'deposit_slip_decision','customer','sent',${`group67-sent-b-${shopId}`},now())`;
    });
    const pendingEmail = await asRole(runtimeDb, 'bk01_runtime', (tx) => tx`select * from local_service.claim_due_shop_email_notifications(10)`);
    record('email claim returns only due, verified-contact rows without booking/customer columns', pendingEmail.length === 1
      && pendingEmail[0].shop_id === shopId && pendingEmail[0].email === 'owner@example.test'
      && !('booking_id' in pendingEmail[0]) && !('customer_name' in pendingEmail[0]) && !('customer_email' in pendingEmail[0]));

    const sentRow = await asRole(db, 'bk01_migrator', async (tx) => {
      const rows = await tx`insert into local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for,sent_at)
        values (${shopId},${bookingId},'reminder_3h','customer','sent',${`group67-count-${shopId}`},now(),now()) returning id`;
      return rows[0].id;
    });
    const pendingContextId = uid();
    await asRole(db, 'bk01_migrator', (tx) => tx`insert into local_service.line_notification_logs(id,shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
      values (${pendingContextId},${shopId},${bookingId},'reminder_3h','customer','pending',${`group67-context-${shopId}`},now()+interval '1 hour')`);
    const context = await asRole(runtimeDb, 'bk01_runtime', (tx) => tx`select * from local_service.get_line_notification_delivery_context(${pendingContextId},0)`);
    record('existing context RPC includes this Basic shop-only Bangkok counter and cap fields', context.length === 1
      && Number(context[0].monthly_push_cap) === 600 && Number(context[0].push_used_this_month) === 3
      && context[0].capped === false && context[0].counting_unavailable === false
      && context[0].customer_reminder_push === true && context[0].customer_slip_decision_push === true
      && context[0].central_breaker_open === null, JSON.stringify(context[0]));

    let directReadError = '';
    await guard();
    await authenticatedDb.unsafe('SET ROLE authenticated');
    await authenticatedDb`select set_config('request.jwt.claims',${JSON.stringify({ sub: outsiderId, role: 'authenticated' })},false)`;
    try { await authenticatedDb`select email from local_service.shop_notification_contacts where shop_id=${shopId}`; }
    catch (error) { directReadError = String(error.message); }
    await guard();
    await authenticatedDb.unsafe('RESET ROLE');
    record('unrelated authenticated user cannot read another shop contact directly', /permission denied/i.test(directReadError), directReadError);
    let ownerDenied = false;
    await guard();
    await authenticatedDb.unsafe('SET ROLE authenticated');
    await authenticatedDb`select set_config('request.jwt.claims',${JSON.stringify({ sub: outsiderId, role: 'authenticated' })},false)`;
    try { await authenticatedDb`select * from local_service.get_shop_notification_contact(${shopId})`; }
    catch (error) { ownerDenied = /owner or admin|permission denied/i.test(String(error.message)); }
    await guard();
    await authenticatedDb.unsafe('RESET ROLE');
    record('unrelated authenticated user cannot read through owner/admin RPC', ownerDenied);
    const plan = await asRole(db, 'bk01_migrator', (tx) => tx`select plan_code,services_limit,customer_reminder_push,customer_slip_decision_push,shop_email_slip,shop_email_booking,monthly_push_cap,is_publicly_sellable,price_thb
      from local_service.entitlement_plans order by plan_code`);
    const free = plan.find((p) => p.plan_code === 'free');
    const basic = plan.find((p) => p.plan_code === 'basic_490');
    const pro = plan.find((p) => p.plan_code === 'pro_990');
    record('plan entitlements match approved values without changing price or sellability',
      Number(free?.services_limit) === 5 && Number(free?.monthly_push_cap) === 50
       && Number(basic?.monthly_push_cap) === 600 && Number(pro?.monthly_push_cap) === 1500
       && free?.customer_reminder_push === true && free?.customer_slip_decision_push === false
       && basic?.customer_slip_decision_push === true && basic?.shop_email_slip === true
       && basic?.shop_email_booking === false && pro?.shop_email_booking === true
       && basic?.price_thb === '390.00' && pro?.is_publicly_sellable === false);
    void sentRow;
  }
} finally {
  await Promise.all([db.end({ timeout: 5 }),runtimeDb.end({ timeout: 5}),authenticatedDb.end({ timeout: 5}),anonDb.end({ timeout: 5}),adminDb.end({ timeout: 5})]);
}
console.log(`RESULT ${results.filter((result) => result.ok).length}/${results.length} PASS mode=${mode}`);
