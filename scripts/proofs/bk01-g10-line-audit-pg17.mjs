import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const mode = process.argv[2] ?? 'after';
const url = process.env.BK01_P0_LOCAL_URL;
const dir = process.env.BK01_P0_EVIDENCE_DIR;
if (!['baseline', 'after', 'rollback'].includes(mode)
  || process.env.BK01_SHARED_RUNTIME_ENV !== 'local'
  || !url || new URL(url).hostname !== '127.0.0.1' || !dir) {
  throw new Error('isolated loopback W-1 environment required');
}

const adminId = '98000000-0000-4000-8000-000000000001';
const shopId = '90000000-0000-4000-8000-000000000010';
const customerId = '98000000-0000-4000-8000-000000000002';
const lineRowId = '98000000-0000-4000-8000-000000000003';
const lineOld = `U${'a'.repeat(32)}`;
const lineNew = `U${'b'.repeat(32)}`;
const mk = (role) => postgres(url.replace(/\/\/[^@]+@/, `//${role}@`), {
  max: 2,
  prepare: false,
  onnotice: () => {},
  connection: { application_name: 'bk01-g10-line-audit-proof' },
});
const op = mk('operator');
const admin = mk('fixture_admin');
const runtimeProbe = mk('runtime_probe');
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const asRole = (db, role, fn, sub) => db.begin(async (tx) => {
  await tx.unsafe(`SET LOCAL ROLE ${role}`);
  if (sub) await tx`select set_config('request.jwt.claim.sub',${sub},true)`;
  return fn(tx);
});
const migrator = (fn, sub) => asRole(op, 'bk01_migrator', fn, sub);

