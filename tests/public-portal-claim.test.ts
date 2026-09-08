import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  resolveShopCapabilities,
  selectPortalCards,
  disabledCapabilities,
  hasAnyCapability,
} from '../apps/booking-consumer/src/lib/public-portal.ts';
import {
  CLAIM_RUNTIME_NOT_ENABLED,
  CANONICAL_TICKET_TYPES,
  CLAIM_CATEGORIES,
  claimCategoryToTicketType,
  stripForbiddenClaimFields,
  isPlausibleReferenceToken,
  isRawUuid,
  looksLikePhone,
  toPublicClaimStatus,
  projectPublicClaimTracking,
  PUBLIC_CLAIM_TRACKING_FIELDS,
  productionClaimAdapter,
  validateClaimSubmission,
  validateClaimContextRequest,
  validateTrackingRequest,
  type PublicClaimInput,
  type PublicClaimAdapter,
} from '../apps/booking-consumer/src/lib/public-claim.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const VALID_MANAGE_TOKEN = 'A1B2C3D4E5'; // shape of local_service link_token
const VALID_TRACK_TOKEN = 'clm_9f3b2a7c1d8e4506ab12';

const baseClaimInput = (over: Partial<PublicClaimInput> = {}): PublicClaimInput => ({
  shopSlug: 'good-cuts-barber',
  origin: { kind: 'standalone' },
  customerName: 'Somchai',
  customerPhone: '0812345678',
  category: 'product',
  description: 'The item arrived cracked.',
  idempotencyKey: 'idem-11112222',
  ...over,
});

// 1. Capability combinations render only permitted cards.
test('portal renders only the enabled capability cards', () => {
  const all = resolveShopCapabilities({
    isAcceptingOnlineBookings: true,
    orderEnabled: true,
    claimEnabled: true,
  });
  assert.deepEqual(
    selectPortalCards('shopx', all).map((c) => c.capability),
    ['booking', 'order', 'claim'],
  );

  const bookingOnly = resolveShopCapabilities({ isAcceptingOnlineBookings: true });
  assert.deepEqual(selectPortalCards('shopx', bookingOnly), [
    { capability: 'booking', href: '/book/shopx' },
  ]);

  const orderClaim = resolveShopCapabilities({ orderEnabled: true, claimEnabled: true });
  assert.deepEqual(
    selectPortalCards('shopx', orderClaim).map((c) => c.href),
    ['/order/shopx', '/shop/shopx/claim'],
  );
});

// 2. All-disabled and shop-not-found states fail safely.
test('all-disabled resolves to zero cards and every capability listed disabled', () => {
  const none = resolveShopCapabilities(null);
  assert.equal(hasAnyCapability(none), false);
  assert.deepEqual(selectPortalCards('shopx', none), []);
  assert.deepEqual(disabledCapabilities(none), ['booking', 'order', 'claim']);
});

test('production capability source can never enable order or claim', () => {
  // Only the booking signal is real today; anything else is fail-closed.
  const caps = resolveShopCapabilities({ isAcceptingOnlineBookings: true });
  assert.equal(caps.orderEnabled, false);
  assert.equal(caps.claimEnabled, false);
  // Non-boolean truthy values must not slip through the strict check.
  const loose = resolveShopCapabilities({
    isAcceptingOnlineBookings: 1 as unknown as boolean,
    orderEnabled: 'yes' as unknown as boolean,
  });
  assert.equal(loose.bookingEnabled, false);
  assert.equal(loose.orderEnabled, false);
});

