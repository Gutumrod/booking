import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBk01MigrationSql } from './lib/bk01-migration-policy.mjs';
import { BK01_RUNTIME_EFFECTIVE_FUNCTIONS, validateBk01RuntimeAuthority, validateBk01RuntimeEffectiveExecuteSet } from './lib/bk01-runtime-allowlist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'supabase', 'bk01-migrations');
const migrations = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

for (const name of migrations) {
  validateBk01MigrationSql(fs.readFileSync(path.join(migrationsDir, name), 'utf8'), name);
}

// Non-vacuity: each class of privilege expansion must fail on a real SQL input.
const violatingInputs = [
  'ALTER ROLE bk01_runtime LOGIN;',
  'GRANT EXECUTE ON FUNCTION local_service.unlisted_rpc(uuid) TO bk01_runtime;',
  'GRANT INSERT ON TABLE local_service.bookings TO bk01_runtime;',
  'GRANT USAGE ON SCHEMA ps01 TO bk01_runtime;',
  'GRANT bk01_runtime TO service_role WITH INHERIT FALSE, SET TRUE;',
];
for (const [index, sql] of violatingInputs.entries()) {
  let rejected = false;
  try { validateBk01RuntimeAuthority(sql, `crafted-${index}`); }
  catch { rejected = true; }
  if (!rejected) throw new Error(`Runtime privilege policy failed non-vacuity probe ${index}`);
}

const effectiveSetProbes = [
  ['9th PUBLIC function', [...BK01_RUNTIME_EFFECTIVE_FUNCTIONS, 'local_service.ninth_public_probe()']],
  ['extra explicit runtime grant', [...BK01_RUNTIME_EFFECTIVE_FUNCTIONS, 'local_service.extra_runtime_probe()']],
];
for (const [label, observed] of effectiveSetProbes) {
  let rejected = false;
  try { validateBk01RuntimeEffectiveExecuteSet(observed, label); }
  catch { rejected = true; }
  if (!rejected) throw new Error(`Effective EXECUTE non-vacuity failed: ${label}`);
}

console.log('BK01 migration policy PASS');
console.log(`SQL migrations checked: ${migrations.length}`);
console.log(`bk01_runtime authority violating inputs rejected: ${violatingInputs.length}/${violatingInputs.length}`);
console.log(`effective EXECUTE violating sets rejected: ${effectiveSetProbes.length}/${effectiveSetProbes.length}`);
