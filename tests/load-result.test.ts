import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowOrNull, rowsOrThrow, type QueryResult } from '../apps/booking-consumer/src/lib/load-result.ts';
import { resolveBookingPageState } from '../apps/booking-consumer/src/lib/booking-state.ts';

const queryError = { data: null, error: { message: 'network down' } };

test('rowOrNull: no row is null, error throws', () => {
  assert.equal(rowOrNull({ data: null, error: null }, 'shop'), null);
  assert.deepEqual(rowOrNull({ data: { id: 's1' }, error: null }, 'shop'), { id: 's1' });
  assert.throws(() => rowOrNull(queryError, 'shop'), /network down/);
  assert.throws(() => rowOrNull({ data: null, error: {} }, 'shop'), /Failed to fetch shop/);
});

test('rowsOrThrow: empty is [], error throws (never collapsed to [])', () => {
  assert.deepEqual(rowsOrThrow({ data: [], error: null }, 'services'), []);
  assert.deepEqual(rowsOrThrow({ data: null, error: null }, 'services'), []);
  assert.deepEqual(rowsOrThrow({ data: [{ id: 'a' }], error: null }, 'services'), [{ id: 'a' }]);
  assert.throws(() => rowsOrThrow(queryError, 'services'), /network down/);
});

// Mirrors the booking page's loadData(): accessors through the adapters, any
// throw -> loadError. Proves each failure reaches LOAD_ERROR and each genuine
// empty result keeps its own state. F-14: the page also carries the view's
// answer for "does this shop have a row of this kind at all", because the
// choice lists are entitlement-filtered; absent is the conservative `true`.
type Shop = { id: string; is_accepting_online_bookings?: boolean };
function loadState(q: {
  shop: QueryResult<Shop>;
  services?: QueryResult<unknown[]>;
  staff?: QueryResult<unknown[]>;
  serviceKindPresent?: boolean;
  staffKindPresent?: boolean;
}) {
  let shop: Shop | null = null;
  let services: unknown[] = [];
  let staff: unknown[] = [];
  let loadError = false;
  try {
    shop = rowOrNull(q.shop, 'shop');
    if (shop) {
      services = rowsOrThrow(q.services ?? { data: [{}], error: null }, 'services');
      staff = rowsOrThrow(q.staff ?? { data: [{}], error: null }, 'staff');
    }
  } catch {
    loadError = true;
  }
  return resolveBookingPageState({
    isLoading: false,
    loadError,
    shop,
    serviceCount: services.length,
    staffCount: staff.length,
    scheduleCount: 1,
    everyServicePaymentBlocked: false,
    serviceKindPresent: q.serviceKindPresent ?? true,
    staffKindPresent: q.staffKindPresent ?? true,
  });
}

const okShop = { data: { id: 's1', is_accepting_online_bookings: true }, error: null };

test('shop query error is LOAD_ERROR, genuine missing shop is SHOP_NOT_FOUND', () => {
  assert.equal(loadState({ shop: queryError }), 'LOAD_ERROR');
  assert.equal(loadState({ shop: { data: null, error: null } }), 'SHOP_NOT_FOUND');
});

test('service query error is LOAD_ERROR, genuine empty services is NO_SERVICES', () => {
  assert.equal(loadState({ shop: okShop, services: queryError }), 'LOAD_ERROR');
  // The shop has no service row at all: the "never added" state stays honest.
  assert.equal(loadState({ shop: okShop, services: { data: [], error: null }, serviceKindPresent: false }), 'NO_SERVICES');
  // The shop has service rows and none of them is bookable right now.
  assert.equal(loadState({ shop: okShop, services: { data: [], error: null }, serviceKindPresent: true }), 'BOOKING_DISABLED');
});

test('staff query error is LOAD_ERROR, genuine empty staff is NO_STAFF', () => {
  assert.equal(loadState({ shop: okShop, staff: queryError }), 'LOAD_ERROR');
  assert.equal(loadState({ shop: okShop, staff: { data: [], error: null }, staffKindPresent: false }), 'NO_STAFF');
  assert.equal(loadState({ shop: okShop, staff: { data: [], error: null }, staffKindPresent: true }), 'BOOKING_DISABLED');
});

test('healthy load is OK', () => {
  assert.equal(loadState({ shop: okShop }), 'OK');
});
