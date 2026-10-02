import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { validateBk01RuntimeEffectiveExecuteSet } from '../lib/bk01-runtime-allowlist.mjs';

const mode = process.argv[2] ?? 'after';
const url = process.env.BK01_P0_LOCAL_URL;
const dir = process.env.BK01_P0_EVIDENCE_DIR;
if (!['baseline', 'after', 'rollback'].includes(mode)
  || process.env.BK01_SHARED_RUNTIME_ENV !== 'local'
  || !url || new URL(url).hostname !== '127.0.0.1' || !dir) {
  throw new Error('isolated loopback W-1 environment required');
}
fs.mkdirSync(dir, { recursive: true });

const actorId = '99000000-0000-4000-8000-000000000001';
const shopId = '90000000-0000-4000-8000-000000000010';
const customerId = '99000000-0000-4000-8000-000000000002';
const customerInsertDeleteId = '99000000-0000-4000-8000-000000000003';
const lineIds = [
  '99000000-0000-4000-8000-000000000004',
  '99000000-0000-4000-8000-000000000005',
];
const lineValue = `U${'c'.repeat(32)}`;
const mk = (role) => postgres(url.replace(/\/\/[^@]+@/, `//${role}@`), {
  max: 1, prepare: false, onnotice: () => {},
  connection: { application_name: 'bk01-g10-truncate-proof' },
});
const op = mk('operator');
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const asRole = (fn, role = 'bk01_migrator') => op.begin(async (tx) => {
  await tx.unsafe(`SET LOCAL ROLE ${role}`);
  await tx`select set_config('request.jwt.claim.sub',${actorId},true)`;
  return fn(tx);
});

