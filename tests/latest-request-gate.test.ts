import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLatestRequestGate } from '../apps/booking-admin/src/lib/latest-request-gate.ts';

test('latest request wins when A and B resolve out of order', () => {
  const gate = createLatestRequestGate();
  const requestA = gate.begin();
  const requestB = gate.begin();

  assert.equal(gate.isCurrent(requestA), false, 'older request A is stale');
  assert.equal(gate.isCurrent(requestB), true, 'newer request B is current');
});

test('cancel invalidates every in-flight request token', () => {
  const gate = createLatestRequestGate();
  const request = gate.begin();
  assert.equal(gate.isCurrent(request), true);
  gate.cancel();
  assert.equal(gate.isCurrent(request), false);
});

test('dashboard routes every fetch through one guarded loader', () => {
  const src = readFileSync(new URL('../apps/booking-admin/src/app/dashboard/page.tsx', import.meta.url), 'utf8');
  const directFetches = src.match(/fetchAdminDashboardData\(\)/g) ?? [];
  assert.equal(directFetches.length, 1, 'only the guarded loader may fetch dashboard data');
  assert.match(src, /const requestToken = requestGate\.begin\(\)/);
  assert.match(src, /if \(!requestGate\.isCurrent\(requestToken\)\) return;/);
  assert.match(src, /isExactShopIdentityMatch\(layoutShopIdentity\.shopId, data\.shop\.id\)/);
  assert.match(src, /setShopId\(''\)/, 'pending reload must make Preview non-actionable');
});
