import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertOrderTransition,
  calculateEarliestReadyDate,
  createOrderLineSnapshot,
  canCreateBookingForOrder,
  getOrderRuntimeUnavailable,
  calculateOrderRequirements,
  decideCancellationCapacityRelease,
  transitionOrder,
  materializeCapacityDays,
  decideSequentialReservation,
  assertPaymentTransition,
  assertDepositVerificationTransition,
  type CapacityDay,
} from '../order/core/index.ts';
import { authorizeOrderBookingLink } from '../order/core/booking-link.ts';
import { assertSameShop, isOpaqueTrackingToken, publicOrderProjection } from '../order/core/security.ts';
import { adaptBk01CatalogProductInput } from '../order/catalog-adaptation.ts';
import { getProductionOrderRuntimeStatus } from '../apps/booking-consumer/src/lib/order-runtime.ts';

test('accepts only canonical order lifecycle transitions', () => {
  assert.doesNotThrow(() => assertOrderTransition('SUBMITTED', 'CONFIRMED'));
  assert.throws(() => assertOrderTransition('DRAFT', 'READY'));
  assert.throws(() => assertOrderTransition('COMPLETED', 'CONFIRMED'));
});

test('requires actor and reason for auditable transitions and privileged recovery', () => {
  assert.deepEqual(transitionOrder('SUBMITTED', 'CONFIRMED', { actorId: 'merchant-1', reason: 'capacity accepted' }), { from: 'SUBMITTED', to: 'CONFIRMED', actorId: 'merchant-1', reason: 'capacity accepted' });
  assert.throws(() => transitionOrder('CANCELLED', 'SUBMITTED', { actorId: 'merchant-1', reason: '' }));
  assert.doesNotThrow(() => transitionOrder('CANCELLED', 'SUBMITTED', { actorId: 'merchant-1', reason: 'customer correction', privilegedRecovery: true }));
});

test('uses maximum line lead and quantity multiplied by snapshotted capacity', () => {
  const result = calculateOrderRequirements([
    createOrderLineSnapshot({ id: 'a', name: 'A', sku: 'A', unitPriceSatang: 100, leadDays: 2, capacityUnits: 3 }, 2),
    createOrderLineSnapshot({ id: 'b', name: 'B', sku: 'B', unitPriceSatang: 100, leadDays: 5, capacityUnits: 1 }, 4),
  ]);
  assert.deepEqual(result, { requiredLeadDays: 5, requiredCapacityUnits: 10 });
});

test('reports an earlier requested date truthfully instead of silently promising it', () => {
  const result = calculateEarliestReadyDate({ today: '2026-09-08', requiredLeadDays: 1, requiredCapacityUnits: 1, requestedReadyDate: '2026-09-08', days: [{ date: '2026-09-09', isOpen: true, effectiveCapacityUnits: 1, reservedUnits: 0 }] });
  assert.equal(result.requestedDateFeasible, false);
});

test('releases reserved capacity only for cancellable pre-production lifecycle', () => {
  assert.equal(decideCancellationCapacityRelease('CONFIRMED'), 'RELEASE');
  assert.equal(decideCancellationCapacityRelease('IN_PROGRESS'), 'REQUIRES_PRIVILEGED_AUDIT');
  assert.throws(() => decideCancellationCapacityRelease('COMPLETED'));
});

test('sequential reservation decisions never accept over-capacity state', () => {
  const first = decideSequentialReservation({ effectiveCapacityUnits: 5, reservedUnits: 1, requestedUnits: 3 });
  assert.deepEqual(first, { accepted: true, nextReservedUnits: 4 });
  assert.deepEqual(decideSequentialReservation({ effectiveCapacityUnits: 5, reservedUnits: first.nextReservedUnits, requestedUnits: 2 }), { accepted: false, nextReservedUnits: 4 });
});

test('production runtime adapter fails closed and never returns a fake order success', async () => {
  const result = await getOrderRuntimeUnavailable().submitPublicOrder();
  assert.deepEqual(result, { available: false, code: 'ORDER_RUNTIME_UNAVAILABLE' });
});

test('snapshots catalog values independently from later catalog edits', () => {
  const catalog = { id: 'product-1', name: 'โต๊ะ', sku: 'TABLE-1', unitPriceSatang: 125000, leadDays: 3, capacityUnits: 2, depositAmountSatang: 25000, fulfillmentType: 'ON_SITE_SERVICE' as const, appointmentRequired: true };
  const line = createOrderLineSnapshot(catalog, 2);
  catalog.name = 'โต๊ะใหม่';
  catalog.unitPriceSatang = 1;
  assert.equal(line.name, 'โต๊ะ');
  assert.equal(line.unitPriceSatang, 125000);
  assert.equal(line.capacityUnits, 2);
  assert.equal(line.depositAmountSatang, 25000);
  assert.equal(line.appointmentRequired, true);
  assert.equal(line.fulfillmentType, 'ON_SITE_SERVICE');
});