// 3. Booking card preserves the existing route contract.
test('booking card deep-links to the established /book/[slug] route', () => {
  const caps = resolveShopCapabilities({ isAcceptingOnlineBookings: true });
  assert.equal(selectPortalCards('demo-shop', caps)[0].href, '/book/demo-shop');
  assert.match(read('apps/booking-consumer/src/lib/public-portal.ts'), /\/book\/\$\{slug\}/);
  // The portal must not rewrite or redirect the established booking route.
  const portalSource = read('apps/booking-consumer/src/app/shop/[slug]/page.tsx');
  assert.doesNotMatch(portalSource, /redirect\(|rewrite\(|permanentRedirect\(/);
});

// 4. Claim runtime unavailable cannot return fake success.
test('production claim adapter never fabricates success', async () => {
  const submit = await productionClaimAdapter.submitPublicClaim(baseClaimInput());
  assert.equal(submit.ok, false);
  assert.equal(submit.code, CLAIM_RUNTIME_NOT_ENABLED);

  const context = await productionClaimAdapter.getPublicClaimContext({
    shopSlug: 'good-cuts-barber',
    origin: 'standalone',
  });
  assert.equal(context.ok, false);

  const tracking = await productionClaimAdapter.getPublicClaimTracking({
    token: VALID_TRACK_TOKEN,
  });
  assert.equal(tracking.ok, false);
  assert.equal(tracking.code, CLAIM_RUNTIME_NOT_ENABLED);

  // Across a matrix of valid and invalid inputs, no production path ever
  // returns ok:true or invents a publicRef.
  const submitCases = [
    baseClaimInput(),
    baseClaimInput({ origin: { kind: 'booking', manageToken: VALID_MANAGE_TOKEN } }),
    baseClaimInput({ origin: { kind: 'order', trackingToken: VALID_TRACK_TOKEN } }),
    baseClaimInput({ category: 'refund' }),
  ];
  for (const input of submitCases) {
    const res = await productionClaimAdapter.submitPublicClaim(input);
    assert.equal(res.ok, false);
    assert.equal('publicRef' in res, false);
  }
  for (const claimEnabled of [undefined, false, true]) {
    const ctx = await productionClaimAdapter.getPublicClaimContext({
      shopSlug: 'good-cuts-barber',
      origin: 'standalone',
      capabilitySource: { claimEnabled },
    });
    assert.equal(ctx.ok, false);
  }
});

// 5. Customer cannot set internal Ticket fields.
test('forbidden internal ticket fields are stripped from customer payload', () => {
  const dirty = {
    description: 'legit',
    priority: 'High',
    status: 'Resolved',
    assignedTo: 'staff-1',
    due_at: '2026-01-01',
    resolution: 'closed as fixed',
    shop_id: 'other-shop',
    booking_id: '11111111-1111-4111-8111-111111111111',
  };
  const clean = stripForbiddenClaimFields(dirty);
  assert.deepEqual(Object.keys(clean), ['description']);
});

test('category mapping stays inside the canonical ticket type enum', () => {
  for (const category of CLAIM_CATEGORIES) {
    assert.ok(CANONICAL_TICKET_TYPES.includes(claimCategoryToTicketType(category)));
  }
  assert.equal(claimCategoryToTicketType('refund'), 'RefundRequest');
});

// 6. Naked booking/order IDs are insufficient claim authority.
test('a naked booking/order id is rejected as claim authority', () => {
  const rawId = '11111111-1111-4111-8111-111111111111';
  assert.equal(isRawUuid(rawId), true);
  assert.equal(isPlausibleReferenceToken(rawId), false);

  const bookingByRawId = validateClaimSubmission(
    baseClaimInput({ origin: { kind: 'booking', manageToken: rawId } }),
  );
  assert.equal(bookingByRawId?.code, 'INVALID_REFERENCE');

  const orderByRawId = validateClaimSubmission(
    baseClaimInput({ origin: { kind: 'order', trackingToken: rawId } }),
  );
  assert.equal(orderByRawId?.code, 'INVALID_REFERENCE');

  // A real customer-held manage token passes shape validation.
  assert.equal(
    validateClaimSubmission(
      baseClaimInput({ origin: { kind: 'booking', manageToken: VALID_MANAGE_TOKEN } }),
    ),
    null,
  );
});

// 7. Phone-only tracking / enumeration is absent.
test('tracking rejects a phone number and has no phone lookup path', () => {
  assert.equal(looksLikePhone('0812345678'), true);
  assert.equal(validateTrackingRequest({ token: '0812345678' })?.code, 'INVALID_REFERENCE');
  assert.equal(validateTrackingRequest({ token: '081-234-5678' })?.code, 'INVALID_REFERENCE');
  assert.equal(validateTrackingRequest({ token: '12345' })?.code, 'INVALID_REFERENCE');

  const adapterSource = read('apps/booking-consumer/src/lib/public-claim.ts');
  const contractSource = read('apps/booking-consumer/src/lib/public-claim.ts');
  for (const source of [adapterSource, contractSource]) {
    assert.doesNotMatch(source, /by[_-]?phone|fetchClaimsByPhone|customer_phone.*list/i);
  }
});

// 8. Public tracking projection excludes private ticket fields.
test('public tracking projection whitelists only customer-safe fields', () => {
  const projected = projectPublicClaimTracking({
    publicRef: 'CLM-1234',
    status: 'in_review',
    submittedAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T01:00:00Z',
    merchantMessage: 'We are checking with the workshop.',
    // private fields that must not survive:
    assignedTo: 'staff-1',
    internalNotes: 'customer is upset',
    resolution: 'pending',
    shopId: 'shop-1',
    customerPhone: '0812345678',
  });
  assert.deepEqual(Object.keys(projected).sort(), [...PUBLIC_CLAIM_TRACKING_FIELDS].sort());
  assert.equal((projected as Record<string, unknown>).assignedTo, undefined);
  assert.equal((projected as Record<string, unknown>).internalNotes, undefined);
});

test('internal ticket status collapses to a coarse public status', () => {
  assert.equal(toPublicClaimStatus('New'), 'received');
  assert.equal(toPublicClaimStatus('Acknowledged'), 'received');
  assert.equal(toPublicClaimStatus('WaitingForCustomer'), 'waiting_for_you');
  assert.equal(toPublicClaimStatus('Closed'), 'closed');
  assert.equal(toPublicClaimStatus('SomethingInternalWeAdded'), 'received');
});

// 9. Cross-shop / reference-substitution is rejected by adapter validation.
test('adapter validation requires an explicit, well-formed shop and reference', () => {
  assert.equal(
    validateClaimSubmission(baseClaimInput({ shopSlug: '' }))?.code,
    'INVALID_SHOP',
  );
  assert.equal(
    validateClaimSubmission(baseClaimInput({ shopSlug: '../other-shop' }))?.code,
    'INVALID_SHOP',
  );
  assert.equal(
    validateClaimContextRequest({ shopSlug: 'shop-a', origin: 'booking' })?.code,
    'INVALID_REFERENCE',
  );
  assert.equal(
    validateClaimContextRequest({
      shopSlug: 'shop-a',
      origin: 'order',
      token: 'not a token!!',
    })?.code,
    'INVALID_REFERENCE',
  );
  // Well-formed request passes the client-side gate (row-level cross-shop
  // enforcement is server-side and runtime-blocked, see threat model).
  assert.equal(
    validateClaimContextRequest({
      shopSlug: 'shop-a',
      origin: 'booking',
      token: VALID_MANAGE_TOKEN,
    }),
    null,
  );
});

// 10. Duplicate submit contract carries an idempotency boundary.
test('claim submission requires a stable idempotency key', () => {
  assert.equal(
    validateClaimSubmission(baseClaimInput({ idempotencyKey: '' }))?.code,
    'INVALID_INPUT',
  );
  assert.equal(
    validateClaimSubmission(baseClaimInput({ idempotencyKey: 'short' }))?.code,
    'INVALID_INPUT',
  );
  assert.equal(validateClaimSubmission(baseClaimInput()), null);
});

// Interface swap-ability: an in-memory adapter satisfies the same contract.
// Fixture only — never imported by production pages.
test('the claim adapter interface is swappable (in-memory fixture)', async () => {
  const fixture: PublicClaimAdapter = {
    async getPublicClaimContext(req) {
      return {
        ok: true,
        shopSlug: req.shopSlug,
        shopName: 'Fixture Shop',
        claimEnabled: true,
        origin: req.origin,
      };
    },
    async submitPublicClaim(input) {
      const invalid = validateClaimSubmission(input);
      if (invalid) return invalid;
      return { ok: true, publicRef: 'CLM-TEST-0001', status: 'received' };
    },
    async getPublicClaimTracking() {
      return {
        ok: true,
        publicRef: 'CLM-TEST-0001',
        status: 'received',
        submittedAt: '2026-09-08T00:00:00Z',
        updatedAt: '2026-09-08T00:00:00Z',
        merchantMessage: null,
      };
    },
  };
  const res = await fixture.submitPublicClaim(baseClaimInput());
  assert.equal(res.ok, true);

  // Production pages import the fail-closed adapter, not any fixture.
  for (const page of [
    'apps/booking-consumer/src/app/shop/[slug]/claim/page.tsx',
    'apps/booking-consumer/src/app/claim/track/page.tsx',
  ]) {
    const source = read(page);
    assert.match(source, /productionClaimAdapter/);
    assert.doesNotMatch(source, /in-?memory|fixture|InMemory/i);
  }
});

// i18n coverage: every portal/claim key used exists in both locales.
test('portal and claim i18n keys exist in both locales', () => {
  const th = JSON.parse(read('apps/booking-consumer/messages/th.json'));
  const en = JSON.parse(read('apps/booking-consumer/messages/en.json'));
  for (const messages of [th, en]) {
    assert.ok(messages.portal, 'portal namespace present');
    assert.ok(messages.claim, 'claim namespace present');
    assert.ok(messages.claim.track.status.received);
    for (const category of CLAIM_CATEGORIES) {
      assert.ok(messages.claim.category[category], `claim.category.${category}`);
    }
  }
});

// No marketing guarantee copy in the new customer surfaces.
test('new claim copy makes no guaranteed-outcome promise', () => {
  const th = read('apps/booking-consumer/messages/th.json');
  const en = read('apps/booking-consumer/messages/en.json');
  const claimEn = JSON.stringify(JSON.parse(en).claim);
  const claimTh = JSON.stringify(JSON.parse(th).claim);
  assert.doesNotMatch(claimEn, /guarantee|guaranteed|refund within|response within/i);
  assert.doesNotMatch(claimTh, /รับประกัน|การันตี|คืนเงินแน่นอน/);
});
