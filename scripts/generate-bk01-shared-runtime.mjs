import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BK01_RUNTIME_BOOTSTRAP_FUNCTIONS,
  BK01_RUNTIME_ROUTE_FUNCTIONS as CURRENT_RUNTIME_ROUTE_FUNCTIONS,
  BK01_PUBLIC_LEGACY_EXECUTE_EXCEPTIONS,
  BK01_RUNTIME_EFFECTIVE_FUNCTIONS as CURRENT_RUNTIME_EFFECTIVE_FUNCTIONS,
} from './lib/bk01-runtime-allowlist.mjs';

// ---------------------------------------------------------------------------
// BK01 shared-runtime bootstrap generator.
//
// Lane B criterion (b). The 2026-09-08 Junction A bootstrap transferred 58
// `local_service` function owners to `bk01_migrator`, which has no USAGE on schema
// `auth`. Every transferred function that called `auth.uid()` then failed at runtime
// with 42501 "permission denied for schema auth" — that is the regression this
// generator removes.
//
// Remediation (Owner ruling 2026-09-26, form "(c) + the existing exception"):
//   * functions that only needed `auth.uid()` are re-emitted, derived from the frozen
//     chain, with `auth.uid()` replaced by `local_service_internal.request_user_id()`;
//   * functions that read `auth.users` or `storage.` keep their original owner and are
//     NOT transferred (the exception inventory, now measured rather than hand-listed);
//   * no product database LOGIN exists any more: the operator runs migrations as
//     `SET ROLE bk01_migrator` (H2 invariant).
//
// The frozen chain (supabase/migrations) stays the single source of every rewritten
// definition. Nothing here is hand-copied: the generator resolves each function's final
// identity, substitutes the one expression, and re-emits it with its original security
// mode and an explicit search_path pin.
// ---------------------------------------------------------------------------

// Keep the pinned bootstrap generation at the pre-P0 phase. R1 adds its executor
// in the new product migration and validates final surfaces independently.
const BK01_RUNTIME_ROUTE_FUNCTIONS = CURRENT_RUNTIME_ROUTE_FUNCTIONS.filter(x => !x.startsWith('local_service.create_booking_hold(')).map(x => x.startsWith('local_service.claim_due_shop_email_notifications(') ? 'local_service.claim_due_shop_email_notifications(integer)' : x);
const BK01_RUNTIME_EFFECTIVE_FUNCTIONS = CURRENT_RUNTIME_EFFECTIVE_FUNCTIONS.filter(x => !x.startsWith('local_service.create_booking_hold(')).map(x => x.startsWith('local_service.claim_due_shop_email_notifications(') ? 'local_service.claim_due_shop_email_notifications(integer)' : x);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacyDir = path.join(root, 'supabase', 'migrations');
const outputDir = path.join(root, 'supabase', 'shared-runtime');
const bootstrapPath = path.join(outputDir, 'bk01-platform-bootstrap.sql');
const rollbackPath = path.join(outputDir, 'bk01-platform-bootstrap-rollback.sql');
const contractPath = path.join(outputDir, 'bk01-request-helper-contract.json');
const manifestPath = path.join(outputDir, 'bk01-legacy-baseline.json');
const expectedLegacyCount = 30;

const OWNED_SCHEMAS = ['local_service', 'local_service_internal'];
const INTERNAL_SCHEMA = 'local_service_internal';
const HELPER = `${INTERNAL_SCHEMA}.request_user_id`;
const HELPER_SEARCH_PATH = 'pg_catalog, pg_temp';
// Schemas the product functions legitimately resolve. `local_service_internal` is
// deliberately absent: it is reachable only by a fully-qualified call, so no
// unqualified reference can silently resolve into internal state.
const FUNCTION_SEARCH_PATH = 'pg_catalog, local_service';

