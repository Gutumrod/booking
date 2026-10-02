import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { validateBk01RuntimeEffectiveExecuteSet } from '../lib/bk01-runtime-allowlist.mjs';

const mode = process.argv[2] ?? 'after';
const url = process.env.BK01_P0_LOCAL_URL;
const dir = process.env.BK01_P0_EVIDENCE_DIR;
const data = process.env.BK01_P0_DATA_DIR;
if (!['baseline', 'after', 'rollback'].includes(mode)
  || process.env.BK01_SHARED_RUNTIME_ENV !== 'local' || !url
  || new URL(url).hostname !== '127.0.0.1' || !dir || !data) {
  throw new Error('isolated loopback W-1 environment required');
}

const shop = '90000000-0000-4000-8000-000000000010';
const service = '90000000-0000-4000-8000-000000000011';
const staff = '90000000-0000-4000-8000-000000000012';
const mk = (role) => postgres(url.replace(/\/\/[^@]+@/, `//${role}@`), {
  max: 40, prepare: false, onnotice: () => {}, connection: { application_name: 'bk01-p1-g09-g10-proof' },
});
const op = mk('operator');
const adm = mk('fixture_admin');
const rt = mk('runtime_probe');
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const role = (db, roleName, fn, claims = false) => db.begin(async (tx) => {
  await tx.unsafe(`SET LOCAL ROLE ${roleName}`);
  if (claims) await tx.unsafe("SET LOCAL request.jwt.claim.role = 'bk01_runtime'");
  return fn(tx);
});
const mig = (fn) => role(op, 'bk01_migrator', fn);
const runtime = (fn) => role(rt, 'bk01_runtime', fn, true);
const snapFile = path.join(dir, 'p1-g09-g10-catalog-before.json');
const touchedPhones = new Set();
const touchedEvents = new Set();
const touchedLineIds = new Set();
const phoneDateOffsets = new Map();
let nextDateOffset = 0;
let originalLineOa;

async function snapshot() {
  return mig(async (tx) => ({
    types: await tx`select n.nspname||'.'||t.typname identity,t.typtype,pg_get_userbyid(t.typowner) owner,t.typacl::text acl,(select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid) labels from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('local_service','local_service_internal') order by 1`,
    functions: await tx`select p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('local_service','local_service_internal') order by 1`,
    relations: await tx`select n.nspname||'.'||c.relname identity,c.relkind,pg_get_userbyid(c.relowner) owner,c.relacl::text acl,c.relrowsecurity,c.relforcerowsecurity,case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,true) else null end definition from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('local_service','local_service_internal') order by 1`,
    columns: await tx`select table_schema,table_name,column_name,data_type,udt_name,character_maximum_length,is_nullable,column_default,ordinal_position from information_schema.columns where table_schema in ('local_service','local_service_internal') order by table_schema,table_name,ordinal_position`,
    indexes: await tx`select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('local_service','local_service_internal') order by 1,2,3`,
    policies: await tx`select * from pg_policies where schemaname in ('local_service','local_service_internal') order by schemaname,tablename,policyname`,
    constraints: await tx`select conrelid::regclass::text tbl,conname,pg_get_constraintdef(oid) definition,convalidated from pg_constraint where connamespace in ('local_service'::regnamespace,'local_service_internal'::regnamespace) order by 1,2`,
    triggers: await tx`select tgrelid::regclass::text tbl,tgname,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal and tgrelid in (select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('local_service','local_service_internal')) order by 1,2`,
    acl: await tx`select c.oid::regclass::text identity,case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end grantee,a.privilege_type,a.is_grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) a where n.nspname in ('local_service','local_service_internal') order by c.oid::regclass::text,grantee,privilege_type`,
  }));
}

