// BK01 migration policy — the rule set the BK01 product-local stream must satisfy.
//
// Static only: this module reads SQL text. It never opens a database connection.
//
// Two families of rule live here:
//   1. SCOPE  — every mutation target is explicitly qualified under a BK01
//      schema, and no project-global / ownership DDL is allowed.
//   2. GRANTS — grantees are allowlisted, a GRANT to PUBLIC is rejected, and
//      (F-6) every function the migration CREATES or REPLACES must carry a
//      matching REVOKE ALL ON FUNCTION ... FROM PUBLIC.
//
// Why F-6 exists: in PostgreSQL a newly created function is EXECUTE-able by
// PUBLIC by default, for SECURITY DEFINER and SECURITY INVOKER alike, and a
// CREATE OR REPLACE that changes the argument list creates a second function
// object with that same default. Naming only anon/authenticated in the REVOKE
// therefore leaves the hole open: anyone holding the anon key can call the
// function through the Data API. Revoking from PUBLIC is not granting, so the
// policy accepts PUBLIC as a REVOKE grantee while still rejecting GRANT ... TO
// PUBLIC.

const OWNED_SCHEMAS = new Set(['local_service', 'local_service_internal']);

// Roles that may appear as grantees. PUBLIC is deliberately NOT here: it is
// handled as its own special case, accepted only on the REVOKE side.
const ALLOWED_GRANTEES = new Set(['anon', 'authenticated', 'service_role', 'bk01_runtime']);
const PUBLIC_GRANTEE = 'public';

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

function statementVerb(statement) {
  const match = statement.match(/^\s*(GRANT|REVOKE)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function assertAllowedGrantees(statement, label) {
  const clean = statement.trim().replace(/;$/, '');
  const match = clean.match(/\b(?:to|from)\s+([^;]+)$/i);
  if (!match) throw new Error(`Unable to validate GRANT/REVOKE grantee: ${statement}`);

  const verb = statementVerb(clean);
  for (const raw of match[1].split(',')) {
    const role = normalizeIdentifier(raw.replace(/\s+with\s+grant\s+option.*$/i, ''));
    if (role === PUBLIC_GRANTEE) {
      // Granting a privilege to PUBLIC is never allowed; revoking one from
      // PUBLIC is exactly what closes PostgreSQL's default EXECUTE.
      if (verb === 'GRANT') {
        throw new Error(`${label}: GRANT to PUBLIC is forbidden - it re-opens the default PUBLIC EXECUTE that REVOKE ... FROM PUBLIC just closed`);
      }
      continue;
    }
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
const GRANT_STATEMENT = /\b(?:grant|revoke)\b[^;]*;/gi;

// Every function creation in the file, with its argument type list — the
// identity PostgreSQL resolves privileges against. A CREATE OR REPLACE that
// changes the argument list is a NEW function object and needs its own REVOKE.
const FUNCTION_CREATION =
  /\bcreate\s+(or\s+replace\s+)?function\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi;

// A REVOKE that clears PUBLIC's default EXECUTE. `FROM PUBLIC` must be there,
// and the target must be the same schema-qualified name and argument list as
// the creation (the argument list is optional only when the function takes no
// arguments, which is the same signature written both ways).
const FUNCTION_REVOKE_FROM_PUBLIC =
  /\brevoke\s+all\s+on\s+function\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*(\(([^)]*)\))?\s+from\s+[^;]*\bpublic\b/gi;

const squash = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase();

function parseArgumentTypes(rawArguments) {
  return squash(rawArguments)
    .split(',')
    .map((part) => part.trim().replace(/\s+default\s+[\s\S]*$/i, ''))
    .filter((part) => part.length > 0)
    // A declaration names its parameter (`p_at timestamptz`); a REVOKE target
    // does not (`timestamptz`). Both forms must resolve to the same type list.
    .map((part) => {
      const tokens = part.split(' ').filter((token) => token.length > 0);
      return (tokens.length > 1 ? tokens.slice(1) : tokens).join(' ').toUpperCase();
    });
}

function functionSignature(qualifiedName, rawArguments) {
  return `${squash(qualifiedName)}(${parseArgumentTypes(rawArguments).join(',')})`;
}

/**
 * Every function the migration creates must have a REVOKE ALL ON FUNCTION ...
 * FROM PUBLIC with the same name and argument list.
 */
function assertFunctionsRevokePublic(body, sourceName) {
  const creations = [];
  for (const match of Array.from(body.matchAll(FUNCTION_CREATION))) {
    creations.push({
      signature: functionSignature(match[2], match[3]),
      argumentCount: parseArgumentTypes(match[3]).length,
      raw: `CREATE ${match[1] ? 'OR REPLACE ' : ''}FUNCTION ${match[2]}(${match[3].trim()})`,
      replaced: Boolean(match[1]),
    });
  }

  const revoked = new Set();
  for (const match of Array.from(body.matchAll(FUNCTION_REVOKE_FROM_PUBLIC))) {
    const argumentCount = match[3] === undefined
      ? null // written without a parenthesised list: only legal for zero-arg functions
      : parseArgumentTypes(match[3]).length;
    const signature = functionSignature(match[1], match[3] ?? '');
    revoked.add(signature);
    if (argumentCount === null) {
      // Also accept the explicit empty-list spelling of the same signature.
      revoked.add(signature);
    }
  }

  for (const creation of creations) {
    if (revoked.has(creation.signature)) continue;
    // A no-argument function may be revoked with either `fn()` or `fn` spelling.
    if (creation.argumentCount === 0 && revoked.has(functionSignature(creation.raw.split('(')[0], ''))) continue;
    throw new Error(
      `${sourceName}: ${creation.replaced ? 'CREATE OR REPLACE FUNCTION (new signature)' : 'CREATE FUNCTION'} ${creation.signature} `
      + 'has no matching REVOKE ALL ON FUNCTION ... FROM PUBLIC. PostgreSQL grants EXECUTE on a new function to PUBLIC by default '
      + '(SECURITY INVOKER included), so the function would be callable by anyone holding the anon key.',
    );
  }
}

export function validateBk01MigrationSql(sql, sourceName = 'migration') {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error(`${sourceName} is empty`);
  const body = stripComments(sql);

  for (const pattern of FORBIDDEN_GLOBAL) {
    if (pattern.test(body)) {
      throw new Error(`${sourceName} contains forbidden project-global or ownership DDL: ${pattern}`);
    }
  }

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
    assertAllowedGrantees(statement, sourceName);
  }

  assertFunctionsRevokePublic(body, sourceName);

  return true;
}

export const BK01_OWNED_SCHEMAS = Object.freeze([...OWNED_SCHEMAS]);
export const BK01_ALLOWED_GRANTEES = Object.freeze([...ALLOWED_GRANTEES]);
