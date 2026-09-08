import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertOrderTransition,
  calculateEarliestReadyDate,
  createOrderLineSnapshot,
  canCreateBookingForOrder,
  getOrderRuntimeUnavailable,
  type CapacityDay,
} from '../order/core/index.ts';

test('accepts only canonical order lifecycle transitions', () => {
  assert.doesNotThrow(() => assertOrderTransition('SUBMITTED', 'CONFIRMED'));
  assert.throws(() => assertOrderTransition('DRAFT', 'READY'));
  assert.throws(() => assertOrderTransition('COMPLETED', 'CONFIRMED'));
});

test('production runtime adapter fails closed and never returns a fake order success', async () => {
  const result = await getOrderRuntimeUnavailable().submitPublicOrder();
  assert.deepEqual(result, { available: false, code: 'ORDER_RUNTIME_UNAVAILABLE' });
});

test('snapshots catalog values independently from later catalog edits', () => {
  const catalog = { id: 'product-1', name: 'โต๊ะ', sku: 'TABLE-1', unitPriceSatang: 125000, leadDays: 3, capacityUnits: 2 };
  const line = createOrderLineSnapshot(catalog, 2);
  catalog.name = 'โต๊ะใหม่';
  catalog.unitPriceSatang = 1;
  assert.equal(line.name, 'โต๊ะ');
  assert.equal(line.unitPriceSatang, 125000);
  assert.equal(line.capacityUnits, 2);
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

test('does not allow appointment creation before an appointment-required order is READY', () => {
  assert.equal(canCreateBookingForOrder({ lifecycle: 'CONFIRMED', appointmentRequired: true }), false);
  assert.equal(canCreateBookingForOrder({ lifecycle: 'READY', appointmentRequired: true }), true);
});