async function hold(phone, minute = '10:00') {
  touchedPhones.add(phone);
  if (!phoneDateOffsets.has(phone)) phoneDateOffsets.set(phone, 90 + nextDateOffset++);
  const offset = phoneDateOffsets.get(phone);
  const [day] = await runtime((tx) => tx`select ((now() at time zone 'Asia/Bangkok')::date+${offset}::integer)::text d`);
  const [row] = await runtime((tx) => tx`select local_service.create_booking_hold(
    ${shop}::uuid,${service}::uuid,${staff}::uuid,'G09 G10 proof',${phone}::varchar,null,
    ${day.d}::date,${minute}::time,'isolated acceptance proof') result`);
  return row.result;
}

const bind = (event, booking, lineUser, expectedShop = shop) => {
  touchedEvents.add(event);
  touchedLineIds.add(lineUser);
  return runtime((tx) => tx`select * from local_service.bk01_line_bind_booking(
    ${event},${booking.booking_code},${booking.link_token},${expectedShop}::uuid,${lineUser})`);
};
const trialBind = (event, booking, lineUser) => {
  touchedEvents.add(event);
  touchedLineIds.add(lineUser);
  return runtime((tx) => tx`select * from local_service.bk01_line_bind_booking_trial(
    ${event},${booking.booking_code},${booking.link_token},${lineUser})`);
};
const lineId = (n) => `U${BigInt(n).toString(16).padStart(32, '0')}`;
const cleanPhoneList = () => [...touchedPhones];
const rejectRpcError = async (name, fn, pattern) => {
  try {
    await fn();
    record(name, false, 'unexpected success');
  } catch (error) {
    record(name, pattern.test(error.message), error.message);
  }
};

async function cleanup() {
  const phones = cleanPhoneList();
  const events = [...touchedEvents];
  const lineIds = [...touchedLineIds];
  if (phones.length) {
    await role(adm, 'fixture_admin', (tx) => tx`delete from wstera_platform_internal.storage_upload_grants g where split_part(g.object_path,'/',1) in (select b.id::text from local_service.bookings b join local_service.customers c on c.id=b.customer_id where c.phone=any(${phones}::text[]))`);
  }
  await mig(async (tx) => {
    if (phones.length) {
      await tx`delete from local_service.line_notification_logs l where l.booking_id in (select b.id from local_service.bookings b join local_service.customers c on c.id=b.customer_id where c.phone=any(${phones}::text[]))`;
      await tx`delete from local_service.deposit_slip_upload_grants g where g.booking_id in (select b.id from local_service.bookings b join local_service.customers c on c.id=b.customer_id where c.phone=any(${phones}::text[]))`;
      await tx`delete from local_service.booking_recovery_attempts a where a.booking_id in (select b.id from local_service.bookings b join local_service.customers c on c.id=b.customer_id where c.phone=any(${phones}::text[]))`;
      if (mode !== 'baseline') {
        const [intentTable] = await tx`select to_regclass('local_service_internal.booking_upload_intent_attempts') is not null present`;
        if (intentTable.present) await tx`delete from local_service_internal.booking_upload_intent_attempts a where a.booking_id in (select b.id from local_service.bookings b join local_service.customers c on c.id=b.customer_id where c.phone=any(${phones}::text[]))`;
      }
      await tx`delete from local_service.line_users lu where lu.shop_id=${shop}::uuid and (lu.customer_id in (select c.id from local_service.customers c where c.phone=any(${phones}::text[])) or lu.line_user_id=any(${lineIds}::text[]))`;
      await tx`delete from local_service.bookings b using local_service.customers c where b.customer_id=c.id and c.phone=any(${phones}::text[])`;
      await tx`delete from local_service.customers c where c.shop_id=${shop}::uuid and c.phone=any(${phones}::text[])`;
    }
    if (events.length) await tx`delete from local_service.line_webhook_events where webhook_event_id=any(${events}::text[])`;
    if (originalLineOa !== undefined) await tx`update local_service.shops set line_oa_id=${originalLineOa} where id=${shop}::uuid`;
  });
}

