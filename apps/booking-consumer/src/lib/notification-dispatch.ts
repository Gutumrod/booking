import { resolveLineChannelConfig } from './line-channel-config';
import { nextNotificationAttempt } from './notification-policy';
import {
  notificationEventSpec,
} from './notification-event-registry';
import { buildCustomerEventText } from './notification-customer-text';
import {
  linePushFailureMessage,
  resolveLinePushOutcome,
  LINE_RETRY_KEY_HEADER,
} from './notification-line-outcome';
import {
  entitlementsForPlan,
  isEffectivePlan,
  resolveEffectivePlan,
  type EffectivePlan,
  type PlanNotificationEntitlements,
} from './notification-entitlement';
import {
  countsAgainstPushCap,
  resolvePushCapDecision,
} from './notification-push-budget';
import {
  breakerMutesPlan,
  createLineQuotaTransport,
  createPushAlertSink,
  pushAlertDedupeKey,
  quotaReadNeedsAlert,
  readCentralOaQuota,
  resolveBreakerDecision,
  sendOpsAlert,
  type OpsAlertTransport,
  type PushAlertSink,
  type QuotaTransport,
} from './notification-oa-breaker';
import { type PushAlertKind } from './notification-alert-kind';

/**
 * The outbound LINE notification dispatcher (BK01 P0 H1–H3, brief 25 units 6+7).
 *
 * The handler lives here, in a library module, rather than in the App Router route
 * module (`app/api/notifications/dispatch/route.ts`). Next 16.3.6 asserts that a
 * route module exports nothing but the HTTP methods and the documented config
 * symbols; a non-method export fails the production build as TS2344. The route
 * re-exports only `POST`, which delegates here with the same defaults.
 *
 * The channel decision (A-21, 2026-10-01): EVERY pack sends through the ONE
 * central OA. The per-shop merchant OA stays in the repository but is switched
 * off — `resolveMerchantLineChannel` / `merchant-line-config.ts` are deliberately
 * NOT called from this handler any more (an operator-configured merchant channel
 * would contradict the Owner's decision and send the customer a message from a
 * channel that was never provisioned).
 *
 * The merchant path is preserved for the future because the Owner described it as
 * an add-on ("OA ร้านเอง = เก็บไว้ทำอนาคต", A-21 item 3): when it is re-enabled the
 * decision must be made on a CAPABILITY the database reports (a per-shop channel
 * entitlement in the delivery context) and never on the pack's NAME, which is the
 * mistake the round-1 review found at this spot. The merchant webhook ingress
 * (`/api/line/webhook/merchant/[shopId]`) still uses the module; only the outbound
 * send path is closed.
 */
function resolveCentralChannel() {
  return resolveLineChannelConfig({
    mode: 'trial',
    centralSecret: process.env.LINE_CHANNEL_SECRET,
    centralAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  });
}

type ClaimedNotification = { id: string; shop_id: string; event_type: string; attempt_count: number };
type DeliveryContext = {
  id: string; shop_id: string; event_type: string; recipient_type: string;
  attempt_count: number; line_user_id: string | null; line_oa_id: string | null; shop_name: string | null;
  subscription_plan: string | null; booking_date: string; start_time: string;
  /**
   * Filled once the unit-7 SQL lands (brief 25 §"สเปก SQL"): the resolved
   * entitlement facts, so the pack decision comes from the database and this
   * file's mirror table is only a fallback. Absent today.
   */
  booking_code?: string | null;
  subscription_status?: string | null;
  current_period_end?: string | null;
  trial_ends_at?: string | null;
  customer_reminder_push?: boolean | null;
  customer_slip_decision_push?: boolean | null;
  monthly_push_cap?: number | null;
  /**
   * Metered customer pushes this shop has already sent in the Thai month, as the
   * unit-7 SQL builds it. H2: this column is what makes the cap engage — with none
   * supplied the guard stays `unverified` (allowed + reported), which is the
   * deliberate cost-guard direction, not an accident.
   */
  push_used_this_month?: number | null;
  /**
   * The booking's deposit outcome and the reason the shop recorded.
   *
   * H1 needs these because `deposit_slip_decision` is produced for BOTH a verified
   * and a rejected slip: without an outcome the dispatcher cannot word the message,
   * and the round-1 defect was it wording that case as a confirmation. They are
   * OPTIONAL because the delivery-context RPC in the SQL contract as it stands
   * returns neither (`get_line_notification_delivery_context`, group67 §129-179) —
   * the context schema is a SQL contract item reported to the controller. When they
   * are absent the row is HELD (`event_text_unavailable`), never guessed.
   */
  deposit_status?: string | null;
  decision_reason?: string | null;
};
type RuntimeClient = Awaited<ReturnType<typeof import('./bk01-runtime').getBk01RuntimeClient>>;
type RuntimeProvider = () => Promise<RuntimeClient>;
const defaultRuntimeProvider: RuntimeProvider = async () => (await import('./bk01-runtime')).getBk01RuntimeClient();

