import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBookingPageState } from '../apps/booking-consumer/src/lib/booking-state.ts';

const base = {
  isLoading: false,
  loadError: false,
  shop: { is_accepting_online_bookings: true },
  serviceCount: 1,
  staffCount: 1,
  scheduleCount: 1,
};

test('OK when everything is present', () => {
  assert.equal(resolveBookingPageState(base), 'OK');
});

test('loading and load error take precedence over everything', () => {
  assert.equal(resolveBookingPageState({ ...base, isLoading: true }), 'LOADING');
  assert.equal(resolveBookingPageState({ ...base, loadError: true }), 'LOAD_ERROR');
});

test('load error is distinct from shop not found', () => {
  assert.equal(resolveBookingPageState({ ...base, loadError: true, shop: null }), 'LOAD_ERROR');
  assert.equal(resolveBookingPageState({ ...base, loadError: false, shop: null }), 'SHOP_NOT_FOUND');
});

test('disabled shop', () => {
  assert.equal(
    resolveBookingPageState({ ...base, shop: { is_accepting_online_bookings: false } }),
    'BOOKING_DISABLED',
  );
});

test('partial configuration is reported in precedence order', () => {
  assert.equal(resolveBookingPageState({ ...base, serviceCount: 0 }), 'NO_SERVICES');
  assert.equal(resolveBookingPageState({ ...base, staffCount: 0 }), 'NO_STAFF');
  assert.equal(resolveBookingPageState({ ...base, scheduleCount: 0 }), 'NO_SCHEDULE');
  // services missing wins over staff missing
  assert.equal(
    resolveBookingPageState({ ...base, serviceCount: 0, staffCount: 0 }),
    'NO_SERVICES',
  );
});
