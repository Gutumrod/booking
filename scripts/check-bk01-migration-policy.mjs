// BK01 migration policy validator CLI.
//
// Runs the same repository policy (scripts/lib/bk01-migration-policy.mjs) that
// scripts/bk01-migrate.mjs runs before it will apply anything, over every file
// in supabase/bk01-migrations/, and reports the result per file.
//
// Static only: it reads files and never opens a database connection.
//
// Usage: node scripts/check-bk01-migration-policy.mjs [directory]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBk01MigrationSql, BK01_OWNED_SCHEMAS, BK01_ALLOWED_GRANTEES } from './lib/bk01-migration-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? path.join('supabase', 'bk01-migrations');
const dir = path.isAbsolute(target) ? target : path.join(root, target);

if (!fs.existsSync(dir)) {
  console.error(`Policy check FAILED: migration directory not found: ${dir}`);
  process.exitCode = 1;
} else {
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();

  console.log('BK01 migration policy check');
  console.log(`Directory: ${dir}`);
  console.log(`Owned schemas: ${BK01_OWNED_SCHEMAS.join(', ')}`);
  console.log(`Allowed grantees: ${BK01_ALLOWED_GRANTEES.join(', ')}`);

  if (files.length === 0) {
    console.error('Policy check FAILED: no .sql files found to validate.');
    process.exitCode = 1;
  }

  let checked = 0;

  for (const filename of files) {
    const fullPath = path.join(dir, filename);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const sqlText = raw.replace(/\r\n/g, '\n');

    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(filename)) {
      console.error(`FAIL  ${filename} :: filename must match YYYYMMDDHHMMSS_snake_case.sql`);
      process.exitCode = 1;
      continue;
    }

    if (!sqlText.trim()) {
      console.error(`FAIL  ${filename} :: file is empty`);
      process.exitCode = 1;
      continue;
    }

    try {
      validateBk01MigrationSql(sqlText, filename);
      checked += 1;
      console.log(`PASS  ${filename}`);
    } catch (error) {
      console.error(`FAIL  ${filename} :: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }

  if (checked === files.length && files.length > 0) {
    console.log(`Policy check PASS: ${checked}/${files.length} migration file(s) accepted.`);
  } else {
    console.error(`Policy check FAILED: ${checked}/${files.length} migration file(s) accepted.`);
  }
}