const files = fs.readdirSync(legacyDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (files.length !== expectedLegacyCount) {
  throw new Error(`Legacy BK01 migration stream is frozen at ${expectedLegacyCount} files; found ${files.length}. Add new shared-runtime migrations under supabase/bk01-migrations.`);
}

const sources = files.map((name) => ({
  name,
  text: fs.readFileSync(path.join(legacyDir, name), 'utf8').replace(/\r\n/g, '\n'),
}));
const sourceHash = crypto.createHash('sha256')
  .update(sources.map(({ name, text }) => `${name}\n${text}`).join('\n'))
  .digest('hex');
const lastLegacyVersion = files.at(-1).match(/^(\d{14})_/)?.[1];
if (!lastLegacyVersion) throw new Error('Unable to resolve the final legacy migration version.');

// ---------------------------------------------------------------------------
// Identity-resolved parse of the frozen chain
// ---------------------------------------------------------------------------

const TYPE_ALIASES = {
  int: 'integer', int4: 'integer', int8: 'bigint', int2: 'smallint',
  bool: 'boolean', varchar: 'character varying', float8: 'double precision',
  timestamptz: 'timestamp with time zone',
};

function normalizeType(token) {
  let t = token.trim().toLowerCase().replace(/\s+/g, ' ');
  t = t.replace(/\s+default\s+.*$/, '').replace(/\s+not\s+null$/, '').replace(/"/g, '');
  const isArray = t.endsWith('[]');
  const base = isArray ? t.slice(0, -2) : t;
  return (TYPE_ALIASES[base] ?? base) + (isArray ? '[]' : '');
}

function splitTopLevel(raw) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of raw) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else { cur += ch; }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function identityArgs(raw) {
  return splitTopLevel(raw).map((part) => {
    let p = part.trim();
    if (!p) return '';
    p = p.replace(/\s+default\s+.*$/i, '').replace(/\s+not\s+null$/i, '').trim();
    const tokens = p.split(/\s+/);
    const type = tokens.length >= 2 && !/^(in|out|inout|variadic)$/i.test(tokens[0])
      ? tokens.slice(1).join(' ')
      : p;
    return normalizeType(type);
  }).filter(Boolean).join(',');
}

const FUNC_RE = /(?<lead>create\s+(?:or\s+replace\s+)?function\s+)(?:local_service\.)?(?<name>[a-z0-9_]+)\s*\((?<args>[^)]*)\)/gi;

