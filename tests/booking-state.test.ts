import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBookingPageState } from '../apps/booking-consumer/src/lib/booking-state.ts';
import { isServicePaymentBlocked } from '../apps/booking-consumer/src/lib/payment-instruction.ts';

const base = {
  isLoading: false,
  loadError: false,
  shop: { is_accepting_online_bookings: true },
  serviceCount: 1,
  staffCount: 1,
  scheduleCount: 1,
  everyServicePaymentBlocked: false,
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

// --- F6 / R2-4: selected-service-aware payment gate ---
//
// The page computes `everyServicePaymentBlocked` as services.every(gate) and
// refuses createBookingHold when gate(selectedService) is true. This helper
// mirrors that wiring so the precedence is testable without React.

type Svc = { deposit_amount: number | null };
const unconfigured = { promptpayNumber: null, promptpayName: null };
const configured = { promptpayNumber: '0812345678', promptpayName: 'Shop Co' };

function evaluate(opts: {
  requireDeposit: boolean;
  identity: { promptpayNumber: string | null; promptpayName: string | null };
  services: Svc[];
  selected: Svc;
}) {
  const gate = (s: Svc) => isServicePaymentBlocked({
    requireDeposit: opts.requireDeposit,
    serviceDepositAmount: s.deposit_amount,
    ...opts.identity,
  });
  return {
    pageState: resolveBookingPageState({
      ...base,
      serviceCount: opts.services.length,
      everyServicePaymentBlocked: opts.services.length > 0 && opts.services.every(gate),
    }),
    holdAllowed: !gate(opts.selected),
  };
}

const positive = { deposit_amount: 200 };
const zero = { deposit_amount: 0 };
const unset = { deposit_amount: null };

test('mixed services: selected positive-deposit service is blocked before hold; page stays usable', () => {
  for (const other of [zero, unset]) {
    const r = evaluate({ requireDeposit: true, identity: unconfigured, services: [positive, other], selected: positive });
    assert.equal(r.pageState, 'OK', 'other bookable service keeps the page usable');
    assert.equal(r.holdAllowed, false, 'selected positive-deposit service must not reach createBookingHold');
  }
});

test('mixed services: selecting the explicit-zero service is allowed', () => {
  const r = evaluate({ requireDeposit: true, identity: unconfigured, services: [positive, zero], selected: zero });
  assert.equal(r.pageState, 'OK');
  assert.equal(r.holdAllowed, true);
});

test('unset service deposit is not guessed; post-hold gate stays authoritative (BLOCKED_R7)', () => {
  const r = evaluate({ requireDeposit: true, identity: unconfigured, services: [unset], selected: unset });
  assert.equal(r.pageState, 'OK');
  assert.equal(r.holdAllowed, true);
});

test('no-deposit shop is never blocked, even with positive service amounts and no PromptPay', () => {
  const r = evaluate({ requireDeposit: false, identity: unconfigured, services: [positive], selected: positive });
  assert.equal(r.pageState, 'OK');
  assert.equal(r.holdAllowed, true);
});

test('every service positive-deposit with no identity -> page PAYMENT_NOT_CONFIGURED', () => {
  const r = evaluate({ requireDeposit: true, identity: unconfigured, services: [positive, { deposit_amount: 50 }], selected: positive });
  assert.equal(r.pageState, 'PAYMENT_NOT_CONFIGURED');
  assert.equal(r.holdAllowed, false);
});

test('partial or malformed identity still blocks a positive-deposit service', () => {
  for (const identity of [
    { promptpayNumber: '0812345678', promptpayName: null },
    { promptpayNumber: null, promptpayName: 'Shop Co' },
    { promptpayNumber: 'not-a-number', promptpayName: 'Shop Co' },
  ]) {
    assert.equal(evaluate({ requireDeposit: true, identity, services: [positive], selected: positive }).holdAllowed, false);
  }
});

test('complete identity lets a positive-deposit service proceed', () => {
  const r = evaluate({ requireDeposit: true, identity: configured, services: [positive], selected: positive });
  assert.equal(r.pageState, 'OK');
  assert.equal(r.holdAllowed, true);
});

test('load / not-found / disabled / empty-config still win over payment state', () => {
  const blocked = { ...base, everyServicePaymentBlocked: true };
  assert.equal(resolveBookingPageState({ ...blocked, loadError: true }), 'LOAD_ERROR');
  assert.equal(resolveBookingPageState({ ...blocked, shop: null }), 'SHOP_NOT_FOUND');
  assert.equal(
    resolveBookingPageState({ ...blocked, shop: { is_accepting_online_bookings: false } }),
    'BOOKING_DISABLED',
  );
  assert.equal(resolveBookingPageState({ ...blocked, staffCount: 0 }), 'NO_STAFF');
  assert.equal(resolveBookingPageState(blocked), 'PAYMENT_NOT_CONFIGURED');
});
