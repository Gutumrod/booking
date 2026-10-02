import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validateBk01MigrationSql } from '../scripts/lib/bk01-migration-policy.mjs';

const root = process.cwd();
const migrationName = '20261002170000_bk01_g10_line_binding_audit_truncate.sql';
const migrationPath = path.join(root, 'supabase/bk01-migrations', migrationName);
const migration = readFileSync(migrationPath, 'utf8');
const rollback = readFileSync(path.join(root, 'supabase/rollback/20261002170000_bk01_g10_line_binding_audit_truncate.rollback.sql'), 'utf8');

test('170000 is the final, policy-valid BK01 migration', () => {
  const migrations = readdirSync(path.join(root, 'supabase/bk01-migrations')).filter((name) => name.endsWith('.sql')).sort();
  assert.equal(migrations.at(-1), migrationName);
  assert.equal(validateBk01MigrationSql(migration, migrationName), true);
});

test('line_users TRUNCATE is audited before the statement without revoking service_role', () => {
  assert.match(migration, /BEFORE TRUNCATE ON local_service\.line_users\s+FOR EACH STATEMENT/);
  assert.match(migration, /'line_users', 'TRUNCATE', lu\.shop_id, lu\.id, lu\.customer_id/);
  assert.match(migration, /CHECK \(operation IN \('INSERT','UPDATE','DELETE','TRUNCATE'\)\)/);
  assert.doesNotMatch(migration, /REVOKE\s+TRUNCATE\s+ON\s+TABLE\s+local_service\.line_users/i);
});

test('line_users no-op updates are excluded with IS DISTINCT FROM', () => {
  assert.match(migration, /AFTER UPDATE OF line_user_id ON local_service\.line_users\s+FOR EACH ROW\s+WHEN \(OLD\.line_user_id IS DISTINCT FROM NEW\.line_user_id\)/);
  assert.match(migration, /IF OLD\.line_user_id IS NOT DISTINCT FROM NEW\.line_user_id THEN\s+RETURN NEW;/);
});

test('customer insert/delete audit only rows carrying a LINE ID', () => {
  assert.match(migration, /AFTER INSERT ON local_service\.customers\s+FOR EACH ROW\s+WHEN \(NEW\.line_user_id IS NOT NULL\)/);
  assert.match(migration, /AFTER DELETE ON local_service\.customers\s+FOR EACH ROW\s+WHEN \(OLD\.line_user_id IS NOT NULL\)/);
  assert.match(migration, /WHEN \(OLD\.line_user_id IS DISTINCT FROM NEW\.line_user_id\)/);
});

test('170000 rollback restores the 160000 constraint and trigger names', () => {
  assert.match(rollback, /CHECK \(operation IN \('INSERT','UPDATE','DELETE'\)\)/);
  assert.match(rollback, /CREATE TRIGGER bk01_line_binding_audit_row\s+AFTER INSERT OR UPDATE OR DELETE ON local_service\.line_users/);
  assert.match(rollback, /CREATE TRIGGER bk01_customer_line_binding_audit_row\s+AFTER UPDATE OF line_user_id ON local_service\.customers/);
});
