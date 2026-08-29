import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPublicPlanPresentation,
  resolveMonthlyPlan,
} from '../apps/booking-admin/src/lib/commercial-contract.ts';

test('accepts only monthly Basic and Pro plan identifiers', () => {
  assert.equal(resolveMonthlyPlan('basic_490')?.priceEnvName, 'STRIPE_PRICE_BASIC');
  assert.equal(resolveMonthlyPlan('pro_990')?.priceEnvName, 'STRIPE_PRICE_PRO');
  assert.equal(resolveMonthlyPlan('basic_annual'), null);
  assert.equal(resolveMonthlyPlan('pro_annual'), null);
  assert.equal(resolveMonthlyPlan(undefined), null);
});

test('presents pilot prices as provisional and no paid booking wall', () => {
  assert.deepEqual(getPublicPlanPresentation('basic_490'), {
    referencePriceThb: 490,
    priceStatus: 'pilot-reference-not-final',
    paidBookingLimit: null,
    staffLimit: 5,
  });
  assert.deepEqual(getPublicPlanPresentation('pro_990'), {
    referencePriceThb: 990,
    priceStatus: 'pilot-reference-not-final',
    paidBookingLimit: null,
    staffLimit: 10,
  });
});

