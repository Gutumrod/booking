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
  requireDeposit: false,
  promptpayNumber: null,
  promptpayName: null,
  everyServiceNeedsDeposit: false,
};

test('OK when everything is present and no deposit needed', () => {
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
  assert.equal(
    resolveBookingPageState({ ...base, serviceCount: 0, staffCount: 0 }),
    'NO_SERVICES',
  );
});

// --- F6: payment-incomplete state ---

const depositShop = {
  ...base,
  requireDeposit: true,
  everyServiceNeedsDeposit: true,
  promptpayNumber: null,
  promptpayName: null,
};

test('deposit-required shop with no payment setup is PAYMENT_NOT_CONFIGURED', () => {
  assert.equal(resolveBookingPageState(depositShop), 'PAYMENT_NOT_CONFIGURED');
  assert.equal(
    resolveBookingPageState({ ...depositShop, promptpayNumber: '0812345678', promptpayName: null }),
    'PAYMENT_NOT_CONFIGURED',
  );
  assert.equal(
    resolveBookingPageState({ ...depositShop, promptpayNumber: null, promptpayName: 'Shop Co' }),
    'PAYMENT_NOT_CONFIGURED',
  );
});

test('deposit-required shop with complete payment setup is OK', () => {
  assert.equal(
    resolveBookingPageState({ ...depositShop, promptpayNumber: '0812345678', promptpayName: 'Shop Co' }),
    'OK',
  );
});

test('no-deposit shop is never payment-blocked even without PromptPay', () => {
  assert.equal(resolveBookingPageState({ ...base, requireDeposit: false, promptpayNumber: null, promptpayName: null }), 'OK');
});

test('shop with a no-deposit / explicit-zero service path is not page-blocked', () => {
  // require_deposit true but not every service needs a deposit -> proceed; F1 guards the rest
  assert.equal(
    resolveBookingPageState({ ...depositShop, everyServiceNeedsDeposit: false }),
    'OK',
  );
});

test('load / not-found / disabled still win over payment state', () => {
  assert.equal(resolveBookingPageState({ ...depositShop, loadError: true }), 'LOAD_ERROR');
  assert.equal(resolveBookingPageState({ ...depositShop, shop: null }), 'SHOP_NOT_FOUND');
  assert.equal(
    resolveBookingPageState({ ...depositShop, shop: { is_accepting_online_bookings: false } }),
    'BOOKING_DISABLED',
  );
});
