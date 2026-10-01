import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { hasAppointmentStarted } from '../apps/booking-admin/src/lib/booking-outcome-gate.ts';

const DASHBOARD = 'apps/booking-admin/src/app/dashboard/page.tsx';
const MIGRATION = 'supabase/bk01-migrations/20261001130000_bk01_sql_consolidate.sql';

test('B10 no-show remains closed before appointment start and opens at the boundary', () => {
  const start = Date.parse('2026-10-01T14:00:00+07:00');
  const moment = { date: '2026-10-01', time: '14:00' };
  assert.equal(hasAppointmentStarted(moment, start - 1), false);
  assert.equal(hasAppointmentStarted(moment, start), true);
  assert.equal(hasAppointmentStarted({ date: 'bad', time: '14:00' }, start), false);
  assert.equal(hasAppointmentStarted({ date: '2026-02-31', time: '14:00' }, start), false);
  assert.equal(hasAppointmentStarted({ date: '2026-10-01', time: '25:00' }, start), false);
});

test('B10 UI and SQL enforce the same start-time boundary and never auto-change status', () => {
  const dashboard = readFileSync(DASHBOARD, 'utf8');
  const migration = readFileSync(MIGRATION, 'utf8');
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION local_service.set_booking_outcome(');
  const end = migration.indexOf('$function$;', start);
  const sqlFunction = migration.slice(start, end);
  assert.match(dashboard, /hasAppointmentStarted\(\{ date: b\.date, time: b\.time \}, nowMs\)/);
  assert.match(dashboard, /outcome === 'no_show'[\s\S]*?hasAppointmentStarted/);
  assert.match(sqlFunction, /p_outcome='no_show' AND v_booking\.start_timestamptz>now\(\)/);
  assert.doesNotMatch(sqlFunction, /UPDATE[\s\S]*?status\s*=\s*'no_show'[\s\S]*?now\(\)/i);
});
