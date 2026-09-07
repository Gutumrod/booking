import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260907181500_skip_overdue_line_reminders.sql'),
  'utf8',
);

test('new overdue 24h reminders are suppressed at the DB boundary', () => {
  assert.match(migration, /NEW\.event_type = 'reminder_24h'/);
  assert.match(migration, /NEW\.status = 'pending'/);
  assert.match(migration, /NEW\.scheduled_for <= now\(\)/);
  assert.match(migration, /RETURN NULL;/);
  assert.match(migration, /BEFORE INSERT ON local_service\.line_notification_logs/);
});