test('finds earliest open date with lead and enough single-day capacity', () => {
  const days: CapacityDay[] = [
    { date: '2026-09-09', isOpen: true, effectiveCapacityUnits: 10, reservedUnits: 0 },
    { date: '2026-09-10', isOpen: false, effectiveCapacityUnits: 10, reservedUnits: 0 },
    { date: '2026-09-11', isOpen: true, effectiveCapacityUnits: 4, reservedUnits: 3 },
    { date: '2026-09-12', isOpen: true, effectiveCapacityUnits: 4, reservedUnits: 1 },
  ];
  const result = calculateEarliestReadyDate({ today: '2026-09-08', requiredLeadDays: 2, requiredCapacityUnits: 3, days });
  assert.equal(result.scheduledProductionDate, '2026-09-12');
  assert.equal(result.promisedReadyDate, '2026-09-12');
});

test('materializes weekly calendar with explicit closure and capacity overrides', () => {
  const days = materializeCapacityDays({
    fromDate: '2026-09-07', throughDate: '2026-09-09',
    weekly: [{ weekday: 1, isOpen: true, baseCapacityUnits: 5 }, { weekday: 2, isOpen: true, baseCapacityUnits: 5 }, { weekday: 3, isOpen: true, baseCapacityUnits: 5 }],
    overrides: [{ date: '2026-09-08', isOpen: false }, { date: '2026-09-09', effectiveCapacityUnits: 8 }],
    reservedByDate: { '2026-09-09': 2 },
  });
  assert.deepEqual(days, [
    { date: '2026-09-07', isOpen: true, effectiveCapacityUnits: 5, reservedUnits: 0 },
    { date: '2026-09-08', isOpen: false, effectiveCapacityUnits: 5, reservedUnits: 0 },
    { date: '2026-09-09', isOpen: true, effectiveCapacityUnits: 8, reservedUnits: 2 },
  ]);
});

test('sorts candidate days and rejects a requested day that is closed or lacks capacity', () => {
  const days: CapacityDay[] = [
    { date: '2026-09-12', isOpen: true, effectiveCapacityUnits: 5, reservedUnits: 0 },
    { date: '2026-09-09', isOpen: true, effectiveCapacityUnits: 5, reservedUnits: 0 },
    { date: '2026-09-10', isOpen: false, effectiveCapacityUnits: 5, reservedUnits: 0 },
  ];
  const earliest = calculateEarliestReadyDate({ today: '2026-09-08', requiredLeadDays: 1, requiredCapacityUnits: 2, requestedReadyDate: '2026-09-10', days });
  assert.equal(earliest.scheduledProductionDate, '2026-09-09');
  assert.equal(earliest.requestedDateFeasible, false);
});

test('rejects unsafe money multiplication and invalid capacity inputs', () => {
  assert.throws(() => createOrderLineSnapshot({ id: 'a', name: 'A', sku: 'A', unitPriceSatang: Number.MAX_SAFE_INTEGER, leadDays: 0, capacityUnits: 1 }, 2));
  assert.throws(() => calculateEarliestReadyDate({ today: '2026-09-08', requiredLeadDays: 0, requiredCapacityUnits: 1, days: [{ date: '2026-09-08', isOpen: true, effectiveCapacityUnits: 1, reservedUnits: 2 }] }));
});

test('privileged recovery permits only explicit terminal recovery targets', () => {
  assert.doesNotThrow(() => transitionOrder('CANCELLED', 'SUBMITTED', { actorId: 'merchant-1', reason: 'validated correction', privilegedRecovery: true }));
  assert.throws(() => transitionOrder('COMPLETED', 'CANCELLED', { actorId: 'merchant-1', reason: 'invalid rewrite', privilegedRecovery: true }));
});

test('does not allow appointment creation before an appointment-required order is READY', () => {
  assert.equal(canCreateBookingForOrder({ lifecycle: 'CONFIRMED', appointmentRequired: true }), false);
  assert.equal(canCreateBookingForOrder({ lifecycle: 'READY', appointmentRequired: true }), true);
});

test('Order to Booking link delegates authority and is READY-only', () => {
  const base = { shopId: 'shop-1', orderId: 'order-1', bookingId: 'booking-1', idempotencyKey: 'idem-1', fulfillmentType: 'ON_SITE_SERVICE' as const, appointmentRequired: true as const };
  assert.deepEqual(authorizeOrderBookingLink({ ...base, orderLifecycle: 'CONFIRMED' }), { allowed: false, reason: 'READY_REQUIRED' });
  assert.deepEqual(authorizeOrderBookingLink({ ...base, orderLifecycle: 'READY' }), { allowed: true, reason: 'DELEGATE_TO_BOOKING' });
  assert.deepEqual(authorizeOrderBookingLink({ ...base, orderLifecycle: 'READY', fulfillmentType: 'PICKUP' }), { allowed: false, reason: 'FULFILLMENT_NOT_APPOINTMENT' });
});