/** How many metered pushes this shop has already sent in the Thai month. */
type PushUsageResolver = (shopId: string) => Promise<number | null>;

/** Resend's send-email endpoint (`https://resend.com/docs/api-reference/emails/send-email`). */
export const RESEND_ALERT_ENDPOINT = 'https://api.resend.com/emails';

/**
 * The header Resend documents for "prevent duplicated emails". It is a NAMED
 * constant so the call site cannot drift from the provider's spelling, and it is
 * the app's half of the exactly-once promise SQL cannot make.
 *
 * A stable key from `sendOpsAlert` (`<kind>:<key>`, i.e. one per alert kind per
 * Thai day) also means the provider collapses a crash-then-retry inside the
 * five-minute claim lease. Resend expires idempotency keys after 24h, which is
 * longer than the one-alert-per-Thai-day window it has to cover.
 */
export const RESEND_IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * The REAL operator-alert transport (PART A item 5): Resend's `POST /emails`.
 *
 * FAIL-CLOSED, and specifically fail-SILENT towards the caller: with no API key,
 * no sender address or a missing recipient there is NO outbound call at all and the
 * result is `ok: false`. It never throws past `sendOpsAlert` — a transport that
 * rejects would be an unhandled failure in the dispatcher, and the honest answer to
 * "we cannot send" is a failure result, not an exception.
 */
export function createResendOpsAlertTransport(
  env: Record<string, string | undefined>,
  send: typeof fetch = fetch,
): OpsAlertTransport {
  return {
    async send({ to, subject, text, idempotencyKey }) {
      const apiKey = env.RESEND_API_KEY?.trim() ?? '';
      const from = env.OPS_ALERT_FROM?.trim() ?? '';
      if (apiKey.length === 0 || from.length === 0 || to.trim().length === 0) {
        // No configuration ⇒ no send. It must never pretend the Owner was told.
        return { ok: false, status: 0, error: 'resend_not_configured' };
      }
      try {
        const response = await send(RESEND_ALERT_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            [RESEND_IDEMPOTENCY_HEADER]: idempotencyKey,
          },
          body: JSON.stringify({ from, to: [to], subject, text }),
        });
        return response.ok
          ? { ok: true, status: response.status }
          : { ok: false, status: response.status, error: 'resend_rejected' };
      } catch {
        // The network failed: no evidence anything left, so report failure. The
        // caller does NOT acknowledge the day key, which keeps the alert retryable.
        return { ok: false, status: 0, error: 'resend_unreachable' };
      }
    },
  };
}

