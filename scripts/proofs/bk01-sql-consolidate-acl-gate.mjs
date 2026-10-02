import { readFile, writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import {
  BK01_RUNTIME_EFFECTIVE_FUNCTIONS,
  validateBk01RuntimeEffectiveExecuteSet,
} from '../lib/bk01-runtime-allowlist.mjs';

const mode = process.argv[2];
if (!['baseline', 'fail-before', 'final', 'rollback'].includes(mode)) {
  throw new Error('Usage: node scripts/proofs/bk01-sql-consolidate-acl-gate.mjs baseline|fail-before|final|rollback');
}
if (process.env.BK01_SHARED_RUNTIME_ENV !== 'local') throw new Error('Refusing non-local environment');
const url = process.env.BK01_SQL_CONSOLIDATE_DATABASE_URL;
const snapshotPath = process.env.BK01_SQL_CONSOLIDATE_ACL_BASELINE_FILE;
const runtimeUrl = process.env.BK01_SQL_CONSOLIDATE_RUNTIME_DATABASE_URL;
if (!url || !snapshotPath || !runtimeUrl) throw new Error('Database URL, runtime probe URL and ACL baseline file are required');
const parsed = new URL(url);
const parsedRuntime = new URL(runtimeUrl);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith('booking')
    || !['127.0.0.1', 'localhost'].includes(parsedRuntime.hostname) || parsedRuntime.pathname !== parsed.pathname) {
  throw new Error('Refusing database outside local booking* scaffold');
}
const db = postgres(url, { max: 1, prepare: false, connect_timeout: 5, application_name: `bk01-sql-acl-${mode}` });
const runtimeDb = postgres(runtimeUrl, { max: 1, prepare: false, connect_timeout: 5, application_name: `bk01-runtime-acl-${mode}` });
const check = (name, ok, evidence = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${evidence ? ` — ${evidence}` : ''}`);
  if (!ok) throw new Error(`ACL gate failed: ${name}`);
};
const snapshot = () => db`
  select p.oid::regprocedure::text as identity,
         pg_get_userbyid(p.proowner) as owner,
         coalesce(p.proacl::text,'<default>') as acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('local_service','local_service_internal')
   order by 1`;
const runtimeSet = () => db`
  select p.oid::regprocedure::text as identity
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='local_service' and has_function_privilege('bk01_runtime',p.oid,'EXECUTE')
   order by 1`;
const callAsRuntime = () => runtimeDb.begin(async (runtimeTx) => {
  await runtimeTx.unsafe('SET LOCAL ROLE bk01_runtime');
  return runtimeTx`select * from local_service.claim_due_line_notifications(1)`;
});

try {
  const server = await db`select current_setting('server_version_num')::integer version,
    r.rolsuper, has_schema_privilege('bk01_migrator','extensions','USAGE') migrator_extensions,
    has_schema_privilege('public','extensions','USAGE') public_extensions
    from pg_roles r where r.rolname=current_user`;
  check('PG17 local operator is non-superuser and extension ACLs stay closed',
    server[0]?.version >= 170000 && server[0]?.version < 180000 && !server[0].rolsuper
      && !server[0].migrator_extensions && !server[0].public_extensions,
    JSON.stringify(server[0]));

  const current = await snapshot();
  const runtime = await runtimeSet();
  if (mode === 'baseline') {
    check('baseline runtime EXECUTE matches the exact approved set',
      validateBk01RuntimeEffectiveExecuteSet(runtime.map((row) => row.identity), 'pre-migration catalog'),
      `count=${runtime.length}`);
    await writeFile(snapshotPath, JSON.stringify(current, null, 2));
  } else if (mode === 'fail-before') {
    let error = '';
    try { await callAsRuntime(); } catch (cause) { error = String(cause.message); }
    check('fail-before b50bb38: real bk01_runtime call is denied', /permission denied/i.test(error), error);
    check('fail-before b50bb38: effective runtime set loses exactly one function',
      runtime.length === BK01_RUNTIME_EFFECTIVE_FUNCTIONS.length - 1
        && runtime.some((row) => row.identity === 'local_service.claim_due_line_notifications(integer)') === false,
      `count=${runtime.length}`);
  } else {
    const baseline = JSON.parse(await readFile(snapshotPath, 'utf8'));
    const before = new Map(baseline.map((row) => [row.identity, `${row.owner}|${row.execute_acl}`]));
    const after = new Map(current.map((row) => [row.identity, `${row.owner}|${row.acl}`]));
    if (mode === 'rollback') {
      const differences = [...before.keys()].filter((identity) => before.get(identity) !== after.get(identity))
        .concat([...after.keys()].filter((identity) => !before.has(identity)));
      check('rollback restores every function owner and EXECUTE ACL exactly to baseline',
        differences.length === 0, JSON.stringify(differences));
      check('rollback restores the exact bk01_runtime EXECUTE baseline',
        validateBk01RuntimeEffectiveExecuteSet(runtime.map((row) => row.identity), 'rollback catalog'),
        `count=${runtime.length}`);
    } else {
      const changed = [...before.keys()].filter((identity) => after.has(identity)
        && before.get(identity) !== after.get(identity));
      const removed = [...before.keys()].filter((identity) => !after.has(identity));
      const added = [...after.keys()].filter((identity) => !before.has(identity));
      check('final bk01_runtime EXECUTE matches exact approved baseline',
        validateBk01RuntimeEffectiveExecuteSet(runtime.map((row) => row.identity), 'post-migration catalog'),
        `count=${runtime.length}`);
      check('all retained product function ACLs are unchanged', changed.length === 0, JSON.stringify(changed));
      check('only declared policy-signature replacement was removed',
        JSON.stringify(removed) === JSON.stringify(['local_service.update_shop_settings(uuid,text,text,text,text,text,text)']),
        JSON.stringify(removed));
      check('only declared new SQL functions were added',
        added.length === 4 && added.includes('local_service.update_shop_settings(uuid,text,text,text,text,text,text,integer,integer)')
          && added.includes('local_service.record_deposit_refund(uuid,text,text)')
          && added.includes('local_service.get_deposit_refund_history(uuid)')
          && added.includes('local_service.get_booking_status(uuid,text)'), JSON.stringify(added));
      await callAsRuntime();
      check('pass-after: real bk01_runtime call to claim_due_line_notifications succeeds', true);
    }
  }
} finally {
  await Promise.all([db.end({ timeout: 5 }), runtimeDb.end({ timeout: 5 })]);
}
