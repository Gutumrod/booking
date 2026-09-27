import { validateBk01RuntimeAuthority } from './bk01-runtime-allowlist.mjs';

const OWNED_SCHEMAS = new Set(['local_service', 'local_service_internal']);
const ALLOWED_GRANTEES = new Set(['anon', 'authenticated', 'service_role', 'bk01_runtime']);

const stripComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--.*$/gm, ' ');

const normalizeIdentifier = (value) => value
  .trim()
  .replace(/^"|"$/g, '')
  .toLowerCase();

function assertOwnedQualifiedTarget(rawTarget, label) {
  const target = rawTarget.trim().replace(/[;,]+$/, '');
  const firstToken = target.split(/\s|\(/, 1)[0];
  const parts = firstToken.split('.').map(normalizeIdentifier);
  if (parts.length < 2 || !OWNED_SCHEMAS.has(parts[0])) {
    throw new Error(`${label} must target an explicitly qualified BK01 schema object: ${rawTarget}`);
  }
}

function assertAllowedGrantees(statement) {
  const clean = statement.trim().replace(/;$/, '');
  const match = clean.match(/\b(?:to|from)\s+([^;]+)$/i);
  if (!match) throw new Error(`Unable to validate GRANT/REVOKE grantee: ${statement}`);
  for (const raw of match[1].split(',')) {
    const role = normalizeIdentifier(raw.replace(/\s+with\s+grant\s+option.*$/i, ''));
    if (!ALLOWED_GRANTEES.has(role)) {
      throw new Error(`GRANT/REVOKE targets non-BK01 allowlisted role: ${role}`);
    }
  }
}

const FORBIDDEN_GLOBAL = [
  /\b(?:create|alter|drop)\s+(?:role|user|database|extension|schema)\b/i,
  /\balter\s+default\s+privileges\b/i,
  /\bowner\s+to\b/i,
  /\bset\s+(?:(?:session|local)\s+)?authorization\b/i,
  /\b(?:set\s+(?:(?:session|local)\s+)?|reset\s+)session\s+authorization\b/i,
  /\bset\s+(?:local\s+)?role\b/i,
  /\breset\s+role\b/i,
  /\b(?:vacuum|reindex\s+database|cluster\s+)\b/i,
  /\bconcurrently\b/i,
  /\bsupabase_migrations\b/i,
  /\bdo\s+\$[a-z0-9_]*\$/i,
  /^\s*(?:begin|commit|rollback)\s*;/im,
];

const TARGET_PATTERNS = [
  { label: 'TABLE', re: /\b(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table(?:\s+if\s+exists)?|drop\s+table(?:\s+if\s+exists)?)\s+([^\s(;]+)/gi },
  { label: 'VIEW', re: /\b(?:create(?:\s+or\s+replace)?\s+view|alter\s+view|drop\s+view(?:\s+if\s+exists)?)\s+([^\s(;]+)/gi },
  { label: 'MATERIALIZED VIEW', re: /\b(?:create\s+materialized\s+view|alter\s+materialized\s+view|drop\s+materialized\s+view(?:\s+if\s+exists)?)\s+([^\s(;]+)/gi },
  { label: 'FUNCTION', re: /\b(?:create(?:\s+or\s+replace)?\s+function|alter\s+function|drop\s+function(?:\s+if\s+exists)?)\s+([^\s(]+)(?:\s*\(|\s)/gi },
  { label: 'TYPE', re: /\b(?:create\s+type|alter\s+type|drop\s+type(?:\s+if\s+exists)?)\s+([^\s(;]+)/gi },
  { label: 'SEQUENCE', re: /\b(?:create\s+sequence(?:\s+if\s+not\s+exists)?|alter\s+sequence|drop\s+sequence(?:\s+if\s+exists)?)\s+([^\s(;]+)/gi },
  { label: 'INSERT', re: /\binsert\s+into\s+([^\s(;]+)/gi },
  { label: 'UPDATE', re: /\bupdate\s+([^\s(;]+)/gi },
  { label: 'DELETE', re: /\bdelete\s+from\s+([^\s(;]+)/gi },
  { label: 'TRUNCATE', re: /\btruncate(?:\s+table)?\s+([^\s(;]+)/gi },
  { label: 'INDEX', re: /\b(?:alter\s+index|drop\s+index(?:\s+if\s+exists)?)\s+([^\s(;]+)/gi },
];

const ON_TARGET_PATTERNS = [
  { label: 'CREATE INDEX', re: /\bcreate(?:\s+unique)?\s+index(?:\s+if\s+not\s+exists)?\s+[^\s]+\s+on\s+(?:only\s+)?([^\s(;]+)/gi },
  { label: 'TRIGGER', re: /\bcreate(?:\s+or\s+replace)?\s+trigger\s+[^\s]+[\s\S]*?\bon\s+([^\s(;]+)/gi },
  { label: 'POLICY', re: /\b(?:create|alter|drop)\s+policy(?:\s+if\s+exists)?\s+[^\s]+\s+on\s+([^\s(;]+)/gi },
];

const COMMENT_TARGET = /\bcomment\s+on\s+(?:table|view|column|function|type|sequence)\s+([^\s(;]+)/gi;
const GRANT_STATEMENT = /\b(?:grant|revoke)\b[\s\S]*?;/gi;

// Lane B criterion (b): a BK01 product-local migration must not depend on schema
// `auth`. The BK01 migrator role owns `local_service` and `local_service_internal`
// only and has no USAGE on `auth`, so any function body reaching into `auth.*`
// fails at runtime once ownership moves off `postgres` — that is exactly the
// Junction A regression (42501 permission denied for schema auth).
//
// Use `local_service_internal.request_user_id()` instead: it resolves the same JWT
// identity `auth.uid()` resolves, without touching schema `auth`.
//
// A migration may only use `auth.uid()` for functions it names explicitly in a
// declaration line:
//     -- BK01-ALLOW-AUTH-UID: get_entitlement_usage
// The declaration is per-file and names the function; an undeclared function in a
// declared file still fails closed.
const AUTH_UID_CALL = /\bauth\s*\.\s*uid\s*\(/i;
const AUTH_UID_DECLARATION = /^[^\S\n]*--[^\S\n]*BK01-ALLOW-AUTH-UID\s*:\s*(.+)$/gim;
const AUTH_SCHEMA_REFERENCE = /\bauth\s*\.\s*(?:users|identities|sessions|refresh_tokens|mfa_|audit_log_entries)\b/i;

function declaredAuthUidFunctions(sql) {
  const declared = new Set();
  for (const match of sql.matchAll(AUTH_UID_DECLARATION)) {
    for (const raw of match[1].split(',')) {
      const name = normalizeIdentifier(raw.replace(/\(.*$/, ''));
      if (name) declared.add(name);
    }
  }
  return declared;
}

/**
 * Return the function names in `body` (comment-stripped SQL) whose text contains an
 * auth.uid() call. Attributes are searched too, so a call hidden in a DEFAULT or a
 * partial index expression attached to the statement is still attributed.
 */
function functionsUsingAuthUid(body) {
  const names = new Set();
  const boundaries = [];
  const createRe = /\bcreate\s+(?:or\s+replace\s+)?function\s+(?:local_service\.)?([a-z0-9_]+)\s*\(/gi;
  for (const match of body.matchAll(createRe)) {
    boundaries.push({ name: normalizeIdentifier(match[1]), index: match.index });
  }
  if (boundaries.length === 0) {
    if (AUTH_UID_CALL.test(body)) names.add('<outside-any-function>');
    return names;
  }
  boundaries.forEach((entry, i) => {
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : body.length;
    const chunk = body.slice(entry.index, end);
    if (AUTH_UID_CALL.test(chunk)) names.add(entry.name);
  });
  // anything before the first CREATE FUNCTION still counts as unattributed
  if (AUTH_UID_CALL.test(body.slice(0, boundaries[0].index))) names.add('<outside-any-function>');
  return names;
}

function assertAuthSchemaIndependence(sql, body, sourceName) {
  if (AUTH_SCHEMA_REFERENCE.test(body)) {
    throw new Error(
      `${sourceName} reads a Supabase Auth table; product-local migrations must not depend on schema auth`,
    );
  }
  const users = functionsUsingAuthUid(body);
  if (users.size === 0) return;

  const declared = declaredAuthUidFunctions(sql);
  const undeclared = [...users].filter((name) => !declared.has(name));
  if (undeclared.length > 0) {
    throw new Error(
      `${sourceName} uses auth.uid() outside the declared exception ` +
        `(BK01-ALLOW-AUTH-UID): ${undeclared.join(', ')}. ` +
        `Use local_service_internal.request_user_id() instead`,
    );
  }
}

export function validateBk01MigrationSql(sql, sourceName = 'migration') {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error(`${sourceName} is empty`);
  const body = stripComments(sql);
  validateBk01RuntimeAuthority(sql, sourceName);

  for (const pattern of FORBIDDEN_GLOBAL) {
    if (pattern.test(body)) {
      throw new Error(`${sourceName} contains forbidden project-global or ownership DDL: ${pattern}`);
    }
  }

  assertAuthSchemaIndependence(sql, body, sourceName);

  for (const { label, re } of [...TARGET_PATTERNS, ...ON_TARGET_PATTERNS]) {
    re.lastIndex = 0;
    for (const match of body.matchAll(re)) {
      assertOwnedQualifiedTarget(match[1], `${sourceName}: ${label}`);
    }
  }

  COMMENT_TARGET.lastIndex = 0;
  for (const match of body.matchAll(COMMENT_TARGET)) {
    assertOwnedQualifiedTarget(match[1], `${sourceName}: COMMENT`);
  }

  const grants = body.match(GRANT_STATEMENT) ?? [];
  for (const statement of grants) {
    const target = statement.match(/\bon\s+(?:table|sequence|function|routine|schema)?\s*([^\s(;]+)/i);
    if (!target) throw new Error(`${sourceName}: unable to validate GRANT/REVOKE target`);
    assertOwnedQualifiedTarget(target[1], `${sourceName}: GRANT/REVOKE`);
    assertAllowedGrantees(statement);
  }

  return true;
}

export const BK01_OWNED_SCHEMAS = Object.freeze([...OWNED_SCHEMAS]);
export const BK01_ALLOWED_GRANTEES = Object.freeze([...ALLOWED_GRANTEES]);