try {
  const triggers = await asRole((tx) => tx`
    select t.tgname,pg_get_triggerdef(t.oid) definition
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname='local_service'
      and c.relname in ('line_users','customers')
      and (t.tgname like 'bk01_line_binding_audit%' or t.tgname like 'bk01_customer_line_binding_audit%')
    order by t.tgname`);
  if (mode === 'rollback') {
    const [ledger] = await asRole((tx) => tx`select count(*)::int count from local_service_internal.schema_migrations where migration_id='20261002170000_bk01_g10_line_binding_audit_truncate'`);
    record('G10 follow-up rollback removes its migration ledger row', ledger.count === 0, `rows=${ledger.count}`);
    record('G10 follow-up rollback restores the exact 160000 trigger set',
      triggers.length === 2
        && triggers.some((x) => x.tgname === 'bk01_line_binding_audit_row')
        && triggers.some((x) => x.tgname === 'bk01_customer_line_binding_audit_row'),
      JSON.stringify(triggers.map((x) => x.tgname)));
  } else {
    const [serviceTruncate] = await asRole((tx) => tx`select has_table_privilege('service_role','local_service.line_users','TRUNCATE') allowed`);
    record('service_role retains the pre-existing line_users TRUNCATE privilege', serviceTruncate.allowed, JSON.stringify(serviceTruncate));

    await asRole(async (tx) => {
      await tx`delete from local_service.line_users where id in (${lineIds[0]}::uuid,${lineIds[1]}::uuid)`;
      await tx`delete from local_service.customers where id in (${customerId}::uuid,${customerInsertDeleteId}::uuid)`;
      await tx`delete from local_service_internal.line_binding_audit where row_id in (${lineIds[0]}::uuid,${lineIds[1]}::uuid,${customerId}::uuid,${customerInsertDeleteId}::uuid)`;
      await tx`insert into local_service.customers(id,shop_id,name,phone,line_user_id)
        values (${customerId}::uuid,${shopId}::uuid,'No-op fixture','0890000301',null),
          (${customerInsertDeleteId}::uuid,${shopId}::uuid,'Insert-delete fixture','0890000302',${lineValue})`;
      await tx`insert into local_service.line_users(id,shop_id,customer_id,line_user_id)
        values (${lineIds[0]}::uuid,${shopId}::uuid,${customerId}::uuid,${lineValue}),
          (${lineIds[1]}::uuid,${shopId}::uuid,${customerId}::uuid,${lineValue + 'x'})`;
    });

    await asRole((tx) => tx`update local_service.line_users set line_user_id=${lineValue} where id=${lineIds[0]}::uuid`);
    const noOp = await asRole((tx) => tx`
      select count(*)::int count from local_service_internal.line_binding_audit
      where table_name='line_users' and operation='UPDATE' and row_id=${lineIds[0]}::uuid`);
    record('line_users no-op UPDATE writes no audit row', noOp[0].count === 0, `rows=${noOp[0].count}`);

    await asRole((tx) => tx`truncate table local_service.line_users`, 'service_role');
    const truncateRows = await asRole((tx) => tx`
      select row_id,shop_id,customer_id,old_line_user_id,new_line_user_id,actor_user_id,actor_effective_role
      from local_service_internal.line_binding_audit
      where table_name='line_users' and operation='TRUNCATE'
        and row_id in (${lineIds[0]}::uuid,${lineIds[1]}::uuid) order by row_id`);
    record('service_role TRUNCATE is recorded once per deleted LINE binding with actor and pre-image',
      truncateRows.length === lineIds.length
        && truncateRows.every((row) => row.shop_id === shopId && row.customer_id === customerId
          && row.old_line_user_id && row.new_line_user_id === null
          && row.actor_user_id === actorId && row.actor_effective_role === 'service_role'),
      JSON.stringify(truncateRows));

    await asRole((tx) => tx`delete from local_service.customers where id=${customerInsertDeleteId}::uuid`);
    const customerRows = await asRole((tx) => tx`
      select operation,row_id,shop_id,old_line_user_id,new_line_user_id,actor_user_id
      from local_service_internal.line_binding_audit
      where table_name='customers' and row_id=${customerInsertDeleteId}::uuid order by operation`);
    record('customers INSERT and DELETE with line_user_id write audit rows',
      customerRows.length === 2
        && customerRows.some((row) => row.operation === 'INSERT' && row.old_line_user_id === null && row.new_line_user_id === lineValue)
        && customerRows.some((row) => row.operation === 'DELETE' && row.old_line_user_id === lineValue && row.new_line_user_id === null)
        && customerRows.every((row) => row.shop_id === shopId && row.actor_user_id === actorId),
      JSON.stringify(customerRows));

    const existingFunctions = await asRole((tx) => tx`
      select p.oid::regprocedure::text identity,pg_get_userbyid(p.proowner) owner,p.proacl::text acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='local_service' order by 1`);
    const [runtimeCount] = await asRole((tx) => tx`
      select count(*)::int count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='local_service' and has_function_privilege('bk01_runtime',p.oid,'EXECUTE')`);
    const runtimeIdentities = (await asRole((tx) => tx`
      select p.oid::regprocedure::text identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='local_service' and has_function_privilege('bk01_runtime',p.oid,'EXECUTE') order by 1`)).map((row) => row.identity);
    validateBk01RuntimeEffectiveExecuteSet(runtimeIdentities);
    record('effective bk01_runtime RPC allowlist remains exactly 21 identities', runtimeCount.count === 21, `count=${runtimeCount.count}`);
    const beforePath = path.join(dir, 'g10-truncate-functions-before.json');
    if (mode === 'baseline') {
      fs.writeFileSync(beforePath, JSON.stringify(existingFunctions, null, 2));
    } else {
      const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
      const current = new Map(existingFunctions.map((row) => [row.identity, row]));
      const delta = before.filter((row) => {
        const now = current.get(row.identity);
        return !now || row.owner !== now.owner || row.acl !== now.acl;
      }).map((row) => row.identity);
      record('existing local_service function owner/ACL delta is empty', delta.length === 0, JSON.stringify(delta));
    }

    await asRole(async (tx) => {
      await tx`delete from local_service_internal.line_binding_audit where row_id in (${lineIds[0]}::uuid,${lineIds[1]}::uuid,${customerId}::uuid,${customerInsertDeleteId}::uuid)`;
      await tx`delete from local_service.line_users where id in (${lineIds[0]}::uuid,${lineIds[1]}::uuid)`;
      await tx`delete from local_service.customers where id in (${customerId}::uuid,${customerInsertDeleteId}::uuid)`;
      await tx`delete from local_service_internal.line_binding_audit where row_id in (${lineIds[0]}::uuid,${lineIds[1]}::uuid,${customerId}::uuid,${customerInsertDeleteId}::uuid)`;
    });
  }
} finally {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `g10-truncate-${mode}-results.json`), JSON.stringify(results, null, 2));
  await op.end();
}

const failures = results.filter((result) => !result.ok);
if (failures.length > 0) {
  console.error(`${failures.length} G10 truncate audit assertion(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`PASS ${results.length} ${mode} assertions`);
}