test('security boundaries reject cross-shop references and weak tracking tokens', () => {
  assert.throws(() => assertSameShop('shop-1', 'shop-2'));
  assert.doesNotThrow(() => assertSameShop('shop-1', 'shop-1'));
  assert.equal(isOpaqueTrackingToken('phone-0812345678'), false);
  assert.equal(isOpaqueTrackingToken('trk_9d4f6e3c81a74f2e'), true);
  assert.deepEqual(publicOrderProjection({ orderId: 'o1', customerPhone: '0812345678', lifecycle: 'READY', totalSatang: 1000 }), { orderId: 'o1', lifecycle: 'READY' });
});

test('lifecycle, payment and deposit state domains stay independently typed', () => {
  const lifecycle: import('../order/core/index.ts').OrderLifecycle = 'CONFIRMED';
  const payment: import('../order/core/index.ts').OrderPaymentState = 'UNPAID';
  const deposit: import('../order/core/index.ts').DepositVerificationState = 'PENDING';
  assert.deepEqual({ lifecycle, payment, deposit }, { lifecycle: 'CONFIRMED', payment: 'UNPAID', deposit: 'PENDING' });
  assert.doesNotThrow(() => assertPaymentTransition('UNPAID', 'PARTIALLY_PAID'));
  assert.throws(() => assertPaymentTransition('REFUNDED', 'PAID'));
  assert.doesNotThrow(() => assertDepositVerificationTransition('REJECTED', 'PENDING'));
  assert.throws(() => assertDepositVerificationTransition('VERIFIED', 'REJECTED'));
});

test('rejects empty orders and invalid line quantities', () => {
  assert.throws(() => calculateOrderRequirements([]));
  assert.throws(() => createOrderLineSnapshot({ id: 'a', name: 'A', sku: 'A', unitPriceSatang: 1, leadDays: 0, capacityUnits: 1 }, 0));
  assert.throws(() => createOrderLineSnapshot({ id: 'a', name: 'A', sku: 'A', unitPriceSatang: 1, leadDays: 0, capacityUnits: 1, depositAmountSatang: -1 }, 1));
  const huge = createOrderLineSnapshot({ id: 'a', name: 'A', sku: 'A', unitPriceSatang: 0, leadDays: 0, capacityUnits: Number.MAX_SAFE_INTEGER }, 1);
  assert.throws(() => calculateOrderRequirements([huge, huge]));
});

test('rejects invalid calendar dates and ambiguous duplicate rules', () => {
  assert.throws(() => calculateEarliestReadyDate({ today: '2026-02-30', requiredLeadDays: 0, requiredCapacityUnits: 1, days: [] }));
  assert.throws(() => materializeCapacityDays({
    fromDate: '2026-09-07', throughDate: '2026-09-08',
    weekly: [{ weekday: 1, isOpen: true, baseCapacityUnits: 1 }, { weekday: 1, isOpen: false, baseCapacityUnits: 0 }],
    overrides: [], reservedByDate: {},
  }));
});

test('does not expose inventory or stock reservation semantics in Order line snapshots', () => {
  const line = createOrderLineSnapshot({ id: 'a', name: 'A', sku: 'A', unitPriceSatang: 100, leadDays: 0, capacityUnits: 1 }, 1);
  assert.equal('stockQuantity' in line, false);
  assert.equal('inventoryReserved' in line, false);
});

test('BK01 catalog adaptation forces inventory semantics off and rejects stock inputs', () => {
  assert.deepEqual(adaptBk01CatalogProductInput({ name: 'A', sku: 'A', price: 100 }), { name: 'A', sku: 'A', price: 100, stockQuantity: 0, trackInventory: false });
  assert.throws(() => adaptBk01CatalogProductInput({ name: 'A', sku: 'A', price: 100, stockQuantity: 1 }));
  assert.throws(() => adaptBk01CatalogProductInput({ name: 'A', sku: 'A', price: 100, trackInventory: true }));
});

test('runtime-unavailable submit result contains no order identity or payment success', async () => {
  const result = await getOrderRuntimeUnavailable().submitPublicOrder();
  assert.equal('orderId' in result, false);
  assert.equal('paymentStatus' in result, false);
});

test('consumer production surface reads a fail-closed runtime status', () => {
  assert.deepEqual(getProductionOrderRuntimeStatus(), { available: false, code: 'ORDER_RUNTIME_UNAVAILABLE' });
});
