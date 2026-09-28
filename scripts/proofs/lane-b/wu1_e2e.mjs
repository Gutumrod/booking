// WU-1 end-to-end proof on real Postgres (PGlite, embedded).
//
// This loads the ACTUAL frozen BK01 legacy chain (30 migrations) into a Postgres
// instance that carries a synthetic `auth` schema — then applies the GENERATED
// platform bootstrap and measures whether criterion (b) is actually fixed.
//
// Checks:
//   1. baseline: after the frozen chain + Junction A ownership transfer, a transferred
//      function fails with 42501 on schema auth            <- reproduces the defect
//   2. the generated bootstrap applies cleanly on real Postgres
//   3. the helper's behaviour table matches the shipped contract
//   4. the helper equals auth.uid() on every claim shape (including the error shape)
//   5. is_shop_member returns the CORRECT answer for a member and a non-member
//   6. no local_service function resolves schema auth afterwards
//   7. no bk01* role is a LOGIN
//   8. the helper is not executable by any Data API role
//
// No LAB. No network. No credential. PGlite is an embedded Postgres build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  BK01_RUNTIME_BOOTSTRAP_FUNCTIONS,
  BK01_PUBLIC_LEGACY_EXECUTE_EXCEPTIONS,
  BK01_RUNTIME_EFFECTIVE_FUNCTIONS,
  BK01_RUNTIME_ROUTE_FUNCTIONS,
  validateBk01RuntimeEffectiveExecuteSet,
} from '../../lib/bk01-runtime-allowlist.mjs';

const REPO = path.resolve(process.argv[2] || fileURLToPath(new URL('../../../', import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8').replace(/\r\n/g, '\n');
const proofOutputDir = process.env.BK01_PROOF_OUTPUT_DIR || path.join(REPO, 'supabase/shared-runtime');
const proofOutputPath = path.join(proofOutputDir, 'WU2-PGLITE-PROOF.json');
fs.mkdirSync(proofOutputDir, { recursive: true });

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`);
};

// Supabase's auth.uid(): resolves the JWT sub claim, returns uuid. The expression is
// byte-identical to the one the bootstrap's helper ships, so the equivalence check below
// is a real identity test rather than a comparison of two different implementations.
const AUTH_UID_BODY = `select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid`;
const AUTH_SCHEMA = `
  create schema auth;
  create table auth.users(id uuid primary key, email text);
  create or replace function auth.uid() returns uuid
  language sql stable as $authuid$
    ${AUTH_UID_BODY}
  $authuid$;
  revoke all on schema auth from public;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create role authenticator nologin noinherit;
`;

// Extension stubs: the live LAB has pgcrypto / uuid-ossp / btree_gist / pg_trgm
// installed. This embedded engine does not ship them, so the symbols the frozen chain
// actually calls are provided with equivalent semantics inside a real `extensions`
// schema. Nothing else is faked — the chain SQL itself runs verbatim.
const EXTENSION_STUBS = `
  create extension if not exists plpgsql;
  create schema if not exists extensions;
  grant usage on schema extensions to public;
  create or replace function extensions.gen_random_uuid() returns uuid
    language sql volatile as $$ select gen_random_uuid() $$;
  create or replace function extensions.gen_random_bytes(n integer) returns bytea
    language sql volatile as $$ select decode(repeat('ab', n), 'hex') $$;
  create or replace function extensions.uuid_generate_v4() returns uuid
    language sql volatile as $$ select gen_random_uuid() $$;
  -- Supabase keeps schema extensions on the default search_path, which is why the
  -- frozen chain calls uuid_generate_v4() unqualified. Mirror that resolution here.
  create or replace function public.gen_random_uuid() returns uuid
    language sql volatile as $$ select pg_catalog.gen_random_uuid() $$;
  create or replace function public.gen_random_bytes(n integer) returns bytea
    language sql volatile as $$ select decode(repeat('ab', n), 'hex') $$;
  create or replace function public.uuid_generate_v4() returns uuid
    language sql volatile as $$ select pg_catalog.gen_random_uuid() $$;
  -- PGlite lacks pgcrypto; this deterministic stub proves the stored hash shape,
  -- not production cryptographic strength or token verification by Storage.
  create or replace function extensions.digest(data bytea, algorithm text) returns bytea
    language sql immutable as $$ select decode(repeat('ab',32), 'hex') $$;
`;
const EXT_PRELUDE = `select 1;`;

// Supabase-managed surfaces that this embedded engine does not ship. Each is stubbed to
// the minimum the frozen chain needs (an object to grant on). Every substitution is
// listed in the proof output and in the report — none of them is a BK01 product object,
// so none of them affects what criterion (b) is measuring.
const MANAGED_STUBS = `
  create schema if not exists storage;
  create table if not exists storage.buckets(id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table if not exists storage.objects(id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[]
    language sql immutable as $$ select string_to_array(name, '/') $$;
  create or replace function storage.filename(name text) returns text
    language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name,'/'),1)] $$;
  -- PS01 product schemas: present on the shared LAB project (BK01 must be unable to
  -- reach them; the bootstrap asserts exactly that).
  create schema if not exists ps01;
  create schema if not exists ps01_internal;
  create schema if not exists mt01;
  create schema if not exists mt01_private;
  create schema if not exists wstera_platform_internal;
  create table if not exists ps01.runtime_boundary_probe(id integer primary key, note text);
  insert into ps01.runtime_boundary_probe values (1, 'stand-in') on conflict do nothing;
  create table if not exists mt01.runtime_boundary_probe(id integer primary key, note text);
  insert into mt01.runtime_boundary_probe values (1, 'stand-in') on conflict do nothing;
  create schema if not exists net;
  create table if not exists net.http_request_queue(id integer primary key);
  create schema if not exists cron;
  create table if not exists cron.job(jobid integer primary key);
`;
const MANAGED_STUB_NOTE = 'storage schema/tables (Supabase-managed; not BK01 objects)';

// Statements this embedded engine cannot express. Each is replaced with a no-op and
// named in the output — none of them is a BK01 product object or an auth.uid() use.
const SUBSTITUTIONS = [
  {
    note: 'create extension ... (pgcrypto / uuid-ossp / btree_gist / pg_trgm are pre-installed on LAB)',
    re: /create\s+extension\s+[\s\S]*?;/gi,
  },
  {
    note: 'EXCLUDE USING gist double-booking constraint (needs btree_gist, which this engine lacks; irrelevant to criterion (b))',
    re: /alter\s+table\s+local_service\.bookings\s*\n?\s*add\s+constraint\s+prevent_overlapping_staff_bookings[\s\S]*?;/gi,
  },
];

const db = new PGlite();
const q = async (sql) => (await db.query(sql)).rows;
const exec = (sql) => db.exec(sql);
const setSub = async (sub) => {
  const claims = sub === null ? '' : JSON.stringify({ sub });
  await exec(`select set_config('request.jwt.claims', '${claims}', false)`);
};

// A BK01 function has to be callable at all before the auth.uid() line is reachable,
// which means the migrator needs USAGE on local_service. Without it every call fails on
// the schema itself and the Junction A fingerprint is masked. Granting it here reproduces
// the state the Junction A run actually reached.
const grantSchemaUsage = () => exec(`grant usage on schema local_service to bk01_migrator;`);

// ---------------------------------------------------------------------------
// Phase 0 — build a LAB-shaped instance and run the real frozen chain
// ---------------------------------------------------------------------------
await exec(AUTH_SCHEMA);
await exec(EXT_PRELUDE);
await exec(EXTENSION_STUBS);
await exec(`create role bk01_migrator nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;`);
await exec(`create role bk01_runtime nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls noreplication;`);

const migrationDir = path.join(REPO, 'supabase/migrations');
const migrations = fs.readdirSync(migrationDir).filter((f) => f.endsWith('.sql')).sort();

// The frozen chain contains statements this embedded engine cannot express; only those
// are replaced, and the substitution list is printed with the proof.
await exec(MANAGED_STUBS);
console.log(`        stubbed managed surfaces: ${MANAGED_STUB_NOTE}`);
for (const s of SUBSTITUTIONS) console.log(`        substituted: ${s.note}`);

const chainErrors = [];
for (const file of migrations) {
  let sql = read(`supabase/migrations/${file}`);
  for (const s of SUBSTITUTIONS) sql = sql.replace(s.re, 'select 1;');
  try {
    await exec(sql);
  } catch (e) {
    chainErrors.push({ file, error: String(e.message).split('\n')[0] });
  }
}
record(
  'the real frozen BK01 chain (30 migrations) loads into Postgres',
  chainErrors.length === 0,
  chainErrors.length === 0
    ? `${migrations.length} files applied, 0 errors`
    : chainErrors.map((c) => `${c.file}: ${c.error}`).join(' | ').slice(0, 400),
);

if (chainErrors.length) {
  console.log('\nAborting: the chain did not load, later checks would be meaningless.');
  await db.close();
  process.exit(1);
}

// Active product migration stream. Applied only after the generated bootstrap has
// created the BK01 migrator boundary and transferred the frozen chain ownership.
const productMigrations = [
  'supabase/bk01-migrations/20260926120000_bk01_entitlement_packs.sql',
  'supabase/bk01-migrations/20260927120000_bk01_runtime_route_rpcs.sql',
  'supabase/bk01-migrations/20260927130000_bk01_trial_line_bind.sql',
];
const fnCount = (await q(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='local_service' and p.prokind='f'`))[0].n;
console.log(`        frozen chain produced ${fnCount} local_service functions`);

