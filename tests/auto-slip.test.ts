import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyAutoSlipResult } from '../apps/booking-admin/src/lib/auto-slip.ts';

test('auto-confirms only an exact positive provider result', () => {
  assert.equal(classifyAutoSlipResult({ status: 'verified', amountMatches: true, recipientMatches: true, transactionReference: 'TX-1' }), 'verified');
});

test('keeps timeout unknown ambiguous and provider errors in manual review', () => {
  for (const status of ['timeout', 'unknown', 'ambiguous', 'provider_error'] as const) {
    assert.equal(classifyAutoSlipResult({ status }), 'manual_review');
  }
  assert.equal(classifyAutoSlipResult({ status: 'verified', amountMatches: false, recipientMatches: true, transactionReference: 'TX-2' }), 'manual_review');
  assert.equal(classifyAutoSlipResult({ status: 'verified', amountMatches: true, recipientMatches: true }), 'manual_review');
});
