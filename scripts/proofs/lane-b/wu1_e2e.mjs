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

const REPO = path.resolve(process.argv[2] || fileURLToPath(new URL('../../../', import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8').replace(/\r\n/g, '\n');

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
await exec(`create role bk01_runtime nologin nosuperuser nocreatedb nocreaterole nobypassrls;`);

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

const ownership = await q(`select count(*)::int as non_migrator
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='local_service' and p.prokind='f' and pg_get_userbyid(p.proowner) <> 'bk01_migrator'`);
console.log(`        local_service functions not owned by bk01_migrator after bootstrap: ${ownership[0].non_migrator}`);

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log('\n' + '='.repeat(74));
console.log(`checks: ${results.length}   pass: ${results.length - failed.length}   fail: ${failed.length}`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));

fs.writeFileSync(path.join(REPO, 'supabase/shared-runtime/WU1-PGLITE-PROOF.json'),
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
  }, null, 2) + '\n', 'utf8');
console.log('wrote supabase/shared-runtime/WU1-PGLITE-PROOF.json');
await db.close();
process.exit(failed.length ? 1 : 0);