// Junction A shape: transfer every transferable function owner to bk01_migrator.
await exec(`
  grant bk01_migrator to postgres;
  do $$
  declare r record;
  begin
    for r in select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def,
                    pg_get_userbyid(p.proowner) as owner
             from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='local_service' and p.prokind='f'
    loop
      if r.def ilike '%auth.users%' or r.def ilike '%storage.%' then continue; end if;
      if r.owner = 'postgres' then execute format('alter function %s owner to bk01_migrator', r.sig); end if;
    end loop;
  end $$;
`);
const transferred = (await q(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='local_service' and p.prokind='f' and pg_get_userbyid(p.proowner)='bk01_migrator'`))[0].n;
console.log(`        after Junction A transfer: ${transferred} functions owned by bk01_migrator`);

await grantSchemaUsage();
await setSub('11111111-2222-3333-4444-555555555555');
await exec('set role bk01_migrator');
let preFailure = null;
try {
  await q(`select local_service.is_shop_member('00000000-0000-0000-0000-000000000000') as v`);
} catch (e) {
  preFailure = String(e.message).split('\n')[0];
}
await exec('reset role');
record(
  'BASELINE reproduces Junction A: a transferred function fails on auth.uid()',
  /permission denied for schema auth|42501/i.test(preFailure ?? ''),
  preFailure ?? 'no error raised — defect NOT reproduced',
);

// ---------------------------------------------------------------------------
// Phase 1 — apply the GENERATED bootstrap on the same instance
// ---------------------------------------------------------------------------
const bootstrap = read('supabase/shared-runtime/bk01-platform-bootstrap.sql');
const preBootstrapSnapshot = (await q(`select
  coalesce((select string_agg(member.rolname || '->' || granted.rolname || ':' || m.set_option || ':' || m.inherit_option, ',' order by 1)
    from pg_auth_members m join pg_roles member on member.oid=m.member join pg_roles granted on granted.oid=m.roleid
    where member.rolname in ('authenticator','bk01_runtime') or granted.rolname in ('authenticator','bk01_runtime')), '') as memberships,
  coalesce((select string_agg(grantee.rolname || ':' || n.nspname || ':' || acl.privilege_type, ',' order by 1)
    from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl
    join pg_roles grantee on grantee.oid=acl.grantee where grantee.rolname='bk01_runtime'), '') as schema_grants,
  coalesce((select string_agg(grantee.rolname || ':' || p.oid::regprocedure::text, ',' order by grantee.rolname, p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    join pg_roles grantee on grantee.oid=acl.grantee where grantee.rolname='bk01_runtime'), '') as function_grants`))[0];
let bootstrapError = null;
try {
  await exec(bootstrap);
} catch (e) {
  bootstrapError = String(e.message).split('\n')[0];
}
record(
  'generated bootstrap applies cleanly to a real Postgres with the real chain',
  bootstrapError === null,
  bootstrapError ?? `${bootstrap.length} bytes applied`,
);
if (bootstrapError !== null) {
  const effectiveFunctions = await q(`
    select p.oid::regprocedure::text as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='local_service' and p.prokind='f'
      and has_function_privilege('bk01_runtime',p.oid,'EXECUTE')
    order by 1
  `);
  const preRouteExpected = [...BK01_RUNTIME_BOOTSTRAP_FUNCTIONS, ...BK01_PUBLIC_LEGACY_EXECUTE_EXCEPTIONS].sort();
  const exact = JSON.stringify(effectiveFunctions.map((item) => item.signature).sort()) === JSON.stringify(preRouteExpected);
  record(
    'pre-migration bk01_runtime EXECUTE set equals exact five bootstrap RPCs plus eight fixed PUBLIC exceptions',
    exact,
    `expected=${preRouteExpected.length}; observed=${effectiveFunctions.length}; identities=${effectiveFunctions.map((item) => item.signature).join(', ')}`,
  );
  fs.writeFileSync(proofOutputPath,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      engine: 'pglite (embedded postgres)',
      subject: 'supabase/shared-runtime/bk01-platform-bootstrap.sql',
      frozen_chain_files: migrations.length,
      frozen_chain_functions: fnCount,
      junction_a_transferred_functions: transferred,
      checks: results,
      effective_runtime_execute_set: effectiveFunctions.map((item) => item.signature),
      bootstrap_error: bootstrapError,
    }, null, 2) + '\n', 'utf8');
  console.log(`wrote ${proofOutputPath}`);
  await db.close();
  process.exit(1);
}

const effectiveRuntimeSet = async () => (await q(`select p.oid::regprocedure::text as signature
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='local_service' and p.prokind='f'
    and has_function_privilege('bk01_runtime',p.oid,'EXECUTE') order by 1`)).map((row) => row.signature);
const preRouteRuntimeSet = await effectiveRuntimeSet();
const preRouteExpected = [...BK01_RUNTIME_BOOTSTRAP_FUNCTIONS, ...BK01_PUBLIC_LEGACY_EXECUTE_EXCEPTIONS].sort();
record('bootstrap accepts only the exact pre-route migration phase (5+8)',
  JSON.stringify(preRouteRuntimeSet.slice().sort()) === JSON.stringify(preRouteExpected),
  `expected=${preRouteExpected.length}; observed=${preRouteRuntimeSet.length}`);

// Verify the generated platform bootstrap rollback before any product migration
// has installed route RPC grants. Product migration grants are migration-owned.
const rollback = read('supabase/shared-runtime/bk01-platform-bootstrap-rollback.sql');
let rollbackError = null;
try { await exec(rollback); }
catch (e) { rollbackError = String(e.message).split('\n')[0]; }
const afterRollback = (await q(`select
  has_schema_privilege('bk01_runtime','local_service','USAGE') as schema_usage,
  has_function_privilege('bk01_runtime','local_service.claim_due_line_notifications(integer)','EXECUTE') as rpc_exec,
  exists(select 1 from pg_roles where rolname='bk01_migrator') as migrator_exists,
  exists(select 1 from pg_namespace where nspname='local_service_internal') as internal_schema_exists,
  exists(select 1 from pg_roles where rolname='bk01_runtime') as runtime_exists`))[0];
const postRollbackSnapshot = (await q(`select
  coalesce((select string_agg(member.rolname || '->' || granted.rolname || ':' || m.set_option || ':' || m.inherit_option, ',' order by 1)
    from pg_auth_members m join pg_roles member on member.oid=m.member join pg_roles granted on granted.oid=m.roleid
    where member.rolname in ('authenticator','bk01_runtime') or granted.rolname in ('authenticator','bk01_runtime')), '') as memberships,
  coalesce((select string_agg(grantee.rolname || ':' || n.nspname || ':' || acl.privilege_type, ',' order by 1)
    from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl
    join pg_roles grantee on grantee.oid=acl.grantee where grantee.rolname='bk01_runtime'), '') as schema_grants,
  coalesce((select string_agg(grantee.rolname || ':' || p.oid::regprocedure::text, ',' order by grantee.rolname, p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    join pg_roles grantee on grantee.oid=acl.grantee where grantee.rolname='bk01_runtime'), '') as function_grants`))[0];
record('platform bootstrap rollback removes only its pre-route grants and keeps runtime role',
  rollbackError === null && afterRollback.schema_usage === false && afterRollback.rpc_exec === false
    && afterRollback.migrator_exists === false && afterRollback.internal_schema_exists === false
    && afterRollback.runtime_exists === true
    && JSON.stringify(postRollbackSnapshot) === JSON.stringify(preBootstrapSnapshot),
  rollbackError ?? `${JSON.stringify(afterRollback)}; snapshot restored=${JSON.stringify(postRollbackSnapshot) === JSON.stringify(preBootstrapSnapshot)}`);

let rebootstrapError = null;
try { await exec(bootstrap); }
catch (e) { rebootstrapError = String(e.message).split('\n')[0]; }
const rebootstrapSet = await effectiveRuntimeSet();
record('platform bootstrap reapplies cleanly after its rollback', rebootstrapError === null
  && JSON.stringify(rebootstrapSet.slice().sort()) === JSON.stringify(preRouteExpected),
  rebootstrapError ?? `runtime EXECUTE identities=${rebootstrapSet.length}`);

// Apply the active product stream through the bootstrapped migrator identity, in
// timestamp order. The runtime boundary becomes exact 11+8 only after this commit.
const productErrors = [];
await exec('set role bk01_migrator');
for (const file of productMigrations) {
  try { await exec(read(file)); }
  catch (e) { productErrors.push({ file, error: String(e.message).split('\n')[0] }); break; }
  if (file.endsWith('20260927120000_bk01_runtime_route_rpcs.sql')) {
    await exec('reset role');
    let wubBootstrapError = null;
    try { await exec(bootstrap); }
    catch (e) { wubBootstrapError = String(e.message).split('\n')[0]; }
    const wubRuntimeSet = await effectiveRuntimeSet();
    const wubExpected = [
      ...BK01_RUNTIME_BOOTSTRAP_FUNCTIONS,
      ...BK01_RUNTIME_ROUTE_FUNCTIONS.filter((identity) => !identity.includes('bk01_line_bind_booking_trial')),
      ...BK01_PUBLIC_LEGACY_EXECUTE_EXCEPTIONS,
    ].sort();
    record('bootstrap accepts the exact WU-B-only migration phase (10+8)',
      wubBootstrapError === null && JSON.stringify(wubRuntimeSet.slice().sort()) === JSON.stringify(wubExpected),
      wubBootstrapError ?? `expected=${wubExpected.length}; observed=${wubRuntimeSet.length}`);
    if (wubBootstrapError !== null) productErrors.push({ file: 'generated bootstrap at WU-B phase', error: wubBootstrapError });
    await exec('set role bk01_migrator');
  }
}
await exec('reset role');
record('Swarm-1 and WU-B product migrations apply after frozen chain and bootstrap',
  productErrors.length === 0,
  productErrors.length ? productErrors.map((e) => `${e.file}: ${e.error}`).join(' | ') : productMigrations.join(' → '));
if (productErrors.length) {
  await db.close();
  process.exit(1);
}

const actualRuntimeSet = await effectiveRuntimeSet();
let exactRuntimeSet = true;
try { validateBk01RuntimeEffectiveExecuteSet(actualRuntimeSet); } catch { exactRuntimeSet = false; }
record('post-migration bk01_runtime EXECUTE identities equal exact 11+8 allowlist', exactRuntimeSet,
  `expected=${BK01_RUNTIME_EFFECTIVE_FUNCTIONS.length}; observed=${actualRuntimeSet.length}`);
const publicRouteReach = await q(`select p.oid::regprocedure::text as signature,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_exec,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_exec,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_exec,
  has_function_privilege('bk01_runtime',p.oid,'EXECUTE') as runtime_exec
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='local_service' and p.oid::regprocedure::text = any(array[
    ${BK01_RUNTIME_ROUTE_FUNCTIONS.map((identity) => `'${identity}'`).join(',')}
  ]) order by 1`);
record('anon and authenticated cannot EXECUTE any of the six route RPCs',
  publicRouteReach.length === 6 && publicRouteReach.every((row) => !row.anon_exec && !row.authenticated_exec
    && !row.service_role_exec && row.runtime_exec),
  `checked=${publicRouteReach.length}; anon=${publicRouteReach.filter((row) => row.anon_exec).length}; authenticated=${publicRouteReach.filter((row) => row.authenticated_exec).length}; service_role=${publicRouteReach.filter((row) => row.service_role_exec).length}; runtime=${publicRouteReach.filter((row) => row.runtime_exec).length}`);

await exec('create function local_service.wu2_extra_probe() returns integer language sql as $$ select 1 $$');
await exec('grant execute on function local_service.wu2_extra_probe() to public');
let publicProbeRejected = false;
try { validateBk01RuntimeEffectiveExecuteSet(await effectiveRuntimeSet(), '9th PUBLIC function probe'); }
catch { publicProbeRejected = true; }
await exec('revoke execute on function local_service.wu2_extra_probe() from public');
record('non-vacuity rejects a 9th PUBLIC-executable function', publicProbeRejected,
  'temporary local_service.wu2_extra_probe() PUBLIC grant was detected then removed');

await exec('grant execute on function local_service.wu2_extra_probe() to bk01_runtime');
let explicitProbeRejected = false;
try { validateBk01RuntimeEffectiveExecuteSet(await effectiveRuntimeSet(), '12th explicit route RPC identity'); }
catch { explicitProbeRejected = true; }
await exec('revoke execute on function local_service.wu2_extra_probe() from bk01_runtime; drop function local_service.wu2_extra_probe()');
record('non-vacuity rejects a 12th explicit bk01_runtime RPC grant', explicitProbeRejected,
  'temporary direct grant was detected then revoked');

// ---------------------------------------------------------------------------
// Phase 2 + 3 — helper contract + equivalence with auth.uid()
// ---------------------------------------------------------------------------
const contract = JSON.parse(read('supabase/shared-runtime/bk01-request-helper-contract.json'));
const helper = contract.helper.replace('()', '');
const run = async (expr) => {
  try { return { v: (await q(`select ${expr} as v`))[0].v, e: null }; }
  catch (e) { return { v: null, e: String(e.message).split('\n')[0] }; }
};

const observed = [];
for (const c of contract.cases) {
  await exec(`select set_config('request.jwt.claims', ${c.setting === null ? "''" : `'${c.setting}'`}, false)`);
  const h = await run(`${helper}()`);
  observed.push({ case: c.case, declared: c.fail_closed ? 'error' : (c.expected === null ? null : String(c.expected)),
    actual: h.e ? 'error' : (h.v === null ? null : String(h.v)), raised: h.e });
}
record(
  'helper behaviour table matches the shipped contract (all 7 cases)',
  observed.every((o) => (o.declared === 'error' ? o.actual === 'error' : o.declared === o.actual)),
  observed.map((o) => `${o.case}=${o.actual === 'error' ? 'ERROR' : String(o.actual)}`).join('  '),
);
record(
  'helper fails closed on a malformed (non-uuid) claim',
  observed.find((o) => o.case === 'sub_not_uuid')?.actual === 'error',
  observed.find((o) => o.case === 'sub_not_uuid')?.raised ?? 'NO ERROR — not fail-closed',
);

const equivalence = [];
for (const c of contract.cases) {
  await exec(`select set_config('request.jwt.claims', ${c.setting === null ? "''" : `'${c.setting}'`}, false)`);
  const a = await run('auth.uid()');
  const h = await run(`${helper}()`);
  const an = a.e ? 'ERROR' : String(a.v);
  const hn = h.e ? 'ERROR' : String(h.v);
  equivalence.push({ case: c.case, auth_uid: an, helper: hn, equal: an === hn });
}
record(
  'helper equals auth.uid() on every claim shape',
  equivalence.every((e) => e.equal),
  equivalence.map((e) => `${e.case}:${e.equal ? '=' : 'DIFF(' + e.auth_uid + ' vs ' + e.helper + ')'}`).join('  '),
);

// ---------------------------------------------------------------------------
// Phase 4 — the rewritten functions actually work as bk01_migrator
// ---------------------------------------------------------------------------
await setSub('11111111-2222-3333-4444-555555555555');
const shopId = '00000000-0000-0000-0000-000000000001';
const ownerId = '11111111-2222-3333-4444-555555555555';
const otherId = '99999999-9999-9999-9999-999999999999';
// shop_users.role is NOT NULL CHECK (role IN ('owner','admin','staff')), and shops.slug
// is UNIQUE, so the fixture has to be shaped like a real shop membership.
await exec(`
  insert into auth.users(id, email) values ('${ownerId}', 'probe-owner@example.invalid')
    on conflict (id) do nothing;
  insert into local_service.shops(id, name, slug) values ('${shopId}', 'probe shop', 'probe-shop')
    on conflict (id) do nothing;
  insert into local_service.shop_users(shop_id, user_id, role)
    values ('${shopId}', '${ownerId}', 'owner') on conflict do nothing;
`);
await exec(`grant select on all tables in schema local_service to bk01_migrator;`);

await exec('set role bk01_migrator');
await setSub('11111111-2222-3333-4444-555555555555');
const memberCall = await run(`local_service.is_shop_member('${shopId}')`);
await setSub('99999999-9999-9999-9999-999999999999');
const nonMemberCall = await run(`local_service.is_shop_member('${shopId}')`);
await exec('reset role');
record(
  'rewritten is_shop_member works as bk01_migrator and returns the correct answer',
  memberCall.v === true && nonMemberCall.v === false,
  `member=${memberCall.e ?? memberCall.v}  non-member=${nonMemberCall.e ?? nonMemberCall.v}`,
);

// every rewritten identity must at least reach execution without a schema-auth error
await exec('set role bk01_migrator');
const perFn = [];
for (const identity of contract.rewritten_identities) {
  const argc = identity.includes('()') ? 0 : (identity.match(/,/g) ?? []).length + 1;
  const args = Array.from({ length: argc }, () => 'null').join(',');
  const call = `select ${identity.replace(/\(.*/, '')}(${args})`;
  const r = await run(call);
  perFn.push({ identity, error: r.e });
}
await exec('reset role');
const authErrors = perFn.filter((f) => /permission denied for schema auth|42501/i.test(f.error ?? ''));
record(
  'no rewritten function raises 42501 on schema auth',
  authErrors.length === 0,
  authErrors.length === 0
    ? `${contract.rewritten_identities.length} identities exercised; non-auth errors (NULL args) = ${perFn.filter((f) => f.error).length}`
    : authErrors.map((f) => f.identity).join(', ').slice(0, 300),
);

// ---------------------------------------------------------------------------
// Phase 5 — structural invariants after the bootstrap
// ---------------------------------------------------------------------------
// What must hold: every TRANSFERRED function (i.e. everything that is not a declared
// ownership exception) is free of schema auth. The declared exceptions keep their
// shared-surface dependency on purpose — that is the reviewed Owner decision, not a leak.
const contractForExceptions = JSON.parse(read('supabase/shared-runtime/bk01-request-helper-contract.json'));
const exceptions = contractForExceptions.ownership_exception_identities;
const authDeps = await q(`
  select p.oid::regprocedure::text as signature
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'local_service'
    and p.prosrc ~ '(^|[^a-zA-Z0-9_])auth[[:space:]]*\\.[[:space:]]*(uid|users|identities|sessions|refresh_tokens)'
`);
const stragglers = authDeps.filter((r) => !exceptions.includes(r.signature));
record(
  'no TRANSFERRED local_service function resolves schema auth after the bootstrap',
  stragglers.length === 0,
  stragglers.length
    ? stragglers.map((r) => r.signature).slice(0, 6).join(', ')
    : `catalog scan clean; declared exceptions still carrying auth.users by design = ${authDeps.length}`,
);

// And the declared exceptions must be exactly the measured auth.users/storage set —
// nothing silently added, nothing silently dropped.
const measuredShared = await q(`
  select p.oid::regprocedure::text as signature
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'local_service'
    and (p.prosrc ~ '(^|[^a-zA-Z0-9_])auth[[:space:]]*\\.[[:space:]]*users' or p.prosrc ~ '(^|[^a-zA-Z0-9_])storage[[:space:]]*\\.')
`);
const measuredSet = measuredShared.map((r) => r.signature).sort();
const declaredSet = [...exceptions].sort();
record(
  'the declared ownership-exception inventory equals the measured shared-surface set',
  JSON.stringify(measuredSet) === JSON.stringify(declaredSet),
  `declared=${declaredSet.length} measured=${measuredSet.length}` +
    (JSON.stringify(measuredSet) === JSON.stringify(declaredSet) ? '' : ` | measured=${measuredSet.join(', ')}`),
);

const roles = await q(`select rolname, rolcanlogin from pg_roles where rolname like 'bk01%' order by rolname`);
record(
  'no bk01* role is a LOGIN role',
  roles.length > 0 && roles.every((r) => !r.rolcanlogin),
  roles.map((r) => `${r.rolname}(canlogin=${r.rolcanlogin})`).join(' '),
);

const acl = await q(`select has_function_privilege('anon', '${contract.helper}', 'EXECUTE') as anon_exec,
  has_function_privilege('authenticated', '${contract.helper}', 'EXECUTE') as authed_exec,
  has_function_privilege('service_role', '${contract.helper}', 'EXECUTE') as svc_exec`);
record(
  'helper is not executable by any Data API role',
  !acl[0].anon_exec && !acl[0].authed_exec && !acl[0].svc_exec,
  JSON.stringify(acl[0]),
);

// ---------------------------------------------------------------------------
// WU-2 — runtime role boundary, negative matrix and rollback.
// ---------------------------------------------------------------------------
const runtimeFunctions = [
  ['local_service.authorize_booking_recovery_attempt', "'00000000-0000-0000-0000-000000000001'::uuid, 'invalid'::text"],
  ['local_service.claim_due_line_notifications', '1::integer'],
  ['local_service.claim_stripe_webhook_event', "'wu2-proof'::text, 'proof'::text, now()"],
  ['local_service.complete_line_notification', "'00000000-0000-0000-0000-000000000001'::uuid, 1::integer, 'failed'::text, null::timestamptz, null::timestamptz, 'proof'::text"],
  ['local_service.sync_subscription_state_bk_a', "'customer.subscription.updated'::text, 1::bigint, null::uuid, null::text, null::text, null::text, null::text, null::bigint, null::boolean"],
  ['local_service.authorize_deposit_slip_upload', "null::uuid, null::text, 'image/png'::text, 1::bigint"],
  ['local_service.bk01_finish_line_webhook_delivery', "null::text, null::uuid, 'processed'::text, null::text"],
  ['local_service.bk01_line_bind_booking', "null::text, null::text, null::text, null::uuid, null::text"],
  ['local_service.bk01_line_bind_booking_trial', "null::text, null::text, null::text, null::text"],
  ['local_service.finish_stripe_webhook_event', "null::text, 'processed'::text, null::text"],
  ['local_service.get_line_notification_delivery_context', 'null::uuid, null::integer'],
];

// Minimal owned fixtures for positive and negative SQL-level route contract checks.
await setSub(ownerId);
await exec(`
  update local_service.shops set line_oa_id='probe-line-oa' where id='${shopId}';
  insert into local_service.customers(id,shop_id,name,phone)
    values ('00000000-0000-0000-0000-000000000002','${shopId}','Probe Customer','0812345678');
  insert into local_service.services(id,shop_id,name,duration_minutes,price)
    values ('00000000-0000-0000-0000-000000000003','${shopId}','Probe Service',30,100);
  insert into local_service.bookings(id,shop_id,customer_id,service_id,booking_date,start_time,end_time,
      status,deposit_status,total_price,booking_code,link_token,link_token_expires_at,expires_at)
    values ('00000000-0000-0000-0000-000000000004','${shopId}',
      '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',
      current_date,'10:00','10:30','hold','awaiting',100,'PROBE-BOOKING','TOKEN-123',now()+interval '1 hour',now()+interval '1 hour');
  insert into local_service.shops(id,name,slug,line_oa_id)
    values ('00000000-0000-0000-0000-000000000011','Trial Probe Shop','trial-probe-shop',null);
  insert into local_service.customers(id,shop_id,name,phone)
    values ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000011','Trial Probe Customer','0899999999');
  insert into local_service.services(id,shop_id,name,duration_minutes,price)
    values ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000011','Trial Probe Service',30,100);
  insert into local_service.bookings(id,shop_id,customer_id,service_id,booking_date,start_time,end_time,
      status,deposit_status,total_price,booking_code,link_token,link_token_expires_at,expires_at)
    values ('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000011',
      '00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013',
      current_date,'11:00','11:30','hold','awaiting',100,'TRIAL-PROBE','TRIAL12345',now()+interval '1 hour',now()+interval '1 hour');
  insert into local_service.bookings(id,shop_id,customer_id,service_id,booking_date,start_time,end_time,
      status,deposit_status,total_price,booking_code,link_token,link_token_expires_at,expires_at)
    values ('00000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000011',
      '00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013',
      current_date,'12:00','12:30','confirmed','not_required',100,'TRIAL-TOKEN-EXPIRED','EXPIRE1234',now()-interval '1 hour',null);
  insert into local_service.bookings(id,shop_id,customer_id,service_id,booking_date,start_time,end_time,
      status,deposit_status,total_price,booking_code,link_token,link_token_expires_at,expires_at)
    values ('00000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000011',
      '00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013',
      current_date,'13:00','13:30','hold','awaiting',100,'TRIAL-HOLD-EXPIRED','HOLD123456',now()+interval '1 hour',now()-interval '1 minute');
  insert into local_service.stripe_webhook_events(id,type,created_at,processing_status,processing_started_at)
    values ('evt-probe-finish','customer.subscription.updated',now(),'processing',now());
  insert into local_service.line_notification_logs(id,shop_id,booking_id,event_type,recipient_type,status,
      attempt_count,scheduled_for)
    values ('00000000-0000-0000-0000-000000000005','${shopId}',
      '00000000-0000-0000-0000-000000000004','booking_created','customer','pending',1,now());
  insert into local_service.subscriptions(shop_id,stripe_customer_id,stripe_subscription_id,plan,status)
    values ('${shopId}','cus-probe','sub-probe','basic_490','trialing')
    on conflict (shop_id) do update set stripe_customer_id='cus-probe',
      stripe_subscription_id='sub-probe',plan='basic_490',status='trialing';
`);
await exec('set role authenticator; set role bk01_runtime;');
const runtimeCaller = (await q('select current_user as role'))[0].role;
const loginState = (await q("select rolcanlogin from pg_roles where rolname='bk01_runtime'"))[0].rolcanlogin;
record(
  'bk01_runtime is NOLOGIN while authenticator can SET ROLE to it',
  runtimeCaller === 'bk01_runtime' && loginState === false,
  `current_user=${runtimeCaller}; rolcanlogin=${loginState}; direct credential handshake is not available in PGlite`,
);

const runtimeFunctionResults = [];
for (const [name, args] of runtimeFunctions) {
  try {
    await q(`select ${name}(${args})`);
    runtimeFunctionResults.push({ name, ok: true, error: null });
  } catch (e) {
    const error = String(e.message).split('\n')[0];
    runtimeFunctionResults.push({ name, ok: !/permission denied|42501/i.test(error), error });
  }
}
record(
  'bk01_runtime can EXECUTE each of its eleven allowlisted RPCs',
  runtimeFunctionResults.every((item) => item.ok),
  runtimeFunctionResults.map((item) => `${item.name}: ${item.ok ? 'callable' : item.error}`).join(' | '),
);

const probeRun = async (sql) => {
  try { return { rows: await q(sql), error: null }; }
  catch (e) { return { rows: null, error: String(e.message).split('\n')[0] }; }
};
const adminQuery = async (sql) => {
  await exec('reset role');
  const rows = await q(sql);
  await exec('set role authenticator; set role bk01_runtime');
  return rows;
};
const lineArgs = `'line-event-proof'::text,'PROBE-BOOKING'::text,'TOKEN-123'::text,'${shopId}'::uuid,'U${'a'.repeat(32)}'::text`;
const lineFirst = await probeRun(`select * from local_service.bk01_line_bind_booking(${lineArgs})`);
const lineReplay = await probeRun(`select * from local_service.bk01_line_bind_booking(${lineArgs})`);
const lineBadId = await probeRun(`select * from local_service.bk01_line_bind_booking('bad-id','PROBE-BOOKING','TOKEN-123','${shopId}','bad-user')`);
const finishLine = lineFirst.rows?.[0]?.lease_token
  ? await probeRun(`select local_service.bk01_finish_line_webhook_delivery('line-event-proof','${lineFirst.rows[0].lease_token}','processed',null) as done`)
  : { rows: null, error: 'LINE bind did not return lease token' };
const replayLineFinish = lineFirst.rows?.[0]?.lease_token
  ? await probeRun(`select local_service.bk01_finish_line_webhook_delivery('line-event-proof','${lineFirst.rows[0].lease_token}','failed','retry') as done`)
  : { rows: null, error: 'LINE bind did not return lease token' };
const lineEventDebug = (await adminQuery(`select processing_status,last_error,booking_id,shop_id,lease_token from local_service.line_webhook_events where webhook_event_id='line-event-proof'`))[0];
const lineEvents = lineEventDebug ? 1 : 0;
record('LINE webhookEventId binds once, replay is suppressed, malformed LINE identity fails, lease cannot finish twice',
  lineFirst.rows?.[0]?.claimed === true && lineReplay.rows?.[0]?.claimed === false
    && lineBadId.error !== null && finishLine.rows?.[0]?.done === true
    && replayLineFinish.rows?.[0]?.done === false && lineEvents === 1,
  `first=${lineFirst.rows?.[0]?.claimed}; firstError=${lineFirst.error}; replay=${lineReplay.rows?.[0]?.claimed}; badIdentity=${lineBadId.error !== null}; finish=${finishLine.rows?.[0]?.done}; finishReplay=${replayLineFinish.rows?.[0]?.done}; event=${JSON.stringify(lineEventDebug)}`);

const trialUserId = `U${'b'.repeat(32)}`;
const trialBindArgs = (eventId, lineUserId = trialUserId) =>
  `'${eventId}'::text,'TRIAL-PROBE'::text,'TRIAL12345'::text,'${lineUserId}'::text`;
const trialBadToken = await probeRun(`select * from local_service.bk01_line_bind_booking_trial('trial-bad-token','TRIAL-PROBE','WRONG12345','${trialUserId}')`);
await adminQuery(`update local_service.shops set line_oa_id='trial-probe-owned-oa' where id='00000000-0000-0000-0000-000000000011'`);
const trialMerchantShop = await probeRun(`select * from local_service.bk01_line_bind_booking_trial(${trialBindArgs('trial-merchant-shop')})`);
await adminQuery(`update local_service.shops set line_oa_id=null where id='00000000-0000-0000-0000-000000000011'`);
const trialBadLineId = await probeRun(`select * from local_service.bk01_line_bind_booking_trial('trial-bad-line-id','TRIAL-PROBE','TRIAL12345','bad-id')`);
const trialExpiredToken = await probeRun(`select * from local_service.bk01_line_bind_booking_trial('trial-expired-token','TRIAL-TOKEN-EXPIRED','EXPIRE1234','${trialUserId}')`);
const trialExpiredHold = await probeRun(`select * from local_service.bk01_line_bind_booking_trial('trial-expired-hold','TRIAL-HOLD-EXPIRED','HOLD123456','${trialUserId}')`);
const trialFirst = await probeRun(`select * from local_service.bk01_line_bind_booking_trial(${trialBindArgs('trial-line-event')})`);
const trialReplay = await probeRun(`select * from local_service.bk01_line_bind_booking_trial(${trialBindArgs('trial-line-event')})`);
const trialFinishFailed = trialFirst.rows?.[0]?.lease_token
  ? await probeRun(`select local_service.bk01_finish_line_webhook_delivery('trial-line-event','${trialFirst.rows[0].lease_token}','failed','LINE reply unavailable') as done`)
  : { rows: null, error: 'Trial LINE bind did not return lease token' };
const trialRetry = await probeRun(`select * from local_service.bk01_line_bind_booking_trial(${trialBindArgs('trial-line-event')})`);
const trialFinishProcessed = trialRetry.rows?.[0]?.lease_token
  ? await probeRun(`select local_service.bk01_finish_line_webhook_delivery('trial-line-event','${trialRetry.rows[0].lease_token}','processed',null) as done`)
  : { rows: null, error: 'Trial LINE retry did not return lease token' };
const trialSecondEvent = await probeRun(`select * from local_service.bk01_line_bind_booking_trial(${trialBindArgs('trial-line-event-2')})`);
  const trialPersisted = (await adminQuery(`select b.line_binding_token_used_at is not null as token_used,
  b.line_binding_webhook_event_id, c.line_user_id, s.line_oa_id
  from local_service.bookings b join local_service.customers c on c.id=b.customer_id
  join local_service.shops s on s.id=b.shop_id where b.id='00000000-0000-0000-0000-000000000014'`))[0];
record('trial binding requires matching token and central OA, consumes once, dedupes event IDs, and permits same-event delivery retry',
  trialBadToken.rows?.[0]?.claimed === false && trialMerchantShop.rows?.[0]?.claimed === false
    && trialBadLineId.error !== null && trialExpiredToken.rows?.[0]?.claimed === false
    && trialExpiredHold.rows?.[0]?.claimed === false && trialFirst.rows?.[0]?.claimed === true
    && trialReplay.rows?.[0]?.claimed === false && trialFinishFailed.rows?.[0]?.done === true
    && trialRetry.rows?.[0]?.claimed === true && trialFinishProcessed.rows?.[0]?.done === true
    && trialSecondEvent.rows?.[0]?.claimed === false && trialPersisted?.token_used === true
    && trialPersisted?.line_binding_webhook_event_id === 'trial-line-event'
    && trialPersisted?.line_user_id === trialUserId && trialPersisted?.line_oa_id === null
    && trialFirst.rows?.[0]?.booking_context?.shop_name === 'Trial Probe Shop'
    && !('customer_name' in (trialFirst.rows?.[0]?.booking_context ?? {})),
  `badToken=${trialBadToken.rows?.[0]?.claimed}; merchantShop=${trialMerchantShop.rows?.[0]?.claimed}; badLineId=${trialBadLineId.error !== null}; expiredToken=${trialExpiredToken.rows?.[0]?.claimed}; expiredHold=${trialExpiredHold.rows?.[0]?.claimed}; first=${trialFirst.rows?.[0]?.claimed}; replay=${trialReplay.rows?.[0]?.claimed}; failedFinish=${trialFinishFailed.rows?.[0]?.done}; retry=${trialRetry.rows?.[0]?.claimed}; processedFinish=${trialFinishProcessed.rows?.[0]?.done}; secondEvent=${trialSecondEvent.rows?.[0]?.claimed}; persisted=${JSON.stringify(trialPersisted)}`);

const notificationAttempt = (await adminQuery(`select attempt_count from local_service.line_notification_logs where id='00000000-0000-0000-0000-000000000005'`))[0]?.attempt_count ?? 1;
const contextOk = await probeRun(`select * from local_service.get_line_notification_delivery_context('00000000-0000-0000-0000-000000000005',${notificationAttempt})`);
const contextStale = await probeRun(`select * from local_service.get_line_notification_delivery_context('00000000-0000-0000-0000-000000000005',${notificationAttempt + 1})`);
record('notification context returns only the matching pending attempt',
  contextOk.rows?.length === 1 && contextStale.rows?.length === 0,
  `attempt=${notificationAttempt}; matching=${contextOk.rows?.length ?? 'error'}; stale=${contextStale.rows?.length ?? 'error'}`);

const upload = await probeRun(`select * from local_service.authorize_deposit_slip_upload('00000000-0000-0000-0000-000000000004','TOKEN-123','image/png',1024)`);
const uploadGrant = upload.rows?.[0];
const storedGrant = uploadGrant ? (await adminQuery(`select object_path,content_type,size_bytes,expires_at,
  length(grant_token_hash)=64 as token_hash_shape
  from local_service.deposit_slip_upload_grants where id='${uploadGrant.grant_id}'`))[0] : null;
const uploadBadMime = await probeRun(`select * from local_service.authorize_deposit_slip_upload('00000000-0000-0000-0000-000000000004','TOKEN-123','text/plain',1024)`);
const uploadBadSize = await probeRun(`select * from local_service.authorize_deposit_slip_upload('00000000-0000-0000-0000-000000000004','TOKEN-123','image/png',5242881)`);
await adminQuery(`update local_service.bookings set status='pending_review' where id='00000000-0000-0000-0000-000000000004'`);
const uploadWrongState = await probeRun(`select * from local_service.authorize_deposit_slip_upload('00000000-0000-0000-0000-000000000004','TOKEN-123','image/png',1024)`);
const uploadPathParts = uploadGrant?.object_path.split('/') ?? [];
const uploadPathMatches = uploadPathParts[0] === '00000000-0000-0000-0000-000000000004'
  && /^[0-9a-f-]{36}\.png$/.test(uploadPathParts[1] ?? '');
const uploadExpiryValid = uploadGrant && Date.parse(uploadGrant.expires_at) > Date.now()
  && Date.parse(uploadGrant.expires_at) <= Date.now() + 5 * 60_000;
record('upload RPC derives exact booking path and records MIME/size/token hash/TTL; invalid type and size fail',
  Boolean(uploadGrant && storedGrant?.object_path === uploadGrant.object_path
    && uploadPathMatches
    && storedGrant.content_type === 'image/png' && Number(storedGrant.size_bytes) === 1024
    && storedGrant.token_hash_shape && uploadExpiryValid
    && uploadBadMime.error !== null && uploadBadSize.error !== null && uploadWrongState.error !== null),
  `issued=${Boolean(uploadGrant)}; stored=${JSON.stringify(storedGrant)}; path=${uploadGrant?.object_path ?? upload.error}; pathMatch=${uploadPathMatches}; expiryValid=${uploadExpiryValid}; badMime=${uploadBadMime.error !== null}; badSize=${uploadBadSize.error !== null}; wrongState=${uploadWrongState.error !== null}; DB-only proof does not test Storage consume/replay`);

const stripeFirst = await probeRun(`select * from local_service.sync_subscription_state_bk_a('customer.subscription.updated',1750000000,'${shopId}','cus-probe','sub-probe','basic_490','active',1752592000,false)`);
const stripeState1 = (await adminQuery(`select s.plan,s.status,s.current_period_end,s.cancel_at_period_end,s.last_stripe_event_created_at,
  sh.subscription_status from local_service.subscriptions s join local_service.shops sh on sh.id=s.shop_id where s.shop_id='${shopId}'`))[0];
const stripeSecond = await probeRun(`select * from local_service.sync_subscription_state_bk_a('customer.subscription.updated',1750000000,'${shopId}','cus-probe','sub-probe','basic_490','active',1752592000,false)`);
const stripeState2 = (await adminQuery(`select s.plan,s.status,s.current_period_end,s.cancel_at_period_end,s.last_stripe_event_created_at,
  sh.subscription_status from local_service.subscriptions s join local_service.shops sh on sh.id=s.shop_id where s.shop_id='${shopId}'`))[0];
record('same Stripe event applied twice preserves identical subscription business state',
  stripeFirst.rows?.[0]?.out_applied === true && stripeSecond.rows?.[0]?.out_applied === true
    && JSON.stringify(stripeState1) === JSON.stringify(stripeState2),
  `first=${stripeFirst.rows?.[0]?.out_applied}; second=${stripeSecond.rows?.[0]?.out_applied}; state_equal=${JSON.stringify(stripeState1) === JSON.stringify(stripeState2)}`);

const stripeFinish = await probeRun(`select local_service.finish_stripe_webhook_event('evt-probe-finish','failed',
  'Bearer secret abcdefghijklmnopqrstuvwxyz api_key=sk_live_probe owner@example.invalid 0812345678 ${'x'.repeat(560)}') as done`);
const stripeError = (await adminQuery(`select processing_status,last_error,length(last_error) as error_length,
  last_error not like '%secret abcdefghijklmnopqrstuvwxyz%' as token_redacted,
  last_error not like '%sk_live_probe%' as api_key_redacted,
  last_error not like '%owner@example.invalid%' as email_redacted,
  last_error not like '%0812345678%' as phone_redacted
  from local_service.stripe_webhook_events where id='evt-probe-finish'`))[0];
const stripeFinishAgain = await probeRun(`select local_service.finish_stripe_webhook_event('evt-probe-finish','processed',null) as done`);
const stripeWrongStatus = await probeRun(`select local_service.finish_stripe_webhook_event('evt-probe-finish','processing',null)`);
record('Stripe finalizer caps/redacts error, and only finalizes a processing row once to processed/failed',
  stripeFinish.rows?.[0]?.done === true && stripeError.processing_status === 'failed'
    && stripeError.error_length <= 500 && stripeError.token_redacted && stripeError.api_key_redacted && stripeError.email_redacted && stripeError.phone_redacted
    && stripeFinishAgain.rows?.[0]?.done === false && stripeWrongStatus.error !== null,
  `done=${stripeFinish.rows?.[0]?.done}; state=${stripeError.processing_status}; chars=${stripeError.error_length}; redacted=${stripeError.token_redacted}/${stripeError.api_key_redacted}/${stripeError.email_redacted}/${stripeError.phone_redacted}; repeated=${stripeFinishAgain.rows?.[0]?.done}; invalidStatus=${stripeWrongStatus.error !== null}`);

const runtimeDirectTable = await probeRun('select * from local_service.deposit_slip_upload_grants');
record('bk01_runtime cannot access product tables directly',
  runtimeDirectTable.error !== null && /permission denied|42501/i.test(runtimeDirectTable.error), runtimeDirectTable.error ?? 'DIRECT TABLE ACCESS ALLOWED');

const crossProduct = [];
for (const statement of [
  'select * from ps01.runtime_boundary_probe',
  'insert into ps01.runtime_boundary_probe values (2, \'blocked\')',
  'update ps01.runtime_boundary_probe set note=\'blocked\' where id=1',
  'delete from ps01.runtime_boundary_probe where id=1',
  'select * from mt01.runtime_boundary_probe',
  'insert into mt01.runtime_boundary_probe values (2, \'blocked\')',
]) {
  try { await q(statement); crossProduct.push({ statement, denied: false }); }
  catch (e) { crossProduct.push({ statement, denied: /permission denied|42501/i.test(String(e.message)) }); }
}
record(
  'bk01_runtime cannot read/write the stand-in PS01/MT01 relations',
  crossProduct.every((item) => item.denied),
  crossProduct.map((item) => `${item.denied ? 'denied' : 'ALLOWED'}:${item.statement.split(' ')[0]}`).join(' '),
);

const managedSurface = [];
for (const statement of [
  'select * from net.http_request_queue',
  'select * from cron.job',
]) {
  try { await q(statement); managedSurface.push({ statement, denied: false }); }
  catch (e) { managedSurface.push({ statement, denied: /permission denied|42501/i.test(String(e.message)) }); }
}
record(
  'bk01_runtime has no direct reach to stand-in net/cron objects',
  managedSurface.every((item) => item.denied),
  `${managedSurface.map((item) => `${item.denied ? 'denied' : 'ALLOWED'}:${item.statement.split(' ')[3]}`).join(' ')}; PGlite does not model PostgREST exposed-schema filtering or Supabase managed PUBLIC ACLs`,
);

const runtimeWrites = (await q(`select count(*)::int as n from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='local_service' and c.relkind in ('r','p','v','m')
    and (has_table_privilege('bk01_runtime',c.oid,'INSERT')
      or has_table_privilege('bk01_runtime',c.oid,'UPDATE')
      or has_table_privilege('bk01_runtime',c.oid,'DELETE')
      or has_table_privilege('bk01_runtime',c.oid,'TRUNCATE'))`))[0].n;
const roleMembership = (await q(`select m.set_option, m.inherit_option
  from pg_auth_members m join pg_roles member on member.oid=m.member
  join pg_roles granted on granted.oid=m.roleid
  where member.rolname='authenticator' and granted.rolname='bk01_runtime'`))[0];
record(
  'runtime has zero direct table-write grants and SET-only authenticator membership',
  runtimeWrites === 0 && roleMembership?.set_option === true && roleMembership?.inherit_option === false,
  `table_write_objects=${runtimeWrites}; membership=${JSON.stringify(roleMembership ?? null)}`,
);
await exec('reset role; reset role;');

const ownership = await q(`select count(*)::int as non_migrator
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='local_service' and p.prokind='f' and pg_get_userbyid(p.proowner) <> 'bk01_migrator'`);
console.log(`        local_service functions not owned by bk01_migrator after bootstrap: ${ownership[0].non_migrator}`);

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log('\n' + '='.repeat(74));
console.log(`checks: ${results.length}   pass: ${results.length - failed.length}   fail: ${failed.length}`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));

fs.writeFileSync(proofOutputPath,
  JSON.stringify({
    generated_at: new Date().toISOString(),
    engine: 'pglite (embedded postgres)',
    subject: 'supabase/shared-runtime/bk01-platform-bootstrap.sql',
    frozen_chain_files: migrations.length,
    frozen_chain_functions: fnCount,
    junction_a_transferred_functions: transferred,
    checks: results,
    helper_contract_observed: observed,
    auth_uid_equivalence: equivalence,
    per_function_exercise: perFn,
    runtime_allowlist_observed: runtimeFunctionResults,
    cross_product_denials: crossProduct,
    managed_surface_denials: managedSurface,
    rollback_observed: rollbackError ?? afterRollback,
    pre_bootstrap_snapshot: preBootstrapSnapshot,
    post_rollback_snapshot: postRollbackSnapshot,
  }, null, 2) + '\n', 'utf8');
console.log(`wrote ${proofOutputPath}`);
await db.close();
process.exit(failed.length ? 1 : 0);
