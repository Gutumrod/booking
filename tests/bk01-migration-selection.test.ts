import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBk01MigrationArgs, selectPendingBk01Migrations } from '../scripts/lib/bk01-migration-selection.mjs';

const migrations = [1, 2, 3, 4].map((number) => ({
  filename: `20260928120${String(number).padStart(2, '0')}_migration_${number}.sql`,
  migrationId: `20260928120${String(number).padStart(2, '0')}_migration_${number}`,
}));
const names = (items: typeof migrations) => items.map((item) => item.filename);

test('BK01 runner keeps default plan/apply arguments unchanged', () => {
  assert.deepEqual(parseBk01MigrationArgs(['plan']), { mode: 'plan', throughFilename: undefined });
  assert.deepEqual(parseBk01MigrationArgs(['apply']), { mode: 'apply', throughFilename: undefined });
  assert.deepEqual(names(selectPendingBk01Migrations(migrations, new Map(), undefined)), names(migrations));
});

test('BK01 --through selects the inclusive pending prefix and leaves later work pending', () => {
  const firstInterval = selectPendingBk01Migrations(migrations, new Map(), migrations[2].filename);
  assert.deepEqual(names(firstInterval), names(migrations.slice(0, 3)));

  const ledgerAfterFirstInterval = new Map(firstInterval.map((item) => [item.migrationId, {}]));
  const secondInterval = selectPendingBk01Migrations(migrations, ledgerAfterFirstInterval, undefined);
  assert.deepEqual(names(secondInterval), names(migrations.slice(3)));
});

test('BK01 plan and apply resolve --through to the same migration set', () => {
  const plan = parseBk01MigrationArgs(['plan', '--through', migrations[2].filename]);
  const apply = parseBk01MigrationArgs(['apply', '--through', migrations[2].filename]);
  assert.deepEqual(
    names(selectPendingBk01Migrations(migrations, new Map(), plan.throughFilename)),
    names(selectPendingBk01Migrations(migrations, new Map(), apply.throughFilename)),
  );
});

test('BK01 runner rejects missing, unknown, repeated, and conflicting options', () => {
  assert.throws(() => parseBk01MigrationArgs([]), /Usage:/);
  assert.throws(() => parseBk01MigrationArgs(['apply', '--through']), /requires a migration filename/);
  assert.throws(() => parseBk01MigrationArgs(['apply', '--through', '--dry-run']), /requires a migration filename/);
  assert.throws(() => parseBk01MigrationArgs(['apply', '--unknown']), /Unsupported/);
  assert.throws(() => parseBk01MigrationArgs(['apply', '--through', 'one.sql', '--through', 'two.sql']), /only once/);
  assert.throws(() => parseBk01MigrationArgs(['apply', 'plan']), /Unsupported/);
  assert.throws(() => selectPendingBk01Migrations(migrations, new Map(), 'missing.sql'), /Unknown BK01 migration filename/);
});

test('BK01 --through rejects already-applied and out-of-order ledgers', () => {
  const targetApplied = new Map([[migrations[2].migrationId, {}]]);
  assert.throws(
    () => selectPendingBk01Migrations(migrations, targetApplied, migrations[2].filename),
    /already been applied/,
  );

  const outOfOrder = new Map([[migrations[1].migrationId, {}]]);
  assert.throws(
    () => selectPendingBk01Migrations(migrations, outOfOrder, migrations[3].filename),
    /out of order/,
  );
});