function parseFunctions(text, sourceName) {
  const found = [];
  for (const match of text.matchAll(FUNC_RE)) {
    const name = match.groups.name;
    const args = identityArgs(match.groups.args);
    const rest = text.slice(match.index + match[0].length);
    const openDelim = rest.match(/\$[a-zA-Z_]*\$/);
    if (!openDelim) continue;
    const tag = openDelim[0];
    // Everything between the argument list and the body delimiter is the function
    // header (RETURNS / LANGUAGE / SECURITY / SET ...); everything after the closing
    // delimiter up to the next ';' is the attribute tail. Both carry semantics.
    const preBody = rest.slice(0, openDelim.index);
    const bodyStart = openDelim.index + tag.length;
    const bodyEnd = rest.indexOf(tag, bodyStart);
    if (bodyEnd === -1) continue;
    const body = rest.slice(bodyStart, bodyEnd);
    const after = rest.slice(bodyEnd + tag.length);
    const semi = after.indexOf(';');
    const postBody = after.slice(0, semi === -1 ? after.length : semi);
    const attrs = `${preBody} ${postBody}`;

    if (/\bauth\s*\.\s*users\b/i.test(body) || /\bstorage\s*\./i.test(body)) {
      found.push({
        name, args, rawArgs: match.groups.args, body, attrs, sourceName,
        identity: `local_service.${name}(${args})`,
        kind: 'shared-surface',
      });
      continue;
    }
    if (!/\bauth\s*\.\s*uid\s*\(/i.test(body)) continue;

    found.push({
      name, args, rawArgs: match.groups.args, body, attrs, sourceName,
      identity: `local_service.${name}(${args})`,
      kind: 'auth-uid',
    });
  }
  return found;
}

const byIdentity = new Map();
for (const source of sources) {
  for (const fn of parseFunctions(source.text, source.name)) {
    byIdentity.set(fn.identity, fn);
  }
}

const authUidFunctions = [...byIdentity.values()].filter((f) => f.kind === 'auth-uid');
const sharedSurfaceFunctions = [...byIdentity.values()].filter((f) => f.kind === 'shared-surface');
if (authUidFunctions.length === 0) {
  throw new Error('No auth.uid()-dependent functions found in the frozen chain; the remediation has nothing to rewrite.');
}

// ---------------------------------------------------------------------------
// Rewrite
// ---------------------------------------------------------------------------

function securityMode(attrs) {
  if (/\bsecurity\s+definer\b/i.test(attrs)) return 'DEFINER';
  if (/\bsecurity\s+invoker\b/i.test(attrs)) return 'INVOKER';
  return 'INVOKER';
}

function renderRewrite(fn) {
  const body = fn.body.replace(/\bauth\s*\.\s*uid\s*\(\s*\)/gi, `${HELPER}()`);
  const returns = (fn.attrs.match(/\breturns\s+([^;]*?)(?=\s+(?:language|as|security|set|immutable|stable|volatile)\b|$)/i) ?? [])[1];
  if (!returns) throw new Error(`Unable to resolve RETURNS for ${fn.identity}`);
  const languageMatch = fn.attrs.match(/\blanguage\s+([a-z_]+)/i);
  if (!languageMatch) throw new Error(`Unable to resolve LANGUAGE for ${fn.identity}`);
  const language = languageMatch[1].toLowerCase();
  const mode = securityMode(fn.attrs);
  const clauses = [];
  if (mode === 'DEFINER') clauses.push('security definer');
  else if (/\bsecurity\s+invoker\b/i.test(fn.attrs)) clauses.push('security invoker');
  if (/\bstable\b/i.test(fn.attrs)) clauses.push('stable');
  else if (/\bimmutable\b/i.test(fn.attrs)) clauses.push('immutable');
  else if (/\bvolatile\b/i.test(fn.attrs)) clauses.push('volatile');

  // A dollar tag that cannot appear in the body keeps the rewrite byte-faithful.
  let tag = '$bk01$';
  let i = 0;
  while (body.includes(tag)) { tag = `$bk01_${i++}$`; }

  const header = [
    `-- Rewritten from the frozen chain: supabase/migrations/${fn.sourceName}`,
    `-- Change: auth.uid() -> ${HELPER}() (schema auth is not reachable from bk01_migrator)`,
    `-- Preserved: RETURNS, LANGUAGE ${language}, security mode, volatility.`,
    `-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.`,
    `create or replace function local_service.${fn.name}(${fn.rawArgs.trim()})`,
    `returns ${returns.trim()}`,
    `language ${language}`,
  ];
  if (clauses.length) header.push(clauses.join(' '));
  header.push(`set search_path = ${FUNCTION_SEARCH_PATH}`);

  return `${header.join('\n')}\nas ${tag}\n${body.trimEnd()}\n${tag};\n`;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const rewriteBlock = authUidFunctions
  .slice()
  .sort((a, b) => a.identity.localeCompare(b.identity))
  .map(renderRewrite)
  .join('\n');

const authUidIdentityList = authUidFunctions
  .slice()
  .sort((a, b) => a.identity.localeCompare(b.identity))
  .map((fn) => fn.identity);

const exceptionList = sharedSurfaceFunctions
  .slice()
  .sort((a, b) => a.identity.localeCompare(b.identity))
  .map((fn) => fn.identity);

const sqlStringList = (values) => values.map((v) => `        '${v.replace(/'/g, "''")}'`).join(',\n');

const header = `-- GENERATED FILE. DO NOT EDIT DIRECTLY.
-- Platform-admin bootstrap for BK01 shared-runtime migration isolation.
-- Legacy source SHA-256: ${sourceHash}
-- Legacy migration count: ${files.length}
--
-- Lane B criterion (b) remediation (Owner ruling 2026-09-26):
--   * no BK01 role is a LOGIN identity; the platform operator applies product
--     migrations with \`set local role bk01_migrator\` inside a reviewed transaction
--     (H2: a shared project hands no product a direct database LOGIN);
--   * no BK01 object and no BK01 function depends on schema \`auth\`;
--   * functions were re-emitted DERIVED from the frozen legacy chain, one expression
--     substituted, security mode preserved, search_path re-pinned.
--
-- Required psql variable: :'window_valid_until' is NOT used here. This file takes no
-- variable and contains no credential.`;

const rolesBlock = `
DO $bk01_roles$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'BK01 platform bootstrap requires postgres, got %', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bk01_migrator') THEN
    CREATE ROLE bk01_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'bk01_migrator'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Existing bk01_migrator has unsafe attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bk01_migrator_login') THEN
    RAISE EXCEPTION 'Retired role bk01_migrator_login is present; run the reviewed retirement step before bootstrap';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bk01_runtime') THEN
    RAISE EXCEPTION 'bk01_runtime (NOLOGIN Data API runtime role) is required before bootstrap';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'bk01_runtime'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'Existing bk01_runtime has unsafe attributes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    RAISE EXCEPTION 'authenticator is required for the bk01_runtime Data API boundary';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    WHERE member.rolname = 'bk01_runtime'
  ) THEN
    RAISE EXCEPTION 'bk01_runtime must not be a member of another role';
  END IF;
END
$bk01_roles$;

GRANT bk01_migrator TO postgres;
GRANT bk01_runtime TO authenticator WITH INHERIT FALSE, SET TRUE;
`;

const privilegesBlock = `
CREATE SCHEMA IF NOT EXISTS ${INTERNAL_SCHEMA} AUTHORIZATION bk01_migrator;
ALTER SCHEMA local_service OWNER TO bk01_migrator;
ALTER SCHEMA ${INTERNAL_SCHEMA} OWNER TO bk01_migrator;
REVOKE ALL ON SCHEMA ${INTERNAL_SCHEMA} FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA local_service TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA local_service TO bk01_runtime;
${BK01_RUNTIME_BOOTSTRAP_FUNCTIONS.map((identity) => `GRANT EXECUTE ON FUNCTION ${identity} TO bk01_runtime;`).join('\n')}

-- NO grant is taken on schema auth or schema extensions. bk01_migrator must be able to
-- prove it cannot resolve auth.*; that proof is in the guard block below.
DO $bk01_db_privileges$
BEGIN
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM bk01_migrator', current_database());
END
$bk01_db_privileges$;
`;

const helperBlock = `
-- ---------------------------------------------------------------------------
-- JWT identity helper (replaces auth.uid() for every BK01 function).
--
-- This is deliberately the SAME expression Supabase's auth.uid() uses: coalesce the
-- legacy single-claim setting with the JSON claims object, THEN cast the coalesced
-- text to uuid. Casting per branch instead would silently diverge on a malformed
-- claim ({"sub":""}) — auth.uid() raises there, so this must raise there too.
-- Nothing but pg_catalog is read, so no product function needs schema auth.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ${HELPER}()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $bk01_helper$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$bk01_helper$;

REVOKE ALL ON FUNCTION ${HELPER}() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ${HELPER}() TO bk01_migrator;
`;

const relOwnersBlock = `
DO $bk01_rel_owners$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'local_service' AND c.relkind IN ('r','p','v','m','S','c')
    ORDER BY c.relkind, c.relname
  LOOP
    IF r.owner_name NOT IN ('postgres', 'bk01_migrator') THEN
      RAISE EXCEPTION 'Refusing to take ownership of local_service.% from unexpected owner %', r.relname, r.owner_name;
    END IF;
    IF r.owner_name = 'postgres' THEN
      CASE r.relkind
        WHEN 'r' THEN EXECUTE format('ALTER TABLE local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'p' THEN EXECUTE format('ALTER TABLE local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'v' THEN EXECUTE format('ALTER VIEW local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'S' THEN EXECUTE format('ALTER SEQUENCE local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'c' THEN EXECUTE format('ALTER TYPE local_service.%I OWNER TO bk01_migrator', r.relname);
        ELSE RAISE EXCEPTION 'Unsupported local_service relation kind %', r.relkind;
      END CASE;
    END IF;
  END LOOP;
END
$bk01_rel_owners$;
`;

const functionOwnersBlock = `
-- The exception inventory below is the measured set of functions that read
-- auth.users or storage.*: they keep their original owner and are never transferred.
DO $bk01_function_owners$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS signature,
      pg_get_userbyid(p.proowner) AS owner_name,
      pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'local_service' AND p.prokind = 'f'
    ORDER BY p.oid::regprocedure::text
  LOOP
    IF r.owner_name NOT IN ('postgres', 'bk01_migrator') THEN
      RAISE EXCEPTION 'Refusing to take ownership of % from unexpected owner %', r.signature, r.owner_name;
    END IF;
    IF r.definition ILIKE '%auth.users%' OR r.definition ILIKE '%storage.%' THEN
      IF r.signature NOT IN (
${sqlStringList(exceptionList)}
      ) THEN
        RAISE EXCEPTION 'Unregistered shared-surface function dependency: %', r.signature;
      END IF;
      CONTINUE;
    END IF;
    IF r.owner_name = 'postgres' THEN
      EXECUTE format('ALTER FUNCTION %s OWNER TO bk01_migrator', r.signature);
    END IF;
  END LOOP;
END
$bk01_function_owners$;
`;

const rewriteSection = `
-- ===========================================================================
-- Lane B criterion (b) — functions derived from the frozen legacy chain, with
-- auth.uid() replaced by ${HELPER}().
--
-- Ordering is deliberate and measured: ownership is transferred FIRST ($bk01_function_owners$),
-- then the definition is replaced here. CREATE OR REPLACE preserves the owner and the
-- ACL, and the session legitimately holds replace authority because the bootstrap takes
-- \`GRANT bk01_migrator TO postgres\`. Doing it the other way round would have the
-- ownership pass re-own a definition that still resolves schema auth.
--
-- ${authUidFunctions.length} function identities, each with its original security mode and an
-- explicit search_path (CREATE OR REPLACE resets a previous ALTER FUNCTION pin).
-- ===========================================================================
${rewriteBlock}
DO $bk01_rewrite_guard$
DECLARE missing integer;
BEGIN
  SELECT count(*) INTO missing
  FROM (VALUES
${authUidIdentityList.map((v) => `    ('${v}')`).join(',\n')}
  ) AS expected(identity)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'local_service'
      AND p.oid::regprocedure::text = expected.identity
  );
  IF missing <> 0 THEN
    RAISE EXCEPTION 'BK01 bootstrap did not emit % expected rewritten function(s)', missing;
  END IF;
END
$bk01_rewrite_guard$;
`;

const authBoundaryGuard = `
-- ---------------------------------------------------------------------------
-- Negative proof: after this bootstrap, no BK01 function that was transferred to
-- bk01_migrator may depend on schema auth. Measured from the catalog, not asserted.
--
-- The declared ownership exceptions are exempt by construction: they keep their
-- original owner and their shared-surface dependency is the reviewed exception.
-- ---------------------------------------------------------------------------
DO $bk01_auth_boundary_guard$
DECLARE offenders text;
BEGIN
  SELECT string_agg(sig, ', ') INTO offenders
  FROM (
    SELECT DISTINCT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'local_service'
      AND p.oid::regprocedure::text NOT IN (
${sqlStringList(exceptionList)}
      )
      AND p.prosrc ~ '(^|[^a-zA-Z0-9_])auth[[:space:]]*\\.[[:space:]]*(uid|users|identities|sessions|refresh_tokens)'
    ORDER BY sig
  ) AS offenders;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'BK01 functions still depend on schema auth: %', offenders;
  END IF;

  IF has_schema_privilege('bk01_migrator', 'auth', 'USAGE') THEN
    RAISE EXCEPTION 'bk01_migrator unexpectedly holds USAGE on schema auth';
  END IF;
  IF to_regprocedure('${HELPER}()') IS NULL THEN
    RAISE EXCEPTION 'JWT identity helper ${HELPER}() is missing';
  END IF;
  IF has_function_privilege('anon', '${HELPER}()', 'EXECUTE')
     OR has_function_privilege('authenticated', '${HELPER}()', 'EXECUTE')
     OR has_function_privilege('service_role', '${HELPER}()', 'EXECUTE') THEN
    RAISE EXCEPTION 'JWT identity helper is executable by a Data API role';
  END IF;
END
$bk01_auth_boundary_guard$;
`;

const ledgerBlock = `
CREATE TABLE IF NOT EXISTS ${INTERNAL_SCHEMA}.migration_baseline (
  baseline_id text PRIMARY KEY,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  migration_count integer NOT NULL CHECK (migration_count > 0),
  last_legacy_version text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ${INTERNAL_SCHEMA}.migration_baseline OWNER TO bk01_migrator;

CREATE TABLE IF NOT EXISTS ${INTERNAL_SCHEMA}.schema_migrations (
  migration_id text PRIMARY KEY,
  filename text NOT NULL UNIQUE,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  release_id text NOT NULL,
  runner_version text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ${INTERNAL_SCHEMA}.schema_migrations OWNER TO bk01_migrator;
REVOKE ALL ON ALL TABLES IN SCHEMA ${INTERNAL_SCHEMA} FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${INTERNAL_SCHEMA} FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO ${INTERNAL_SCHEMA}.migration_baseline (
  baseline_id, source_sha256, migration_count, last_legacy_version
) VALUES (
  'legacy-global-history', '${sourceHash}', ${files.length}, '${lastLegacyVersion}'
) ON CONFLICT (baseline_id) DO NOTHING;

DO $bk01_baseline_check$
DECLARE baseline record;
BEGIN
  SELECT * INTO baseline
  FROM ${INTERNAL_SCHEMA}.migration_baseline
  WHERE baseline_id = 'legacy-global-history';
  IF baseline.source_sha256 <> '${sourceHash}'
     OR baseline.migration_count <> ${files.length}
     OR baseline.last_legacy_version <> '${lastLegacyVersion}' THEN
    RAISE EXCEPTION 'BK01 legacy baseline mismatch; refusing shared-runtime bootstrap';
  END IF;
END
$bk01_baseline_check$;
`;

const boundaryCheckBlock = `
DO $bk01_boundary_check$
DECLARE unexpected_count integer;
BEGIN
  IF pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='local_service')) <> 'bk01_migrator'
     OR pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='${INTERNAL_SCHEMA}')) <> 'bk01_migrator' THEN
    RAISE EXCEPTION 'BK01 schema ownership boundary is not established';
  END IF;
  IF has_database_privilege('bk01_migrator', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'BK01 migration role has database-wide CREATE';
  END IF;
  IF has_schema_privilege('bk01_migrator', 'ps01', 'USAGE')
     OR has_schema_privilege('bk01_migrator', 'ps01_internal', 'USAGE') THEN
    RAISE EXCEPTION 'BK01 migration role crosses PS01 schema boundary';
  END IF;
  IF has_schema_privilege('bk01_migrator', 'auth', 'USAGE') THEN
    RAISE EXCEPTION 'BK01 migration role holds USAGE on schema auth';
  END IF;
  IF has_schema_privilege('bk01_migrator', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'BK01 migration role can create in public';
  END IF;

  SELECT count(*) INTO unexpected_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='local_service' AND c.relkind IN ('r','p','v','m','S','c')
    AND pg_get_userbyid(c.relowner) <> 'bk01_migrator';
  IF unexpected_count <> 0 THEN RAISE EXCEPTION 'BK01 relation ownership transfer incomplete: %', unexpected_count; END IF;
END
$bk01_boundary_check$;
`;

const functionVerificationBlock = `
DO $bk01_function_boundary_check$
DECLARE unexpected_count integer;
BEGIN
  SELECT count(*) INTO unexpected_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='local_service' AND p.prokind='f'
    AND (
      (p.oid::regprocedure::text IN (
${sqlStringList(exceptionList)}
      ) AND pg_get_userbyid(p.proowner) <> 'postgres')
      OR
      (p.oid::regprocedure::text NOT IN (
${sqlStringList(exceptionList)}
      ) AND pg_get_userbyid(p.proowner) <> 'bk01_migrator')
    );
  IF unexpected_count <> 0 THEN
    RAISE EXCEPTION 'BK01 function ownership boundary mismatch: %', unexpected_count;
  END IF;
END
$bk01_function_boundary_check$;
`;

const runtimeBoundaryCheckBlock = `
DO $bk01_runtime_boundary_check$
DECLARE v_exec_count integer; v_route_function_count integer;
  v_expected_exec_count integer; v_table_write_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname='bk01_runtime'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'bk01_runtime role attributes are unsafe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member ON member.oid=m.member
    JOIN pg_roles granted ON granted.oid=m.roleid
    WHERE member.rolname='authenticator' AND granted.rolname='bk01_runtime'
      AND m.set_option AND NOT m.inherit_option
  ) THEN
    RAISE EXCEPTION 'authenticator membership for bk01_runtime is not SET-only';
  END IF;
  IF has_database_privilege('bk01_runtime', current_database(), 'CREATE')
     OR has_schema_privilege('bk01_runtime','local_service','CREATE') THEN
    RAISE EXCEPTION 'bk01_runtime has unexpected CREATE authority';
  END IF;
  IF has_schema_privilege('bk01_runtime','local_service_internal','USAGE') THEN
    RAISE EXCEPTION 'bk01_runtime has unexpected product/managed schema reach';
  END IF;
  -- H2 treats pre-existing PUBLIC ACLs on managed net/cron/extensions at the Data API
  -- boundary. Check that this bootstrap adds no direct USAGE ACL for the runtime role;
  -- effective reach through PUBLIC is not a role-specific grant and is not narrowed here.
  IF EXISTS (
    SELECT 1
    FROM pg_namespace n
    JOIN pg_roles runtime ON runtime.rolname='bk01_runtime'
    CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n',n.nspowner))) acl
    WHERE n.nspname IN ('ps01','ps01_internal','mt01','mt01_private',
      'wstera_platform_internal','auth','storage','extensions','net','cron')
      AND acl.grantee=runtime.oid AND acl.privilege_type='USAGE'
  ) THEN
    RAISE EXCEPTION 'bk01_runtime has a direct USAGE ACL on a foreign or managed schema';
  END IF;
  SELECT count(*) INTO v_exec_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='local_service' AND has_function_privilege('bk01_runtime',p.oid,'EXECUTE');
  SELECT count(*) INTO v_route_function_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='local_service' AND p.oid::regprocedure::text IN (
${BK01_RUNTIME_ROUTE_FUNCTIONS.map((identity) => `    '${identity}'`).join(',\n')}
  );
  IF v_route_function_count NOT IN (0, 5, 6, ${BK01_RUNTIME_ROUTE_FUNCTIONS.length})
     OR (v_route_function_count = 5 AND to_regprocedure('local_service.bk01_line_bind_booking_trial(text,text,text,text)') IS NOT NULL) THEN
    RAISE EXCEPTION 'BK01 route RPC migration is partially present';
  END IF;
  v_expected_exec_count := CASE v_route_function_count
    WHEN 0 THEN ${BK01_RUNTIME_BOOTSTRAP_FUNCTIONS.length + BK01_PUBLIC_LEGACY_EXECUTE_EXCEPTIONS.length}
    WHEN 5 THEN ${BK01_RUNTIME_BOOTSTRAP_FUNCTIONS.length + 5 + BK01_PUBLIC_LEGACY_EXECUTE_EXCEPTIONS.length}
    WHEN 6 THEN ${BK01_RUNTIME_BOOTSTRAP_FUNCTIONS.length + 6 + BK01_PUBLIC_LEGACY_EXECUTE_EXCEPTIONS.length}
    ELSE ${BK01_RUNTIME_EFFECTIVE_FUNCTIONS.length} END;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='local_service' AND has_function_privilege('bk01_runtime',p.oid,'EXECUTE')
      AND p.oid::regprocedure::text NOT IN (
${BK01_RUNTIME_EFFECTIVE_FUNCTIONS.map((identity) => `        '${identity}'`).join(',\n')}
      )
  ) OR v_exec_count <> v_expected_exec_count THEN
    RAISE EXCEPTION 'bk01_runtime effective EXECUTE set differs from an exact approved migration phase (observed count %, expected %)', v_exec_count, v_expected_exec_count;
  END IF;
  SELECT count(*) INTO v_table_write_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='local_service' AND c.relkind IN ('r','p','v','m')
    AND (has_table_privilege('bk01_runtime',c.oid,'INSERT')
      OR has_table_privilege('bk01_runtime',c.oid,'UPDATE')
      OR has_table_privilege('bk01_runtime',c.oid,'DELETE')
      OR has_table_privilege('bk01_runtime',c.oid,'TRUNCATE'));
  IF v_table_write_count <> 0 THEN
    RAISE EXCEPTION 'bk01_runtime has direct local_service table write authority';
  END IF;
END
$bk01_runtime_boundary_check$;
`;

const bootstrap = [
  header, rolesBlock, privilegesBlock, helperBlock, relOwnersBlock,
  functionOwnersBlock, rewriteSection, authBoundaryGuard, runtimeBoundaryCheckBlock,
  ledgerBlock, boundaryCheckBlock, functionVerificationBlock,
].join('\n');

// ---------------------------------------------------------------------------
// Rollback — same derivation, plus removal of the retired login if an older
// environment still carries it.
// ---------------------------------------------------------------------------

const rollback = `-- PLATFORM-ADMIN ROLLBACK FOR BK01 MIGRATION-BOUNDARY BOOTSTRAP ONLY.
-- Valid only before any product-local BK01 migration has been applied.
--
-- Also retires bk01_migrator_login where it exists: H2 forbids a direct product
-- database LOGIN in the shared project.
DO $bk01_rollback_guard$
DECLARE applied_count integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'BK01 bootstrap rollback requires postgres, got %', current_user;
  END IF;
  IF to_regclass('${INTERNAL_SCHEMA}.schema_migrations') IS NOT NULL THEN
    SELECT count(*) INTO applied_count FROM ${INTERNAL_SCHEMA}.schema_migrations;
    IF applied_count <> 0 THEN
      RAISE EXCEPTION 'BK01 bootstrap rollback blocked: % product-local migrations already applied', applied_count;
    END IF;
  END IF;
END
$bk01_rollback_guard$;

DO $bk01_retire_product_login$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bk01_migrator_login') THEN
    IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename='bk01_migrator_login') THEN
      RAISE EXCEPTION 'Active bk01_migrator_login session(s); drain before retiring';
    END IF;
    EXECUTE 'REVOKE ALL ON SCHEMA local_service FROM bk01_migrator_login';
    EXECUTE 'REVOKE ALL ON SCHEMA ${INTERNAL_SCHEMA} FROM bk01_migrator_login';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bk01_migrator') THEN
      EXECUTE 'REVOKE bk01_migrator FROM bk01_migrator_login';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bk01_runtime') THEN
      EXECUTE 'REVOKE bk01_runtime FROM bk01_migrator_login';
    END IF;
    EXECUTE 'DROP ROLE bk01_migrator_login';
  END IF;
END
$bk01_retire_product_login$;

DO $bk01_restore_rel_owners$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='local_service' AND c.relkind IN ('r','p','v','m','S','c')
  LOOP
    CASE r.relkind
      WHEN 'r' THEN EXECUTE format('ALTER TABLE local_service.%I OWNER TO postgres', r.relname);
      WHEN 'p' THEN EXECUTE format('ALTER TABLE local_service.%I OWNER TO postgres', r.relname);
      WHEN 'v' THEN EXECUTE format('ALTER VIEW local_service.%I OWNER TO postgres', r.relname);
      WHEN 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW local_service.%I OWNER TO postgres', r.relname);
      WHEN 'S' THEN EXECUTE format('ALTER SEQUENCE local_service.%I OWNER TO postgres', r.relname);
      WHEN 'c' THEN EXECUTE format('ALTER TYPE local_service.%I OWNER TO postgres', r.relname);
    END CASE;
  END LOOP;
END
$bk01_restore_rel_owners$;

DO $bk01_restore_function_owners$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='local_service' AND p.prokind='f'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', r.signature);
  END LOOP;
END
$bk01_restore_function_owners$;

-- Remove only the runtime boundary grants introduced by this bootstrap. The role
-- itself is pre-provisioned by House and is intentionally not dropped here.
REVOKE EXECUTE ON FUNCTION ${BK01_RUNTIME_BOOTSTRAP_FUNCTIONS.join(' FROM bk01_runtime;\nREVOKE EXECUTE ON FUNCTION ')} FROM bk01_runtime;
REVOKE USAGE ON SCHEMA local_service FROM bk01_runtime;
REVOKE bk01_runtime FROM authenticator;

ALTER SCHEMA local_service OWNER TO postgres;
DROP SCHEMA IF EXISTS ${INTERNAL_SCHEMA} CASCADE;

DO $bk01_drop_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bk01_migrator') THEN
    REVOKE ALL ON SCHEMA local_service FROM bk01_migrator;
    REVOKE bk01_migrator FROM postgres;
  END IF;
END
$bk01_drop_roles$;

DROP ROLE IF EXISTS bk01_migrator;
-- bk01_runtime is NOT dropped here: it is a runtime identity owned by the Data API
-- lane, not by this bootstrap.
`;

// ---------------------------------------------------------------------------
// Machine-readable contract for the helper's behaviour (tested in PGlite).
// ---------------------------------------------------------------------------

const contract = {
  helper: `${HELPER}()`,
  replaces: 'auth.uid()',
  equality_claim: 'returns the same value auth.uid() returns for the same request',
  equals_auth_uid: true,
  reads: ['request.jwt.claim.sub', "request.jwt.claims ->> 'sub'"],
  returns: 'uuid',
  volatility: 'STABLE',
  security: 'INVOKER (default)',
  search_path: 'pg_catalog',
  granted_to: ['bk01_migrator'],
  revoked_from: ['PUBLIC', 'anon', 'authenticated', 'service_role'],
  cases: [
    { case: 'no_claim', setting: null, expected: null, fail_closed: false, note: 'unauthenticated request' },
    { case: 'empty_claim', setting: '', expected: null, fail_closed: false, note: 'empty string collapses to NULL' },
    { case: 'empty_json', setting: '{}', expected: null, fail_closed: false, note: 'no sub key' },
    { case: 'valid_sub', setting: '{"sub":"11111111-2222-3333-4444-555555555555"}', expected: '11111111-2222-3333-4444-555555555555', fail_closed: false },
    { case: 'missing_sub', setting: '{"other":"x"}', expected: null, fail_closed: false },
    {
      case: 'empty_sub',
      setting: '{"sub":""}',
      expected: 'error',
      fail_closed: true,
      note: 'measured: Supabase auth.uid() casts the COALESCED value, and empty string is not NULL, so ""::uuid raises. The helper reproduces that exactly — a per-branch cast would have returned NULL and diverged.',
    },
    { case: 'sub_not_uuid', setting: '{"sub":"not-a-uuid"}', expected: 'error', fail_closed: true, note: 'malformed claim raises, never a silent NULL' },
  ],
  generated_from: {
    frozen_migrations_sha256: sourceHash,
    frozen_migration_count: files.length,
  },
  rewritten_identities: authUidIdentityList,
  ownership_exception_identities: exceptionList,
};

// ---------------------------------------------------------------------------

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(bootstrapPath, bootstrap, 'utf8');
fs.writeFileSync(rollbackPath, rollback, 'utf8');
fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
fs.writeFileSync(manifestPath, `${JSON.stringify({
  version: 1,
  source: 'supabase/migrations',
  frozenMigrationCount: files.length,
  sourceSha256: sourceHash,
  lastLegacyVersion,
}, null, 2)}\n`, 'utf8');

console.log(`Generated ${path.relative(root, bootstrapPath)}`);
console.log(`Generated ${path.relative(root, rollbackPath)}`);
console.log(`Generated ${path.relative(root, contractPath)}`);
console.log(`Generated ${path.relative(root, manifestPath)}`);
console.log(`Legacy source SHA-256: ${sourceHash}`);
console.log(`Rewritten auth.uid() functions: ${authUidFunctions.length}`);
console.log(`Ownership exceptions (shared surface): ${sharedSurfaceFunctions.length}`);
