#!/usr/bin/env node
// Non-vacuity harness for HOUSE-BK01-PACK-NOTIFY-APP (brief 25, units 6 + 7).
// Each mutation removes one behaviour the unit claims; the named test file must
// fail while the mutation is in place, and pass again once it is reverted.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const MUTATIONS = [
  {
    id: 'm1-reminder-event-back-to-24h',
    file: 'apps/booking-consumer/src/lib/customer-reminder-text.ts',
    from: "export const REMINDER_EVENT_TYPE = 'reminder_3h';",
    to: "export const REMINDER_EVENT_TYPE = 'reminder_24h';",
    test: 'tests/house-remind-3h.test.ts',
  },
  {
    id: 'm2-reminder-drops-queue-code',
    file: 'apps/booking-consumer/src/lib/customer-reminder-text.ts',
    from: 'รหัสคิว ${code}`,\n    `Reminder: ${shopName} on ${date} at ${time}, queue ${code}`',
    to: 'รหัสคิว ${code}`,\n    `Reminder: ${shopName} on ${date} at ${time}`',
    test: 'tests/house-remind-3h.test.ts',
  },
  {
    id: 'm3-free-loses-reminder-push',
    file: 'apps/booking-consumer/src/lib/notification-entitlement.ts',
    from: '  free: {\n    customer_reminder_push: true,',
    to: '  free: {\n    customer_reminder_push: false,',
    test: 'tests/house-pack-entitle.test.ts',
  },
  {
    id: 'm4-cap-boundary-off-by-one',
    file: 'apps/booking-consumer/src/lib/notification-push-budget.ts',
    from: '  return safeUsed < safeCap',
    to: '  return safeUsed <= safeCap',
    test: 'tests/house-pack-entitle.test.ts',
  },
  {
    id: 'm5-cap-unreadable-suppresses',
    file: 'apps/booking-consumer/src/lib/notification-push-budget.ts',
    from: "    return { allowed: true, unverified: true, reason: 'push_cap_unverified' };",
    to: "    return { allowed: false, unverified: false, reason: 'push_cap_reached' };",
    test: 'tests/house-pack-entitle.test.ts',
  },
  {
    id: 'm6-breach-threshold-removed',
    file: 'apps/booking-consumer/src/lib/notification-oa-breaker.ts',
    from: "  if (ratio > OA_QUOTA_BREAKER_THRESHOLD) {",
    to: "  if (ratio > 1.5) {",
    test: 'tests/house-pack-breaker-reply.test.ts',
  },
  {
    id: 'm7-breaker-mutes-every-plan',
    file: 'apps/booking-consumer/src/lib/notification-oa-breaker.ts',
    from: "  return effectivePlan === 'free';",
    to: "  return true;",
    test: 'tests/house-pack-breaker-reply.test.ts',
  },
  {
    id: 'm8-quota-urls-guessed-wrong',
    file: 'apps/booking-consumer/src/lib/notification-oa-breaker.ts',
    from: "export const CENTRAL_OA_CONSUMPTION_URL = 'https://api.line.me/v2/bot/message/quota/consumption';",
    to: "export const CENTRAL_OA_CONSUMPTION_URL = 'https://api.line.me/v2/bot/message/quota/usage';",
    test: 'tests/house-pack-breaker-reply.test.ts',
  },
  {
    id: 'm9-reply-failure-fails-the-binding',
    file: 'apps/booking-consumer/src/lib/line-webhook.ts',
    from: "        console.error('LINE binding reply could not be delivered', { eventIndex, code: 'REPLY_NOT_DELIVERED', reason: messageOf(replyError) });",
    to: "        throw replyError;",
    test: 'tests/house-pack-breaker-reply.test.ts',
  },
  {
    id: 'm10-flex-card-loses-queue-code',
    file: 'apps/booking-consumer/src/lib/line-flex-templates.ts',
    from: '          { type: \'text\', text: `รหัสคิว: ${details.bookingCode}`, color: \'#38BDF8\', size: \'sm\', weight: \'bold\', wrap: true },',
    to: '',
    test: 'tests/house-remind-3h.test.ts',
  },
  {
    id: 'm11-free-services-contract-back-to-3',
    file: 'apps/booking-admin/src/lib/commercial-contract.ts',
    from: 'export const FREE_PLAN_SERVICES = 5;',
    to: 'export const FREE_PLAN_SERVICES = 3;',
    test: 'tests/ui-truth.test.ts',
  },
  {
    id: 'm12-plan-copy-back-to-3-services',
    file: 'apps/booking-admin/messages/th.json',
    from: '"planFreeQ3": "✓ 5 บริการ',
    to: '"planFreeQ3": "✓ 3 บริการ',
    test: 'tests/bk01-i18n.test.ts',
  },
  // Round 1 review failures — the round-2 fixes must not be vacuous either.
  {
    id: 'm13-dispatcher-picks-a-merchant-oa-by-pack-name',
    file: 'apps/booking-consumer/src/lib/notification-dispatch.ts',
    from: '              const config = resolveCentralChannel();',
    to: "              const config = context.subscription_plan === 'basic_490' ? await import('../../../../lib/merchant-line-config').then((m) => m.resolveMerchantLineChannel(context.shop_id)) : resolveCentralChannel();",
    test: 'tests/house-pack-entitle.test.ts',
  },
  {
    id: 'm14-cap-literal-back-into-the-route',
    file: 'apps/booking-consumer/src/lib/notification-dispatch.ts',
    from: '              cap: context.monthly_push_cap,',
    to: '              cap: context.monthly_push_cap ?? 50,',
    test: 'tests/house-pack-entitle.test.ts',
  },
  {
    // REPOINTED: the alert gate now also carries the shop-UUID refusal
    // (`&& alertKey.ok`). Swallowing the whole branch stops the operator being told
    // the cap guard is not running, which the "reported to OPS_ALERT_EMAIL once per
    // run" case pins.
    id: 'm15-unverified-cap-stops-alerting-ops',
    file: 'apps/booking-consumer/src/lib/notification-dispatch.ts',
    from: '              if (!capAlertSent && alertKey.ok) {',
    to: '              if (false) {',
    test: 'tests/house-pack-entitle.test.ts',
  },
  {
    // RE-CHECKED against the two-phase sink: the anchor did NOT move. The claim gate
    // still lives in `sendOpsAlert` (`if (!claimed) return ...already_alerted_today`),
    // and `tests/house-pack-breaker-reply.test.ts` still goes red when it is dropped
    // — the "sent only when claimed=true" and "once per key per Thai day" cases both
    // depend on it.
    id: 'm16-ops-alert-ignores-the-day-ledger',
    file: 'apps/booking-consumer/src/lib/notification-oa-breaker.ts',
    from: "  if (!claimed) return { sent: false, reason: 'already_alerted_today', to, dedupeKey };",
    to: '  // mutation: the once-per-day limit is ignored',
    test: 'tests/house-pack-breaker-reply.test.ts',
  },
  // -------------------------------------------------------------------------
  // BK01 P0 application set (brief 28 §4 H1–H4, H6). Each mutation removes one
  // behaviour the unit claims and the named test file must go red.
  // -------------------------------------------------------------------------
  {
    id: 'p0-h1-unknown-event-falls-back-to-a-confirmation',
    file: 'apps/booking-consumer/src/lib/notification-customer-text.ts',
    from: '  if (spec === null || spec.disposition !== \'send_customer_line\') return null;',
    to: "  if (spec === null) return `ยืนยันคิวที่ ${shop(context)} วันที่ ${date(context)} เวลา ${time(context)}`;",
    test: 'tests/house-p0-app-events.test.ts',
  },
  {
    id: 'p0-h1-a-rejected-slip-reads-as-approved',
    file: 'apps/booking-consumer/src/lib/notification-customer-text.ts',
    from: "    case 'deposit_rejected':\n      return buildSlipRejectedText(context);",
    to: "    case 'deposit_rejected':\n      return buildSlipApprovedText(context);",
    test: 'tests/house-p0-app-events.test.ts',
  },
  {
    id: 'p0-h1-cancellation-is-suppressed-again',
    file: 'apps/booking-consumer/src/lib/notification-event-registry.ts',
    from: "    eventType: 'booking_cancelled',\n    recipient: 'customer',\n    channel: 'line',\n    entitlement: null,\n    meter: 'unmetered',\n    disposition: 'send_customer_line',",
    to: "    eventType: 'booking_cancelled',\n    recipient: 'customer',\n    channel: 'line',\n    entitlement: null,\n    meter: 'unmetered',\n    disposition: 'handled_elsewhere',",
    test: 'tests/house-p0-app-events.test.ts',
  },
  {
    id: 'p0-h1-a-shop-email-row-is-pushed-at-a-customer',
    file: 'apps/booking-consumer/src/lib/notification-event-registry.ts',
    from: "    eventType: 'shop_email_slip',\n    recipient: 'shop_owner',\n    channel: 'email',\n    entitlement: 'shop_email_slip',\n    meter: 'unmetered',\n    disposition: 'quarantine',",
    to: "    eventType: 'shop_email_slip',\n    recipient: 'customer',\n    channel: 'line',\n    entitlement: null,\n    meter: 'unmetered',\n    disposition: 'send_customer_line',",
    test: 'tests/house-p0-app-events.test.ts',
  },
  {
    id: 'p0-h2-usage-resolver-goes-back-to-null-and-the-cap-never-engages',
    file: 'apps/booking-consumer/src/lib/notification-dispatch.ts',
    from: '              used: usageResolver === defaultUsageResolver\n                ? contextPushUsage(context)\n                : await usageResolver(context.shop_id),',
    to: '              used: await usageResolver(context.shop_id),',
    test: 'tests/house-p0-app-cap-wiring.test.ts',
  },
  {
    id: 'p0-h2-quota-unreadable-stops-alerting-ops',
    file: 'apps/booking-consumer/src/lib/notification-dispatch.ts',
    from: '    if (quotaReadNeedsAlert(quotaRead)) {',
    to: '    if (false) {',
    test: 'tests/house-p0-app-cap-wiring.test.ts',
  },
  {
    id: 'p0-h3-a-confirmed-retry-409-is-recorded-as-failed-again',
    file: 'apps/booking-consumer/src/lib/notification-line-outcome.ts',
    from: '  if (input.status === LINE_CONFLICT_STATUS && acceptedRequestId !== null) {\n    return { providerAccepted: true, acceptedRequestId, status: input.status };\n  }',
    to: '  // mutation: every 409 is a failure, whatever it names',
    test: 'tests/house-p0-app-line-outcome.test.ts',
  },
  {
    id: 'p0-h3-the-route-decides-delivery-from-response-ok-again',
    file: 'apps/booking-consumer/src/lib/notification-dispatch.ts',
    from: '              const outcome = resolveLinePushOutcome({\n                ok: response.ok,\n                status: response.status,\n                headers: response.headers,\n              });',
    to: '              const outcome = { providerAccepted: response.ok, acceptedRequestId: null, status: response.status } as any;',
    test: 'tests/house-p0-app-line-outcome.test.ts',
  },
  {
    id: 'p0-h4-a-missing-production-secret-becomes-a-pass',
    file: 'apps/booking-consumer/src/lib/booking-ingress.ts',
    from: "  if (env.NODE_ENV === 'production') return { secret: null, source: 'missing' };",
    to: '  // mutation: an unconfigured challenge lets every booking through',
    test: 'tests/house-p0-app-booking-ingress.test.ts',
  },
  {
    id: 'p0-h4-the-rate-limit-runs-after-the-challenge',
    file: 'apps/booking-consumer/src/lib/booking-hold.ts',
    from: '  const rate = consumeBookingRateLimit({ clientIp, shopId: request.shop_id });\n  if (!rate.allowed) {',
    to: '  const rate = { allowed: true, remaining: 0, key: "", retryAfterSeconds: null as number | null };\n  if (!rate.allowed) {',
    test: 'tests/house-p0-app-booking-ingress.test.ts',
  },
  {
    id: 'p0-h6-the-completed-button-ignores-the-appointment-time',
    file: 'apps/booking-admin/src/app/dashboard/page.tsx',
    from: "b.status === 'confirmed' && shopRole !== 'staff' && canOfferOutcomeActions(b)",
    to: "b.status === 'confirmed' && shopRole !== 'staff'",
    test: 'tests/house-p0-app-h6.test.ts',
  },
  {
    id: 'p0-h6-the-time-gate-parses-the-display-text-again',
    file: 'apps/booking-admin/src/lib/booking-outcome-gate.ts',
    from: '  const end = parseInstant(booking.endTime);',
    to: "  const end = parseInstant(`${String(booking.endTime)} +07:00`);",
    test: 'tests/house-p0-app-h6.test.ts',
  },
  {
    id: 'p0-h6-free-goes-back-to-three-services',
    file: 'apps/booking-admin/src/lib/business-type-starter-services.ts',
    from: '  free_trial: 5,',
    to: '  free_trial: 3,',
    test: 'tests/house-p0-app-h6.test.ts',
  },
  // ----- H5 round 2: the refund UI (mandatory textual transfer reference) -----
  {
    id: 'p0-h5-the-refund-reference-stops-being-sent',
    file: 'apps/booking-admin/src/lib/admin-service.ts',
    from: '    p_refund_reference: reference,',
    to: '    p_refund_reference: undefined as unknown as string,',
    test: 'tests/house-p0-app-refund-h5.test.ts',
  },
  {
    id: 'p0-h5-a-rejected-slip-counts-as-money-the-shop-holds',
    file: 'apps/booking-admin/src/lib/refund-eligibility.ts',
    from: "export const REFUND_HELD_DEPOSIT_STATES: ReadonlyArray<RefundableDepositStatus> = Object.freeze([\n  'submitted',\n  'verified',\n]);",
    to: "export const REFUND_HELD_DEPOSIT_STATES: ReadonlyArray<RefundableDepositStatus> = Object.freeze([\n  'submitted',\n  'verified',\n  'rejected',\n]);",
    test: 'tests/house-p0-app-refund-h5.test.ts',
  },
  {
    id: 'p0-h5-the-rule-ignores-the-released-queue',
    file: 'apps/booking-admin/src/lib/refund-eligibility.ts',
    from: '  if (queueWasReleased(booking.queueReleasedAt) && Date.parse(booking.queueReleasedAt as string) < nowMs) {',
    to: '  if (false as unknown as boolean) {',
    test: 'tests/house-p0-app-refund-h5.test.ts',
  },
  {
    id: 'p0-h5-an-unreadable-end-time-counts-as-over',
    file: 'apps/booking-admin/src/lib/refund-eligibility.ts',
    from: '  const endsAt = appointmentEndsAt(booking, timeZone);\n  if (endsAt === null) return false;',
    to: "  const endsAt = appointmentEndsAt(booking, timeZone) ?? '1970-01-01T00:00:00.000Z';",
    test: 'tests/house-p0-app-refund-h5.test.ts',
  },
  {
    id: 'p0-h5-the-reference-field-becomes-a-hard-coded-120',
    file: 'apps/booking-admin/src/app/dashboard/page.tsx',
    from: '                maxLength={REFUND_REFERENCE_MAX_LENGTH}',
    to: '                maxLength={120}',
    test: 'tests/house-p0-app-refund-h5.test.ts',
  },
  {
    id: 'p0-h5-the-refund-button-reaches-staff-too',
    file: 'apps/booking-admin/src/app/dashboard/page.tsx',
    from: 'shopRole !== \'staff\' && b.depositStatus !== \'refunded\' && canRecordRefund({',
    to: 'b.depositStatus !== \'refunded\' && canRecordRefund({',
    test: 'tests/house-p0-app-refund-h5.test.ts',
  },
  // -------------------------------------------------------------------------
  // R2-B A2c — the CLAIM / SEND / ACKNOWLEDGE contract and the corrected refund
  // rule. Each mutation removes one behaviour the tests claim and the named test
  // file must go red while it is in place.
  // -------------------------------------------------------------------------
  {
    // REMOVING THE CLAIM GATE — send regardless of `claimed`. This is the same
    // behaviour m16 removes, but anchored differently and aimed at a DIFFERENT
    // named test: the cap-alert dedupe case in `house-pack-entitle.test.ts` (three
    // runs on one key) goes red as soon as the already-claimed key no longer stops
    // the mail.
    id: 'r2-ops-alert-ignores-the-claim-it-was-refused',
    file: 'apps/booking-consumer/src/lib/notification-oa-breaker.ts',
    from: "  if (!claimed) return { sent: false, reason: 'already_alerted_today', to, dedupeKey };",
    to: "  if (false) return { sent: false, reason: 'already_alerted_today', to, dedupeKey };",
    test: 'tests/house-pack-entitle.test.ts',
  },
  {
    // The ACKNOWLEDGEMENT after the provider accepted the mail. Without it a
    // delivered alert stays claimable, so the ledger can never retire the key.
    id: 'r2-cap-unverified-alert-never-acknowledged',
    file: 'apps/booking-consumer/src/lib/notification-oa-breaker.ts',
    from: '    await input.sink.claim({ kind, key: dedupeKey, delivered: true });',
    to: '    // mutation: the acknowledgement is removed',
    test: 'tests/house-p0-app-cap-wiring.test.ts',
  },
  {
    // The provider idempotency key must be STABLE for a (kind, key) pair. A
    // timestamp re-mints on every call, so a crash-then-retry inside the claim
    // lease re-delivers the same alert.
    id: 'r2-provider-idempotency-key-is-a-timestamp',
    file: 'apps/booking-consumer/src/lib/notification-oa-breaker.ts',
    from: '  return `${kind}:${alertKey}`;',
    to: '  return `${kind}:${Date.now()}`;',
    test: 'tests/house-p0-app-cap-wiring.test.ts',
  },
  {
    // The `global` segment the F1/F2 migration validates for the two SYSTEM kinds
    // (facts about the ONE central OA, not about any shop). The bare
    // `<kind>:<day>` shape is a key SQL rejects.
    id: 'r2-system-alert-keys-drop-the-global-segment',
    file: 'apps/booking-consumer/src/lib/notification-oa-breaker.ts',
    from: '    return { ok: true, key: `${input.kind}:global:${day}` };',
    to: '    return { ok: true, key: `${input.kind}:${day}` };',
    test: 'tests/house-pack-entitle.test.ts',
  },
  {
    // The corrected refund rule: the SQL admits `rejected`, so the app must too.
    // Dropping it from the rule set makes the dashboard refuse a refund the
    // database would have accepted.
    id: 'r2-refund-rule-ignores-rejected',
    file: 'apps/booking-admin/src/lib/refund-eligibility.ts',
    from: "export const REFUNDABLE_DEPOSIT_STATES: ReadonlyArray<RefundableDepositStatus> = Object.freeze([\n  'submitted',\n  'verified',\n  'rejected',\n]);",
    to: "export const REFUNDABLE_DEPOSIT_STATES: ReadonlyArray<RefundableDepositStatus> = Object.freeze([\n  'submitted',\n  'verified',\n]);",
    test: 'tests/house-p0-app-refund-h5.test.ts',
  },
  // -------------------------------------------------------------------------
  // BK01 P1 G10 (2026-10-02 order) — the tenant-scoped recipient.
  // -------------------------------------------------------------------------
  {
    // Every claimed row must read its OWN delivery context. Taking the FIRST
    // claimed row's id for every iteration makes row-b borrow row-a's context —
    // a different `line_user_id` and shop name — which the cross-row recipient
    // case in `tests/house-p0-app-g10-line-binding.test.ts` must catch.
    id: 'p0-g10-recipient-takes-the-first-row',
    file: 'apps/booking-consumer/src/lib/notification-dispatch.ts',
    from: 'p_id: claim.id,',
    to: 'p_id: claimRows[0].id,',
    test: 'tests/house-p0-app-g10-line-binding.test.ts',
  },
  {
    // H6 projection binding: drop the server START instant from the dashboard
    // bookings select. The old test only grepped for the token `start_timestamptz`
    // anywhere in the file (the mapping line keeps it), so it survived this. The
    // rewritten case parses the select list, so it must go red.
    id: 'p0-h6-projection-drops-the-server-start',
    file: 'apps/booking-admin/src/lib/admin-service.ts',
    from: '        start_timestamptz,\n',
    to: '',
    test: 'tests/house-p0-app-h6.test.ts',
  },
];

