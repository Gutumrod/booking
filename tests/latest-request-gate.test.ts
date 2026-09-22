import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLatestRequestGate } from '../apps/booking-admin/src/lib/latest-request-gate.ts';
import { isExactShopIdentityMatch } from '../apps/booking-admin/src/lib/customer-page-url.ts';

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
  assert.match(src, /!requestGate\.isCurrent\(requestToken\)[\s\S]{0,120}currentLayoutShopIdRef\.current !== requestedLayoutShopId/);
  assert.match(src, /isExactShopIdentityMatch\(requestedLayoutShopId, data\.shop\.id\)/);
  assert.match(src, /setShopId\(''\)/, 'pending reload must make Preview non-actionable');
});

test('A snapshot becomes non-actionable as soon as layout identity changes to B', () => {
  assert.equal(isExactShopIdentityMatch('shop-a', 'shop-a'), true);
  assert.equal(isExactShopIdentityMatch('shop-b', 'shop-a'), false);
  assert.equal(isExactShopIdentityMatch('shop-b', ''), false);
});

test('dashboard hides stale tenant truth and gates alternate actions during mismatch/error', () => {
  const src = readFileSync(new URL('../apps/booking-admin/src/app/dashboard/page.tsx', import.meta.url), 'utf8');

  assert.match(src, /tenantSnapshotValid && isExactShopIdentityMatch\(layoutShopIdentity\.shopId, shopId\)/);
  assert.match(src, /setTenantSnapshotValid\(false\);/);
  assert.match(src, /setShopId\(''\)/);
  assert.match(src, /!tenantSnapshotReady \? \([\s\S]*?\) : \(\s*<>/);
  assert.match(src, /const dashboardCustomerUrl = tenantSnapshotReady \? customerPageUrl\(shopSlug\) : null;/);
  assert.match(src, /if \(!tenantSnapshotReady \|\| !dashboardCustomerUrl\) return;/);
  assert.match(src, /\{tenantSnapshotReady && selectedSlipBooking && \(/);
  assert.match(src, /\{tenantSnapshotReady && cancelBookingTarget && \(/);

  for (const guardedHandler of [
    'handleApproveSlip',
    'handleRejectSlip',
    'toggleStaffActive',
    'handleDeleteHoliday',
    'handleSaveSchedule',
    'handleSaveAllSchedules',
    'handleToggleService',
  ]) {
    const start = src.indexOf(`const ${guardedHandler}`);
    assert.notEqual(start, -1, `${guardedHandler} must exist`);
    const body = src.slice(start, start + 240);
    assert.match(body, /if \(!tenantSnapshotReady/, `${guardedHandler} must fail closed`);
  }
});

test('stale tenant-A continuation cannot mint newer authority after layout B begins', () => {
  const gate = createLatestRequestGate();
  let currentLayout: string | null = 'shop-a';

  const beginForLayout = (capturedLayout: string | null) => {
    if (currentLayout !== capturedLayout) return null;
    return gate.begin();
  };

  const requestA = beginForLayout('shop-a');
  assert.notEqual(requestA, null);

  currentLayout = null;
  gate.cancel();
  currentLayout = 'shop-b';
  const requestB = beginForLayout('shop-b');
  assert.notEqual(requestB, null);
  assert.equal(gate.isCurrent(requestB as number), true);

  const staleAReload = beginForLayout('shop-a');
  assert.equal(staleAReload, null, 'stale A callback must return before begin()');
  assert.equal(gate.isCurrent(requestB as number), true, 'B retains generation authority');
});

test('dashboard binds request authority to the current layout identity before and after fetch', () => {
  const src = readFileSync(new URL('../apps/booking-admin/src/app/dashboard/page.tsx', import.meta.url), 'utf8');
  const loaderStart = src.indexOf('const loadDashboardBookings = useCallback');
  const begin = src.indexOf('const requestToken = requestGate.begin()', loaderStart);
  const preAuthority = src.indexOf('currentLayoutShopIdRef.current !== requestedLayoutShopId', loaderStart);

  assert.notEqual(loaderStart, -1);
  assert.notEqual(preAuthority, -1);
  assert.notEqual(begin, -1);
  assert.ok(preAuthority < begin, 'layout authority check must happen before generation begin()');
  assert.match(src, /currentLayoutShopIdRef\.current = layoutShopIdentity\.shopId;/);
  assert.match(src, /currentLayoutShopIdRef\.current = null;[\s\S]{0,120}requestGate\.cancel\(\)/);
  assert.match(src, /!requestGate\.isCurrent\(requestToken\)[\s\S]{0,120}currentLayoutShopIdRef\.current !== requestedLayoutShopId/);
  assert.match(src, /requestGate\.isCurrent\(requestToken\)[\s\S]{0,160}currentLayoutShopIdRef\.current === requestedLayoutShopId[\s\S]{0,120}showLoading/);
});