try {
  const [db] = await adm`select current_setting('data_directory') data`;
  record('P1 proof uses the declared disposable PG data directory', db.data.replaceAll('\\', '/') === data.replaceAll('\\', '/'));
  const [shopRow] = await mig((tx) => tx`select line_oa_id from local_service.shops where id=${shop}::uuid`);
  originalLineOa = shopRow.line_oa_id;
  await mig((tx) => tx`update local_service.shops set line_oa_id='U00000000000000000000000000000000' where id=${shop}::uuid`);
  if (mode === 'baseline') {
    fs.writeFileSync(snapFile, JSON.stringify(await snapshot(), null, 2));

    const keepsCounter = await hold('0890000101');
    const [wrong1] = await runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${keepsCounter.booking_id}::uuid,'WRONG-A') ok`);
    const [wrong2] = await runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${keepsCounter.booking_id}::uuid,'WRONG-B') ok`);
    const [valid] = await runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${keepsCounter.booking_id}::uuid,${keepsCounter.link_token}) ok`);
    const [kept] = await mig((tx) => tx`select failed_attempts from local_service.booking_recovery_attempts where booking_id=${keepsCounter.booking_id}::uuid`);
    record('G09 valid recovery passes and leaves failed-token evidence unchanged', !wrong1.ok && !wrong2.ok && valid.ok && kept?.failed_attempts === 2, `remaining=${kept?.failed_attempts ?? 'deleted'}`);

    const threshold = await hold('0890000102');
    for (let i = 0; i < 5; i += 1) await runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${threshold.booking_id}::uuid,'WRONG-THRESHOLD')`);
    const [atFive] = await mig((tx) => tx`select failed_attempts,blocked_until,window_started_at from local_service.booking_recovery_attempts where booking_id=${threshold.booking_id}::uuid`);
    record('G09 attempts 1-5 in 15m are not prematurely blocked', atFive?.failed_attempts === 5 && atFive.blocked_until === null, `count=${atFive?.failed_attempts}, blocked=${atFive?.blocked_until}`);
    await runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${threshold.booking_id}::uuid,'WRONG-SIXTH')`);
    const [atSix] = await mig((tx) => tx`select failed_attempts,blocked_until,window_started_at from local_service.booking_recovery_attempts where booking_id=${threshold.booking_id}::uuid`);
    record('G09 sixth wrong token activates only the remaining 15m window', atSix?.failed_attempts === 6 && atSix.blocked_until && atSix.blocked_until.getTime() <= atSix.window_started_at.getTime() + 15 * 60_000, `count=${atSix?.failed_attempts}, blocked=${atSix?.blocked_until}`);
    const [validDespiteFailure] = await runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${threshold.booking_id}::uuid,${threshold.link_token}) ok`);
    record('G09 valid token is never blocked by another token-failure counter', validDespiteFailure.ok);

    const flood = await hold('0890000103');
    const floodResults = await Promise.all(Array.from({ length: 12 }, () => runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${flood.booking_id}::uuid,'WRONG-CONCURRENT') ok`)));
    const [floodCount] = await mig((tx) => tx`select failed_attempts from local_service.booking_recovery_attempts where booking_id=${flood.booking_id}::uuid`);
    record('G09 concurrent wrong tokens persist a bounded threshold atomically', floodResults.flat().every((r) => r.ok === false) && floodCount?.failed_attempts === 6, `stored=${floodCount?.failed_attempts}`);

    const budget = await hold('0890000104');
    const intentCalls = await Promise.allSettled(Array.from({ length: 24 }, () => runtime((tx) => tx`select * from local_service.authorize_deposit_slip_upload(${budget.booking_id}::uuid,${budget.link_token},'image/jpeg',1024)`)));
    const accepted = intentCalls.filter((x) => x.status === 'fulfilled').length;
    record('G09 concurrent valid upload intents are capped at 20 per 24h', accepted === 20, `accepted=${accepted}/24`);

    const sharedA = await hold('0890000105', '10:30');
    const sharedB = await hold('0890000105', '11:30');
    const firstLine = lineId(0xa01);
    const attackerLine = lineId(0xa02);
    const first = await bind('G09T:shared-first', sharedA, firstLine);
    const attacked = await bind('G09T:shared-attacker', sharedB, attackerLine);
    const [sharedState] = await mig((tx) => tx`select c.line_user_id from local_service.customers c where c.phone='0890000105' and c.shop_id=${shop}::uuid`);
    record('G10 shared-phone attacker LINE cannot replace the booking recipient', first[0].claimed && !attacked[0].claimed && sharedState?.line_user_id === firstLine, `recipient=${sharedState?.line_user_id}`);

    const ownerBooking = await hold('0890000106');
    const otherBooking = await hold('0890000107');
    const claimedLine = lineId(0xa03);
    const ownerBind = await bind('G09T:mapped-owner', ownerBooking, claimedLine);
    const rebind = await bind('G09T:mapped-other', otherBooking, claimedLine);
    const [mapped] = await mig((tx) => tx`select customer_id from local_service.line_users where shop_id=${shop}::uuid and line_user_id=${claimedLine}`);
    const [ownerCustomer] = await mig((tx) => tx`select customer_id from local_service.bookings where id=${ownerBooking.booking_id}::uuid`);
    record('G10 a LINE ID bound to one customer cannot rebind via a different booking token', ownerBind[0].claimed && !rebind[0].claimed && mapped?.customer_id === ownerCustomer.customer_id, `mapped=${mapped?.customer_id}`);

    const legit = await hold('0890000108');
    const legitId = lineId(0xa04);
    const legitResult = await bind('G09T:legitimate', legit, legitId);
    record('G10 legitimate verified webhook binds the booking owner', legitResult[0].claimed === true);
    const logId = crypto.randomUUID();
    await mig((tx) => tx`insert into local_service.line_notification_logs(id,shop_id,booking_id,event_type,recipient_type,status,attempt_count,scheduled_for,idempotency_key)
      values(${logId}::uuid,${shop}::uuid,${legit.booking_id}::uuid,'booking_created','customer','pending',1,now(),'G09T:recipient:'||${logId})`);
    const recipients = await runtime((tx) => tx`select line_user_id,booking_id from local_service.get_line_notification_delivery_context(${logId}::uuid,1)`);
    record('G10 notification context returns only the target booking recipient', recipients.length === 1 && recipients[0].booking_id === legit.booking_id && recipients[0].line_user_id === legitId);

    const wrongShop = await bind('G09T:cross-shop', legit, lineId(0xa05), '90000000-0000-4000-8000-000000000099');
    record('G10 cross-shop binding attempt fails closed', wrongShop.length === 1 && wrongShop[0].claimed === false);
    const replayEvent = 'G09T:replay';
    const replayBooking = await hold('0890000109');
    const firstReplay = await bind(replayEvent, replayBooking, lineId(0xa06));
    const secondReplay = await bind(replayEvent, replayBooking, lineId(0xa06));
    record('G10 webhook event replay does not bind twice', firstReplay[0].claimed && secondReplay[0].claimed === false);

    const parallelA = await hold('0890000110', '13:30');
    const parallelB = await hold('0890000110', '15:00');
    const parallel = await Promise.all([
      bind('G09T:parallel-a', parallelA, lineId(0xa07)),
      bind('G09T:parallel-b', parallelB, lineId(0xa08)),
    ]);
    record('G10 parallel binding attempts for one shared customer have one winner', parallel.flat().filter((x) => x.claimed).length === 1);

    await mig((tx) => tx`update local_service.shops set line_oa_id=null where id=${shop}::uuid`);
    const trial = await hold('0890000111');
    const trialFirst = await trialBind('G09T:trial-first', trial, lineId(0xa09));
    const trialRebind = await trialBind('G09T:trial-rebind', trial, lineId(0xa0a));
    record('G10 trial binding remains one-time and cannot rebind', trialFirst[0].claimed && trialRebind[0].claimed === false);

    const webhook = fs.readFileSync('apps/booking-consumer/src/lib/line-webhook.ts', 'utf8');
    record('G10 route verifies LINE signature before any binding RPC', webhook.indexOf('if (!verifySignature(') >= 0 && webhook.indexOf('runtime.rpc(rpcName, rpcArgs)') >= 0 && webhook.indexOf('if (!verifySignature(') < webhook.indexOf('runtimeProvider()') && webhook.indexOf('runtimeProvider()') < webhook.indexOf('runtime.rpc(rpcName, rpcArgs)'));
  } else if (mode === 'after') {
    const before = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
    const after = await snapshot();
    const changedAcl = after.functions.filter((current) => {
      const old = before.functions.find((candidate) => candidate.identity === current.identity);
      return old && (old.owner !== current.owner || old.acl !== current.acl);
    });
    record('G09/G10 preserve owner and EXECUTE ACL for every existing RPC', changedAcl.length === 0, JSON.stringify(changedAcl.map((x) => x.identity)));
    record('G09/G10 add no runtime RPC identity', after.functions.filter((x) => !before.functions.some((old) => old.identity === x.identity)).length === 0);
    const effective = await mig((tx) => tx`select p.oid::regprocedure::text identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='local_service' and has_function_privilege('bk01_runtime',p.oid,'EXECUTE') order by 1`);
    let exactRuntimeSurface = true;
    let runtimeSurfaceError = '';
    try { validateBk01RuntimeEffectiveExecuteSet(effective.map((x) => x.identity), 'G09/G10 W-1 catalog'); }
    catch (error) { exactRuntimeSurface = false; runtimeSurfaceError = error.message; }
    record('G09/G10 runtime EXECUTE surface remains exact at 21', exactRuntimeSurface, `count=${effective.length}${runtimeSurfaceError ? `; ${runtimeSurfaceError}` : ''}`);
    const tables = ['local_service.booking_recovery_attempts', 'local_service_internal.booking_upload_intent_attempts'];
    for (const relation of tables) {
      const grants = await mig((tx) => tx`select role_name,privilege_type from (values ('anon'),('authenticated'),('service_role'),('bk01_runtime')) roles(role_name) cross join lateral (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) priv(privilege_type) where has_table_privilege(roles.role_name,${relation},priv.privilege_type)`);
      record(`G09 ${relation} has no direct client/runtime counter access`, grants.length === 0, JSON.stringify(grants));
    }
    const [rls] = await mig((tx) => tx`select c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner from pg_class c where c.oid='local_service_internal.booking_upload_intent_attempts'::regclass`);
    record('G09 intent counter remains internal RLS-protected with no forced-owner breakage', rls?.relrowsecurity === true && rls?.relforcerowsecurity === false && rls?.owner === 'bk01_migrator', JSON.stringify(rls));

    const keep = await hold('0890000201');
    await runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${keep.booking_id}::uuid,'WRONG-1')`);
    await runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${keep.booking_id}::uuid,'WRONG-2')`);
    const [valid] = await runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${keep.booking_id}::uuid,${keep.link_token}) ok`);
    const [remaining] = await mig((tx) => tx`select failed_attempts from local_service.booking_recovery_attempts where booking_id=${keep.booking_id}::uuid`);
    record('G09 valid token passes without deleting/resetting failures', valid.ok && remaining?.failed_attempts === 2, `remaining=${remaining?.failed_attempts}`);

    const threshold = await hold('0890000202');
    const wrong = await Promise.all(Array.from({ length: 12 }, () => runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${threshold.booking_id}::uuid,'WRONG-CONCURRENT') ok`)));
    const [counter] = await mig((tx) => tx`select failed_attempts,blocked_until,window_started_at from local_service.booking_recovery_attempts where booking_id=${threshold.booking_id}::uuid`);
    record('G09 concurrent invalid tokens stop at six and block only until the 15m window ends', wrong.flat().every((x) => x.ok === false) && counter?.failed_attempts === 6 && counter.blocked_until && counter.blocked_until.getTime() <= counter.window_started_at.getTime() + 15 * 60_000, `count=${counter?.failed_attempts}, blocked=${counter?.blocked_until}`);
    const [validAfterFlood] = await runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${threshold.booking_id}::uuid,${threshold.link_token}) ok`);
    record('G09 correct token succeeds during active invalid-token window', validAfterFlood.ok);

    const foreignA = await hold('0890000208');
    const foreignB = await hold('0890000209');
    const [foreignToken] = await runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${foreignA.booking_id}::uuid,${foreignB.link_token}) ok`);
    record('G09 a valid token from a different booking is rejected', foreignToken.ok === false);
    const expired = await hold('0890000210');
    await mig((tx) => tx`update local_service.bookings set link_token_expires_at=now()-interval '1 minute' where id=${expired.booking_id}::uuid`);
    const [expiredToken] = await runtime((tx) => tx`select local_service.authorize_booking_recovery_attempt(${expired.booking_id}::uuid,${expired.link_token}) ok`);
    record('G09 an expired correct token is rejected', expiredToken.ok === false);

    const budget = await hold('0890000203');
    const calls = await Promise.allSettled(Array.from({ length: 24 }, () => runtime((tx) => tx`select * from local_service.authorize_deposit_slip_upload(${budget.booking_id}::uuid,${budget.link_token},'image/jpeg',1024)`)));
    const successful = calls.filter((x) => x.status === 'fulfilled').length;
    record('G09 upload intent budget grants exactly 20 under 24 concurrent requests', successful === 20, `accepted=${successful}, rejected=${24 - successful}`);
    const [ledger] = await mig((tx) => tx`select successful_intents from local_service_internal.booking_upload_intent_attempts where booking_id=${budget.booking_id}::uuid`);
    record('G09 budget ledger contains no more than 20 successful intents', ledger?.successful_intents === 20, `stored=${ledger?.successful_intents}`);

    const sharedA = await hold('0890000204', '10:30');
    const sharedB = await hold('0890000204', '11:30');
    const firstLine = lineId(0xb01);
    const attackerLine = lineId(0xb02);
    const first = await bind('G09T:green-shared-first', sharedA, firstLine);
    const attacked = await bind('G09T:green-shared-attacker', sharedB, attackerLine);
    const [sharedState] = await mig((tx) => tx`select c.line_user_id from local_service.customers c where c.phone='0890000204' and c.shop_id=${shop}::uuid`);
    record('G10 shared phone cannot reassign an already-bound notification recipient', first[0].claimed && !attacked[0].claimed && sharedState?.line_user_id === firstLine, `recipient=${sharedState?.line_user_id}`);

    const ownerBooking = await hold('0890000205');
    const otherBooking = await hold('0890000206');
    const claimedLine = lineId(0xb03);
    const ownerBind = await bind('G09T:green-mapped-owner', ownerBooking, claimedLine);
    const rebind = await bind('G09T:green-mapped-other', otherBooking, claimedLine);
    const [mapping] = await mig((tx) => tx`select customer_id from local_service.line_users where shop_id=${shop}::uuid and line_user_id=${claimedLine}`);
    const [ownerCustomer] = await mig((tx) => tx`select customer_id from local_service.bookings where id=${ownerBooking.booking_id}::uuid`);
    record('G10 mapped LINE ID remains with its first customer', ownerBind[0].claimed && !rebind[0].claimed && mapping?.customer_id === ownerCustomer.customer_id);

    const legit = await hold('0890000211');
    const legitId = lineId(0xb06);
    const legitResult = await bind('G09T:green-legitimate', legit, legitId);
    record('G10 legitimate verified booking token binds its own customer', legitResult[0].claimed === true);
    const logId = crypto.randomUUID();
    await mig((tx) => tx`insert into local_service.line_notification_logs(id,shop_id,booking_id,event_type,recipient_type,status,attempt_count,scheduled_for,idempotency_key)
      values(${logId}::uuid,${shop}::uuid,${legit.booking_id}::uuid,'booking_created','customer','pending',1,now(),'G09T:recipient:'||${logId})`);
    const recipients = await runtime((tx) => tx`select line_user_id,booking_id from local_service.get_line_notification_delivery_context(${logId}::uuid,1)`);
    record('G10 notification context returns only the target booking recipient', recipients.length === 1 && recipients[0].booking_id === legit.booking_id && recipients[0].line_user_id === legitId);

    const crossShop = await bind('G09T:green-cross-shop', legit, lineId(0xb07), '90000000-0000-4000-8000-000000000099');
    record('G10 cross-shop claim fails closed', crossShop.length === 1 && crossShop[0].claimed === false);
    const replayBooking = await hold('0890000212');
    const replayId = lineId(0xb08);
    const replayFirst = await bind('G09T:green-replay', replayBooking, replayId);
    const replaySecond = await bind('G09T:green-replay', replayBooking, replayId);
    record('G10 replayed webhook event cannot claim twice', replayFirst[0].claimed && replaySecond[0].claimed === false);

    await mig((tx) => tx`update local_service.shops set line_oa_id=null where id=${shop}::uuid`);
    const trial = await hold('0890000213');
    const trialFirst = await trialBind('G09T:green-trial-first', trial, lineId(0xb09));
    const trialRebind = await trialBind('G09T:green-trial-rebind', trial, lineId(0xb0a));
    record('G10 trial binding remains one-time and cannot rebind', trialFirst[0].claimed && trialRebind[0].claimed === false);
    await mig((tx) => tx`update local_service.shops set line_oa_id='U00000000000000000000000000000000' where id=${shop}::uuid`);

    const webhook = fs.readFileSync('apps/booking-consumer/src/lib/line-webhook.ts', 'utf8');
    record('G10 route verifies LINE signature before any binding RPC', webhook.indexOf('if (!verifySignature(') >= 0 && webhook.indexOf('runtime.rpc(rpcName, rpcArgs)') >= 0 && webhook.indexOf('if (!verifySignature(') < webhook.indexOf('runtimeProvider()') && webhook.indexOf('runtimeProvider()') < webhook.indexOf('runtime.rpc(rpcName, rpcArgs)'));

    const parallelA = await hold('0890000207', '13:30');
    const parallelB = await hold('0890000207', '15:00');
    const parallel = await Promise.all([
      bind('G09T:green-parallel-a', parallelA, lineId(0xb04)),
      bind('G09T:green-parallel-b', parallelB, lineId(0xb05)),
    ]);
    const parallelWinners = parallel.flat().filter((x) => x.claimed).length;
    const parallelCustomers = await mig((tx) => tx`select count(distinct customer_id)::integer count from local_service.bookings where id in (${parallelA.booking_id}::uuid,${parallelB.booking_id}::uuid)`);
    record('G10 concurrent binding for shared customer has one winner', parallelWinners === 1 && parallelCustomers[0].count === 1, `winners=${parallelWinners}, customers=${parallelCustomers[0].count}`);
  } else {
    const before = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
    const after = await snapshot();
    const diffs = [];
    for (const key of Object.keys(before)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        diffs.push(key);
        fs.writeFileSync(path.join(dir, `p1-rollback-${key}.json`), JSON.stringify({ before: before[key], after: after[key] }, null, 2));
      }
    }
    record('G09/G10 rollback raw catalog diff to e9745a8 is zero', diffs.length === 0, JSON.stringify(diffs));
  }
} finally {
  try { await cleanup(); } catch (error) { console.error(`cleanup failed: ${error.message}`); }
  fs.writeFileSync(path.join(dir, `p1-g09-g10-${mode}-results.json`), JSON.stringify(results, null, 2));
  await Promise.all([op, adm, rt].map((db) => db.end()));
}

const failures = results.filter((x) => !x.ok);
if (mode === 'baseline' ? failures.length === 0 : failures.length > 0) {
  console.error(mode === 'baseline' ? 'Expected G09/G10 contract tests to be red before migration' : `${failures.length} G09/G10 contract checks failed`);
  process.exitCode = 1;
} else {
  console.log(mode === 'baseline' ? `RED BEFORE migration: ${failures.length}/${results.length} acceptance assertions fail as expected` : `PASS ${results.length} ${mode} assertions`);
}