const original = new Map();
let failures = 0;

for (const mutation of MUTATIONS) {
  const before = readFileSync(mutation.file, 'utf8');
  original.set(mutation.file, before);
  if (!before.includes(mutation.from)) {
    console.log(`✖ ${mutation.id}: mutation anchor not found in ${mutation.file}`);
    failures += 1;
    continue;
  }
  writeFileSync(mutation.file, before.replace(mutation.from, mutation.to));

  const run = spawnSync(process.execPath, [
    '--no-warnings', '--import', './tests/register-ts-loader.mjs',
    '--test', '--experimental-test-isolation=none', mutation.test,
  ], { encoding: 'utf8' });
  const red = run.status !== 0;

  writeFileSync(mutation.file, before);

  const rerun = spawnSync(process.execPath, [
    '--no-warnings', '--import', './tests/register-ts-loader.mjs',
    '--test', '--experimental-test-isolation=none', mutation.test,
  ], { encoding: 'utf8' });
  const green = rerun.status === 0;

  const ok = red && green;
  if (!ok) failures += 1;
  console.log(`${ok ? '✔' : '✖'} ${mutation.id}: mutation ${red ? 'RED' : 'GREEN(!)'} -> revert ${green ? 'GREEN' : 'RED(!)'} [${mutation.test}]`);
}

console.log(`\nmutations proven: ${MUTATIONS.length - failures}/${MUTATIONS.length}`);
process.exit(failures === 0 ? 0 : 1);