/**
 * The monthly count for one shop, as the delivery context reports it.
 *
 * H2 (council finding G21). The handler used to fall back to `async () => null`, so
 * the cap was NEVER enforced: every metered send was classified `unverified`,
 * allowed, and reported — which is how a Free shop pushed past its 50 with no
 * guard. `context.push_used_this_month` is the column the unit-7 SQL already
 * returns (`get_line_notification_delivery_context`), so the counter can be wired
 * with no new SQL and no new allowlist entry.
 *
 * FAIL-CLOSED DIRECTION IS UNCHANGED AND DELIBERATE. When the column is absent the
 * answer is still `null` — i.e. unverified, allowed, reported — because the cap is
 * a cost guard, not a right (controller decision 2026-10-01): a counter that cannot
 * be read must not silently mute a reminder a paying shop already bought. What H2
 * fixes is the case where the counter IS readable: the guard now engages there,
 * both when the SQL supplies the count and when a caller injects one.
 */
function contextPushUsage(context: DeliveryContext): number | null {
  const used = context.push_used_this_month;
  return typeof used === 'number' && Number.isFinite(used) && used >= 0 ? Math.floor(used) : null;
}

/**
 * The pack a delivery context is entitled as.
 *
 * When the SQL supplies `subscription_status` the mapping is decided by the same
 * branches `local_service.bk01_effective_plan` uses (see
 * `notification-entitlement.ts`). When it does not — today's context shape — the
 * plan code is read directly if it is already an effective code, and anything
 * unexpected (including the legacy `free_trial`) falls to `free`, the
 * entitlement-minimal plan.
 */
function effectivePlanFromContext(context: DeliveryContext, now: Date): EffectivePlan {
  if (context.subscription_status != null) {
    return resolveEffectivePlan({
      plan: context.subscription_plan,
      status: context.subscription_status,
      currentPeriodEnd: context.current_period_end,
      trialEndsAt: context.trial_ends_at,
      now,
    });
  }
  if (isEffectivePlan(context.subscription_plan)) return context.subscription_plan;
  if (context.subscription_plan === 'basic_490' || context.subscription_plan === 'pro_990') {
    return context.subscription_plan;
  }
  return 'free';
}

/**
 * The pack gate for one customer push.
 *
 * Three answers, all of them decisions the registry already made — the handler only
 * reads them:
 *
 *   - `every_pack` — the event reaches the customer whatever pack they are on and
 *     is never charged (controller ruling, room 2026-10-01: a shop cancelling or
 *     moving an appointment is something the customer must be told, on Free too).
 *     `null` entitlement with `unmetered` is exactly that case, and the round-1
 *     defect was reading `null` as "suppress".
 *   - `pack_right` — a boolean right on `entitlement_plans` decides it. The
 *     database's value wins when the delivery context carries it; the mirror table
 *     answers only when the SQL has not been extended yet.
 *   - `suppress` — the registry does not mark this event a customer push at all, so
 *     nothing may be sent. `reason` distinguishes the three flavours so the hold
 *     reason is honest rather than a single catch-all.
 */
type PushGate =
  | { kind: 'every_pack' }
  | { kind: 'pack_right'; allowed: boolean }
  | { kind: 'suppress'; reason: 'unknown_event' | 'not_customer_channel' };

function resolvePushGate(context: DeliveryContext, plan: EffectivePlan): PushGate {
  const spec = notificationEventSpec(context.event_type);
  if (spec === null) return { kind: 'suppress', reason: 'unknown_event' };
  if (spec.disposition !== 'send_customer_line') return { kind: 'suppress', reason: 'not_customer_channel' };

  const column = spec.entitlement;
  if (column === null) return { kind: 'every_pack' };

  // Only the two rights the delivery context actually carries can be read from it;
  // a right the context does not expose (the shop e-mail columns) is not a customer
  // push and never reaches this branch.
  if (column !== 'customer_reminder_push' && column !== 'customer_slip_decision_push') {
    return { kind: 'suppress', reason: 'not_customer_channel' };
  }
  const fromDatabase = context[column];
  if (typeof fromDatabase === 'boolean') return { kind: 'pack_right', allowed: fromDatabase };

  const mirror: PlanNotificationEntitlements | null = entitlementsForPlan(plan);
  if (!mirror) return { kind: 'suppress', reason: 'not_customer_channel' };
  return { kind: 'pack_right', allowed: mirror[column] };
}