try {
  const state = await migrator(async (tx) => ({
    table: (await tx`select to_regclass('local_service_internal.line_binding_audit')::text name`)[0].name,
    functions: await tx`select p.oid::regprocedure::text identity,
      pg_get_userbyid(p.proowner) owner,p.proacl::text acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('local_service','local_service_internal') order by 1`,
    triggers: await tx`select c.relname table_name,t.tgname,pg_get_triggerdef(t.oid) definition
      from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where not t.tgisinternal and n.nspname='local_service'
        and c.relname in ('line_users','customers')
        and (t.tgname like 'bk01_line_binding_audit%' or t.tgname like 'bk01_customer_line_binding_audit%')
      order by c.relname,t.tgname`,
  }));
  const triggerText = state.triggers.map((x) => `${x.table_name}:${x.definition}`).join(' ');
  const schemaReady = state.table === 'local_service_internal.line_binding_audit'
    && state.triggers.some((x) => x.table_name === 'line_users' && /INSERT|insert/.test(x.definition) && /UPDATE|update/.test(x.definition) && /DELETE|delete/.test(x.definition))
    && state.triggers.some((x) => x.table_name === 'customers' && /UPDATE OF line_user_id|UPDATE OF line_user_id/i.test(x.definition));
  if (mode === 'baseline') {
    record('G10 line binding audit ledger and table triggers exist before behavior checks', schemaReady, `table=${state.table ?? 'absent'}; triggers=${triggerText || 'none'}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'g10-line-audit-functions-before.json'), JSON.stringify(state.functions, null, 2));
  } else if (mode === 'rollback') {
    record('G10 line binding audit objects are fully removed by rollback', state.table === null && state.triggers.length === 0, `table=${state.table ?? 'absent'}; triggers=${state.triggers.length}`);
    const [migration] = await migrator((tx) => tx`select count(*)::int count from local_service_internal.schema_migrations where migration_id='20261002160000_bk01_g10_line_binding_audit'`);
    record('G10 rollback removes its migration ledger row', migration.count === 0, `rows=${migration.count}`);
  } else {
    record('G10 line_users has table-level INSERT/UPDATE/DELETE audit trigger', schemaReady && state.triggers.some((x) => x.table_name === 'line_users'), triggerText);
    record('G10 customers trigger is limited to line_user_id changes', schemaReady && state.triggers.some((x) => x.table_name === 'customers'), triggerText);
    const beforeFunctions = JSON.parse(fs.readFileSync(path.join(dir, 'g10-line-audit-functions-before.json'), 'utf8'));
    const currentFunctions = new Map(state.functions.map((row) => [row.identity, row]));
    const functionDelta = beforeFunctions.filter((row) => {
      const now = currentFunctions.get(row.identity);
      return !now || now.owner !== row.owner || now.acl !== row.acl;
    }).map((row) => row.identity);
    record('G10 migration preserves owner and EXECUTE ACLs for every existing function', functionDelta.length === 0, JSON.stringify(functionDelta));
    const [helperAcl] = await migrator((tx) => tx`select
      has_function_privilege('anon','local_service_internal.capture_line_binding_audit()','EXECUTE') anon_execute,
      has_function_privilege('authenticated','local_service_internal.capture_line_binding_audit()','EXECUTE') auth_execute,
      has_function_privilege('service_role','local_service_internal.capture_line_binding_audit()','EXECUTE') service_execute,
      has_function_privilege('bk01_runtime','local_service_internal.capture_line_binding_audit()','EXECUTE') runtime_execute`);
    record('G10 private trigger helper has no EXECUTE grants to client/runtime roles', !helperAcl.anon_execute && !helperAcl.auth_execute && !helperAcl.service_execute && !helperAcl.runtime_execute, JSON.stringify(helperAcl));

    const acl = await migrator((tx) => tx`
      select role_name, privilege_type
      from (values ('anon'),('authenticated'),('service_role'),('bk01_runtime')) roles(role_name)
      cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) priv(privilege_type)
      where has_table_privilege(roles.role_name,'local_service_internal.line_binding_audit',priv.privilege_type)
      order by 1,2`);
    record('G10 audit ledger grants no direct table privileges to client/runtime roles', acl.length === 0, JSON.stringify(acl));
    const [internalAccess] = await migrator((tx) => tx`select
      has_schema_privilege('anon','local_service_internal','USAGE') anon_usage,
      has_schema_privilege('authenticated','local_service_internal','USAGE') auth_usage,
      has_schema_privilege('service_role','local_service_internal','USAGE') service_usage,
      has_schema_privilege('bk01_runtime','local_service_internal','USAGE') runtime_usage,
      c.relrowsecurity rls,pg_get_userbyid(c.relowner) owner
      from pg_class c where c.oid='local_service_internal.line_binding_audit'::regclass`);
    record('G10 audit ledger schema boundary and RLS keep it private', !internalAccess.anon_usage && !internalAccess.auth_usage && !internalAccess.service_usage && !internalAccess.runtime_usage && internalAccess.rls && internalAccess.owner === 'bk01_migrator', JSON.stringify(internalAccess));

    await admin`insert into auth.users(id,email) values (${adminId}::uuid,'line-audit-test@example.invalid') on conflict (id) do nothing`;
    await admin`insert into local_service.platform_admins(user_id) values (${adminId}::uuid) on conflict (user_id) do nothing`;
    await migrator(async (tx) => {
      await tx`delete from local_service.line_users where id=${lineRowId}::uuid`;
      await tx`delete from local_service.customers where id=${customerId}::uuid`;
      await tx`delete from local_service_internal.line_binding_audit where row_id in (${customerId}::uuid,${lineRowId}::uuid)`;
      await tx`insert into local_service.customers(id,shop_id,name,phone,line_user_id)
        values (${customerId}::uuid,${shopId}::uuid,'Audit Fixture','0890000299',null)`;
      await tx`insert into local_service.line_users(id,shop_id,customer_id,line_user_id)
        values (${lineRowId}::uuid,${shopId}::uuid,${customerId}::uuid,${lineOld})`;
      await tx`update local_service.customers set line_user_id=${lineOld} where id=${customerId}::uuid`;
    }, adminId);

    await migrator(async (tx) => {
      const [identity] = await tx`select local_service_internal.request_user_id() user_id,local_service.is_platform_admin() is_admin`;
      if (identity.user_id !== adminId || identity.is_admin !== true) throw new Error('fixture admin identity did not resolve');
      await tx`update local_service.line_users set line_user_id=${lineNew} where id=${lineRowId}::uuid`;
      await tx`update local_service.customers set line_user_id=${lineNew} where id=${customerId}::uuid`;
      await tx`delete from local_service.line_users where id=${lineRowId}::uuid`;
    }, adminId);

    const rows = await migrator((tx) => tx`select table_name,operation,shop_id,row_id,customer_id,
      old_line_user_id,new_line_user_id,actor_user_id,actor_session_user,actor_effective_role
      from local_service_internal.line_binding_audit
      where row_id in (${customerId}::uuid,${lineRowId}::uuid)
      order by changed_at,id`);
    const lineOps = rows.filter((row) => row.table_name === 'line_users');
    record('G10 direct platform-admin line_users INSERT/UPDATE/DELETE persist old/new ID audit',
      lineOps.length === 3
        && lineOps.some((row) => row.operation === 'INSERT' && row.old_line_user_id === null && row.new_line_user_id === lineOld)
        && lineOps.some((row) => row.operation === 'UPDATE' && row.old_line_user_id === lineOld && row.new_line_user_id === lineNew)
        && lineOps.some((row) => row.operation === 'DELETE' && row.old_line_user_id === lineNew && row.new_line_user_id === null)
        && lineOps.every((row) => row.actor_user_id === adminId && row.shop_id === shopId && row.customer_id === customerId), JSON.stringify(lineOps));
    const customerOps = rows.filter((row) => row.table_name === 'customers');
    record('G10 direct platform-admin customers.line_user_id change stores actor and old/new IDs',
      customerOps.length === 2 && customerOps.some((row) => row.operation === 'UPDATE'
        && row.old_line_user_id === null && row.new_line_user_id === lineOld)
        && customerOps.some((row) => row.operation === 'UPDATE'
          && row.old_line_user_id === lineOld && row.new_line_user_id === lineNew)
        && customerOps.every((row) => row.actor_user_id === adminId && row.row_id === customerId && row.shop_id === shopId), JSON.stringify(customerOps));
    record('G10 audit records database login and effective operator role',
      rows.length === 5 && rows.every((row) => row.actor_session_user === 'operator' && row.actor_effective_role === 'bk01_migrator'),
      JSON.stringify(rows.map(({ table_name, operation, actor_session_user, actor_effective_role }) => ({ table_name, operation, actor_session_user, actor_effective_role }))));
    const piiKeys = await migrator((tx) => tx`select column_name from information_schema.columns
      where table_schema='local_service_internal' and table_name='line_binding_audit'
        and column_name in ('name','phone','email','line_display_name','line_picture_url','ip_address')`);
    record('G10 audit ledger stores no direct customer profile fields', piiKeys.length === 0, JSON.stringify(piiKeys));

    let runtimeDenied = false;
    let runtimeFailure = '';
    try {
      await asRole(runtimeProbe, 'bk01_runtime', (tx) => tx`insert into local_service_internal.line_binding_audit
        (table_name,operation,row_id) values ('customers','UPDATE',${customerId}::uuid)`);
    } catch (error) {
      runtimeDenied = /permission denied|42501/i.test(`${error.code ?? ''} ${error.message}`);
      runtimeFailure = `${error.code ?? ''} ${error.message}`;
    }
    record('G10 runtime direct write to audit ledger is rejected', runtimeDenied, runtimeFailure);

    const [runtimeCount] = await migrator((tx) => tx`select count(*)::int count from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='local_service' and has_function_privilege('bk01_runtime',p.oid,'EXECUTE')`);
    record('G10 migration adds no runtime RPC EXECUTE privilege', runtimeCount.count === 21, `effective runtime functions=${runtimeCount.count}`);
    await migrator(async (tx) => {
      await tx`delete from local_service_internal.line_binding_audit where row_id in (${customerId}::uuid,${lineRowId}::uuid)`;
      await tx`delete from local_service.line_users where id=${lineRowId}::uuid`;
      await tx`delete from local_service.customers where id=${customerId}::uuid`;
      await tx`delete from local_service_internal.line_binding_audit where row_id in (${customerId}::uuid,${lineRowId}::uuid)`;
    });
    await admin`delete from local_service.platform_admins where user_id=${adminId}::uuid`;
    await admin`delete from auth.users where id=${adminId}::uuid`;
  }
} finally {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `g10-line-audit-${mode}-results.json`), JSON.stringify(results, null, 2));
  await Promise.all([op, admin, runtimeProbe].map((db) => db.end()));
}

const failures = results.filter((result) => !result.ok);
if (failures.length > 0) {
  console.error(mode === 'baseline' ? 'Expected LINE audit assertions to be red before migration' : `${failures.length} G10 LINE audit checks failed`);
  process.exitCode = 1;
} else {
  console.log(mode === 'baseline' ? 'Unexpected green before audit migration' : `PASS ${results.length} ${mode} assertions`);
}