export async function handleNotificationDispatch(
  req: Request,
  runtimeProvider: RuntimeProvider = defaultRuntimeProvider,
  send: typeof fetch = fetch,
  quotaTransport: QuotaTransport | null = null,
  // The REAL production defaults (PART A item 5): a Resend transport and an
  // alert-mode ledger sink are built from the same runtime the dispatch already
  // uses, so the sink is no longer ABSENT on the production path — which is what
  // made every operator alert fail closed before this unit.
  alertTransport: OpsAlertTransport | null = null,
  resolvePushUsage: PushUsageResolver | null = null,
  pushAlertSink: PushAlertSink | null = null,
) {
  const expectedSecret = process.env.NOTIFICATION_DISPATCH_SECRET;
  if (!expectedSecret || req.headers.get('authorization') !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const runtime = await runtimeProvider();
    const now = new Date();
    const sink = pushAlertSink ?? createPushAlertSink(runtime);
    const transport = alertTransport ?? createResendOpsAlertTransport(process.env, send);

    /*
     * Unit 7 item 3 — the shared-OA breaker. It is read ONCE per dispatch because
     * it is a property of the central OA, not of a single row. Every shop on the
     * central channel shares that budget, so a shop's plan decides whether the
     * breaker can mute it (Free only).
     */
    const quotaRead = await readCentralOaQuota({
      accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      transport: quotaTransport ?? createLineQuotaTransport(send),
    });
    const breaker = resolveBreakerDecision(quotaRead);
    let breakerAlerted = false;
    /*
     * F3: the breaker fails towards sending, which is correct — but a breaker that
     * cannot read the quota and says nothing lets the shared OA run dry unnoticed.
     * One report per Thai day (the ledger decides), and only for a read that
     * genuinely failed: an unconfigured token on an environment that never set one
     * is not an incident.
     */
    let quotaAlertSent = false;

    if (quotaReadNeedsAlert(quotaRead)) {
      /*
       * The kind is a fact about the ONE central OA, so its key is the
       * system-scoped `quota_unreadable:global:<day>` the F1/F2 migration
       * validates. `sendOpsAlert` CLAIMS the key first and only sends when the
       * claim authorises it; the key is then ACKNOWLEDGED, and only after the
       * provider accepted the mail — so a failed send stays retryable and the
       * old pre-send `delivered` flag is gone.
       */
      const alertKey = pushAlertDedupeKey({ kind: 'quota_unreadable', at: now });
      if (alertKey.ok) {
        /* N1: report the alert only when the provider actually ACCEPTED the mail.
         * `sendOpsAlert` answers `sent: false` for an unconfigured address, an absent
         * transport, a key already acknowledged today, or a transport failure — in
         * every one of those the alert did NOT leave, so the response must not claim
         * it did. In the failure cases the ledger key stays retryable; only the
         * reported flag changes.
         */
        const alert = await sendOpsAlert({
          env: process.env,
          subject: '[BK01] shared LINE OA quota could not be read — 80% breaker not active',
          text: [
            'The central OA quota read failed, so the shared-OA volume guard did NOT engage.',
            'Free shops are NOT paused. Pushes continue for every pack.',
            'Check LINE_CHANNEL_ACCESS_TOKEN and the LINE quota endpoint.',
          ].join('\n'),
          transport,
          sink,
          kind: 'quota_unreadable',
          dedupeKey: alertKey.key,
        });
        quotaAlertSent = alert.sent;
      }
    }

    /*
     * Unit 7 item 2 counter, and H2 of the P0 set.
     *
     * The monthly count is a fact about the shop that the delivery-context RPC
     * already returns (`push_used_this_month`), so the default resolver reads THAT
     * column rather than answering `null`. Round 1 shipped `resolvePushUsage ?? (async
     * () => null)` with no call site injecting anything, which is why the cap was
     * never enforced: every metered send was `unverified` and allowed (G21).
     *
     * A caller may still inject a resolver (a different counter, or a test), and
     * that resolver wins when it is not this default. Nothing here names a new RPC:
     * the count arrives with the context, so no allowlist entry is added.
     */
    const defaultUsageResolver: PushUsageResolver = async () => null;
    const usageResolver: PushUsageResolver = resolvePushUsage ?? defaultUsageResolver;

    /*
     * Unit 7 item 3/2 alerts, once per dispatched run — see the two call sites.
     * `capAlertSent` is a one-per-run guard and a *retry* guard, not a
     * once-per-day one: the day limit is the database ledger the controller owns
     * (the `pushAlertDedupeKey` comment in notification-oa-breaker.ts).
     */
    let capAlertSent = false;

    const { data: claims, error: claimError } = await runtime.rpc('claim_due_line_notifications', { p_limit: 25 });
    if (claimError) return Response.json({ error: 'Notification claim failed' }, { status: 500 });
    if (!Array.isArray(claims)) return Response.json({ error: 'Notification claim response is invalid' }, { status: 500 });
    const claimRows = claims as ClaimedNotification[];

    let sent = 0;
    let failed = 0;
    let held = 0;
    let unverifiedCaps = 0;
    const holdReasons: Record<string, number> = {};

    for (const claim of claimRows) {
      const { data: rows, error: contextError } = await runtime.rpc('get_line_notification_delivery_context', {
        p_id: claim.id,
        p_attempt_count: claim.attempt_count,
      });
      const context = (Array.isArray(rows) ? rows[0] : rows) as DeliveryContext | null;
      let delivered = false;
      let failureMessage = contextError || !context ? 'Notification delivery context unavailable' : 'Notification recipient unavailable';
      /** Set when the row was deliberately not sent; it is not a retryable failure. */
      let holdReason: string | null = null;

      if (!contextError && context?.line_user_id) {
        const plan = effectivePlanFromContext(context, now);
        const spec = notificationEventSpec(context.event_type);

        /*
         * H1 — exhaustive dispatch. `spec === null` is an event the registry does
         * not know: the row is HELD with a reason and NO message is built, because
         * the round-1 defect was precisely an unknown event falling through to the
         * confirmation text. A shop-addressed row is held for the same reason: the
         * LINE worker may never push it at a customer (G16). A known event that
         * travels on another path (the binding reply) is held with its own reason.
         */
        if (spec === null) {
          holdReason = 'unknown_event_type';
          failureMessage = `Not sent: unrecognised notification event ${String(context.event_type)}`;
        } else if (spec.disposition === 'quarantine') {
          holdReason = 'event_not_for_customer_line';
          failureMessage = `Not sent: event ${spec.eventType} is addressed to ${spec.recipient} on the ${spec.channel} channel`;
        } else if (spec.disposition === 'handled_elsewhere') {
          holdReason = 'event_not_sent_by_dispatcher';
          failureMessage = `Not sent: event ${spec.eventType} is delivered outside this push path`;
        } else {
          const gate = resolvePushGate(context, plan);

          if (gate.kind === 'suppress') {
            holdReason = gate.reason === 'unknown_event' ? 'unknown_event_type' : 'event_not_for_customer_line';
            failureMessage = gate.reason === 'unknown_event'
              ? `Not sent: unrecognised notification event ${String(context.event_type)}`
              : `Not sent: event ${context.event_type} is not a customer push on this channel`;
          } else if (gate.kind === 'pack_right' && !gate.allowed) {
            holdReason = 'push_not_in_pack';
            failureMessage = 'Not sent: this event is not included in the shop pack';
          } else if (countsAgainstPushCap(context.event_type)) {
            // Unit 7 item 2: metered pushes stop at the shop's monthly cap. A cap the
            // counter could not confirm ALLOWS the send and is reported as unverified
            // (a cost guard must not silently mute a paid-for reminder); a confirmed
            // over-cap send is suppressed. A customer never sees an error either way.
            const decision = resolvePushCapDecision({
              cap: context.monthly_push_cap,
              // H2: the SQL's own count is the default source. An explicitly
              // injected resolver still wins, so tests and an operator-supplied
              // counter keep working; with neither, the guard is unverified.
              used: usageResolver === defaultUsageResolver
                ? contextPushUsage(context)
                : await usageResolver(context.shop_id),
            });
            if (!decision.allowed) {
              holdReason = decision.reason;
              failureMessage = 'Not sent: monthly push cap reached for this shop';
            } else if (decision.unverified) {
              unverifiedCaps += 1;
              // Unit 3 (controller decision 2026-10-01): a cap that could not be
              // measured must be reported, not just counted. The dedupe key is
              // per shop and per Thai day so a broken counter on a busy shop does
              // not turn into an alert storm. There is no pre-send `delivered`
              // flag any more: `sendOpsAlert` CLAIMS the key, sends only when the
              // claim authorises it, and ACKNOWLEDGES only after the provider
              // accepted the mail — so a failed attempt leaves the day key
              // retryable. A cap alert that cannot name a valid lowercase shop
              // UUID is REFUSED by `pushAlertDedupeKey` (SQL rejects a dash), and
              // then no alert is attempted at all.
              const alertKey = pushAlertDedupeKey({ kind: 'cap_unverified', shopId: context.shop_id, at: now });
              if (!capAlertSent && alertKey.ok) {
                capAlertSent = true;
                await sendOpsAlert({
                  env: process.env,
                  subject: '[BK01] push cap could not be verified — metering guard not active',
                  text: [
                    `Shop: ${context.shop_id}`,
                    'The monthly push cap could not be verified for this dispatch: the count or the',
                    'cap from the entitlement context was unreadable, so the guard is NOT active.',
                    'Pushes were NOT suppressed (the cap is a cost guard, not a right).',
                  ].join('\n'),
                  transport,
                  sink,
                  kind: 'cap_unverified',
                  dedupeKey: alertKey.key,
                });
              }
            }
          }
        }

        if (holdReason === null && breaker.state === 'open' && breakerMutesPlan(plan)) {
          // Unit 7 item 3: the breaker mutes Free shops only; Basic/trial keep sending.
          holdReason = 'oa_quota_breaker_free_shop';
          failureMessage = 'Not sent: shared LINE OA monthly quota breaker is open for free shops';
          if (!breakerAlerted) {
            breakerAlerted = true;
            /*
             * One alert per open event: the ledger keeps it to once per Thai day
             * and the alert is a fact about the OA, not about this shop — so the
             * key is the system-scoped `breaker_open:global:<day>` the F1/F2
             * migration validates. The breaker was READ successfully, so the
             * message is a measurement; the day key is still only retired once the
             * provider has ACCEPTED the mail (the acknowledgement phase), never
             * beforehand.
             */
            const alertKey = pushAlertDedupeKey({ kind: 'breaker_open', at: now });
            if (alertKey.ok) {
              await sendOpsAlert({
                env: process.env,
                subject: '[BK01] LINE OA quota breaker open — free shop pushes paused',
                text: [
                  `Shared OA quota usage ratio: ${breaker.ratio === null ? 'unknown' : breaker.ratio.toFixed(3)}`,
                  'Free shops are paused; Basic/trial/Pro pushes continue.',
                  'Raise the LINE OA plan or wait for the monthly reset.',
                ].join('\n'),
                transport,
                sink,
                kind: 'breaker_open',
                dedupeKey: alertKey.key,
              });
            }
          }
        }

        if (holdReason === null) {
          /*
           * H1 — build the message from the event, never from a default. An event
           * with no builder is a HOLD: the round-1 defect was an unhandled event
           * falling through to the confirmation text, so "no text" must stop the
           * send rather than open a fallback. A slip-decision row whose outcome the
           * outbox row does not state lands here too (see
           * `notification-customer-text.ts`).
           */
          const message = buildCustomerEventText({
            eventType: context.event_type,
            shopName: context.shop_name,
            bookingDate: context.booking_date,
            startTime: context.start_time,
            bookingCode: context.booking_code ?? null,
            // Both are absent from the delivery context in the SQL contract as it
            // stands; reading them here is what makes an extended context work
            // without a second app change.
            depositStatus: context.deposit_status ?? null,
            decisionReason: context.decision_reason ?? null,
          });

          if (message === null) {
            holdReason = 'event_text_unavailable';
            failureMessage = `Not sent: no message is defined for event ${context.event_type}`;
          } else {
            try {
              /*
               * A-21 (2026-10-01): EVERY pack sends through the central OA. The
               * per-shop merchant channel is kept in the repository but is not on
               * this path any more — see `resolveCentralChannel` above.
               */
              const config = resolveCentralChannel();
              const response = await send('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.accessToken}`, [LINE_RETRY_KEY_HEADER]: claim.id },
                body: JSON.stringify({ to: context.line_user_id, messages: [{ type: 'text', text: message }] }),
              });

              /*
               * H3 (N01) — a 409 that names the request LINE already holds is an
               * ACCEPTANCE, not a failure. The retry key on this send is the outbox
               * row id, so a retry after a lost response re-sends the SAME request
               * and LINE answers 409 with `x-line-accepted-request-id`. Reading only
               * `response.ok` recorded that as failed, which put the ledger, the
               * push budget and the shop's audit trail out of step with LINE.
               *
               * `providerAccepted` says LINE holds the message. Whether THIS row
               * was RECORDED is decided below by whether `complete_line_notification`
               * returns true — the two facts stay separate, and the retry key is
               * what makes the separation safe: acceptance is deduplicated at the
               * provider, so a re-run cannot deliver twice.
               */
              const outcome = resolveLinePushOutcome({
                ok: response.ok,
                status: response.status,
                headers: response.headers,
              });
              delivered = outcome.providerAccepted;
              const outcomeMessage = linePushFailureMessage(outcome);
              if (outcomeMessage !== null) failureMessage = outcomeMessage;
            } catch {
              failureMessage = 'LINE dispatch is unavailable';
            }
          }
        }
      }

      // A held row is retired at once: retrying would only re-run the same decision.
      const next = holdReason !== null
        ? { status: 'failed' as const, nextRetrySeconds: null }
        : nextNotificationAttempt({
            attemptCount: claim.attempt_count,
            bookingStatus: context?.event_type === 'booking_cancelled' ? 'cancelled' : 'active',
            delivered,
          });
      const nextRetryAt = next.nextRetrySeconds == null ? null : new Date(Date.now() + next.nextRetrySeconds * 1000).toISOString();
      const { data: completed, error: completionError } = await runtime.rpc('complete_line_notification', {
        p_id: claim.id,
        p_attempt_count: claim.attempt_count,
        p_status: next.status,
        p_sent_at: delivered ? new Date().toISOString() : null,
        p_next_retry_at: nextRetryAt,
        p_error_message: delivered ? null : failureMessage,
      });
      if (completionError || completed !== true) return Response.json({ error: 'Notification delivery evidence could not be persisted' }, { status: 500 });
      if (delivered) sent += 1;
      else if (holdReason !== null) {
        held += 1;
        holdReasons[holdReason] = (holdReasons[holdReason] ?? 0) + 1;
      } else failed += 1;
    }

    return Response.json({
      claimed: claimRows.length,
      sent,
      failed,
      held,
      holdReasons,
      unverifiedCapChecks: unverifiedCaps,
      oaQuotaBreaker: breaker.state,
      oaQuotaAlerted: quotaAlertSent,
      oaQuotaReadStatus: quotaRead.status,
    });
  } catch {
    return Response.json({ error: 'Runtime authorization unavailable' }, { status: 503 });
  }
}
