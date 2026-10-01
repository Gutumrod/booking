import { resolveLineChannelConfig } from '../../../../lib/line-channel-config';
import { nextNotificationAttempt } from '../../../../lib/notification-policy';
import { buildCustomerReminderText } from '../../../../lib/customer-reminder-text';
import {
  entitlementsForPlan,
  isEffectivePlan,
  pushEntitlementColumn,
  resolveEffectivePlan,
  type EffectivePlan,
  type PlanNotificationEntitlements,
} from '../../../../lib/notification-entitlement';
import {
  countsAgainstPushCap,
  bangkokMonthKey,
  resolvePushCapDecision,
} from '../../../../lib/notification-push-budget';
import {
  breakerMutesPlan,
  createLineQuotaTransport,
  readCentralOaQuota,
  resolveBreakerDecision,
  sendOpsAlert,
  type OpsAlertTransport,
  type QuotaTransport,
} from '../../../../lib/notification-oa-breaker';

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
};
type RuntimeClient = Awaited<ReturnType<typeof import('../../../../lib/bk01-runtime').getBk01RuntimeClient>>;
type RuntimeProvider = () => Promise<RuntimeClient>;
const defaultRuntimeProvider: RuntimeProvider = async () => (await import('../../../../lib/bk01-runtime')).getBk01RuntimeClient();
type MerchantChannelResolver = (shopId: string) => Promise<ReturnType<typeof resolveLineChannelConfig>>;
const defaultMerchantChannelResolver: MerchantChannelResolver = async (shopId) =>
  (await import('../../../../lib/merchant-line-config')).resolveMerchantLineChannel(shopId);

/** How many metered pushes this shop has already sent in the Thai month. */
type PushUsageResolver = (shopId: string) => Promise<number | null>;

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
 * The entitlement column that decides one customer push. The database's value
 * wins when it is present; the mirror table answers when the SQL has not been
 * extended yet. `null` means the event is not a customer push this file knows how
 * to gate, and the caller suppresses it rather than guessing.
 */
function resolvePushEntitlement(context: DeliveryContext, plan: EffectivePlan): boolean | null {
  const column = pushEntitlementColumn(context.event_type);
  if (column === null) return null;
  if (column !== 'customer_reminder_push' && column !== 'customer_slip_decision_push') return null;
  const fromDatabase = context[column];
  if (typeof fromDatabase === 'boolean') return fromDatabase;
  const mirror: PlanNotificationEntitlements | null = entitlementsForPlan(plan);
  if (!mirror) return null;
  return mirror[column];
}

export async function handleNotificationDispatch(
  req: Request,
  runtimeProvider: RuntimeProvider = defaultRuntimeProvider,
  send: typeof fetch = fetch,
  resolveMerchant: MerchantChannelResolver = defaultMerchantChannelResolver,
  quotaTransport: QuotaTransport | null = null,
  alertTransport: OpsAlertTransport | null = null,
  resolvePushUsage: PushUsageResolver | null = null,
) {
  const expectedSecret = process.env.NOTIFICATION_DISPATCH_SECRET;
  if (!expectedSecret || req.headers.get('authorization') !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const runtime = await runtimeProvider();
    const now = new Date();

    /*
     * Unit 7 item 3 — the shared-OA breaker. It is read ONCE per dispatch because
     * it is a property of the central OA, not of a single row. Every shop on the
     * central channel shares that budget, so a shop's plan decides whether the
     * breaker can mute it (Free only).
     */
    const breaker = resolveBreakerDecision(
      await readCentralOaQuota({
        accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
        transport: quotaTransport ?? createLineQuotaTransport(send),
      }),
    );
    let breakerAlerted = false;

    /*
     * Unit 7 item 2 counter. Counting requires a database read, and this route may
     * only reach the database through an allowlisted RPC — so the count arrives
     * through an injected resolver. With none supplied the answer is `null` and
     * `resolvePushCapDecision` fails closed with its own reason.
     *
     * The counting RPC is a SPEC item handed to the controller (brief 25
     * "สเปก SQL", unit 7 item 2): `local_service.bk01_shop_push_usage(uuid, date)`,
     * SECURITY DEFINER, `GRANT EXECUTE TO bk01_runtime`, counted from the existing
     * `line_notification_logs`. Until that migration lands AND the controller adds
     * the name to `BK01_RUNTIME_ROUTE_FUNCTIONS`, nothing here names it: a name
     * this route called before the grant existed would just fail at runtime, and
     * naming it here would make the allowlist guard pass over a grant that is not
     * there.
     */
    const usageResolver: PushUsageResolver = resolvePushUsage ?? (async () => null);

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
        const entitlement = resolvePushEntitlement(context, plan);

        if (entitlement === null) {
          holdReason = context.event_type === 'reminder_24h' || context.event_type === 'reminder_3h'
            ? 'push_not_in_pack'
            : 'push_event_not_metered_by_pack';
          failureMessage = `Not sent: pack entitlement unknown for event ${context.event_type}`;
        } else if (entitlement === false) {
          holdReason = 'push_not_in_pack';
          failureMessage = 'Not sent: this event is not included in the shop pack';
        } else if (countsAgainstPushCap(context.event_type)) {
          // Unit 7 item 2: metered pushes stop at the shop's monthly cap. A cap the
          // counter could not confirm ALLOWS the send and is reported as unverified
          // (a cost guard must not silently mute a paid-for reminder); a confirmed
          // over-cap send is suppressed. A customer never sees an error either way.
          const decision = resolvePushCapDecision({
            cap: typeof context.monthly_push_cap === 'number' ? context.monthly_push_cap
              : (entitlementsForPlan(plan)?.monthly_push_cap ?? null),
            used: await usageResolver(context.shop_id),
          });
          if (!decision.allowed) {
            holdReason = decision.reason;
            failureMessage = 'Not sent: monthly push cap reached for this shop';
          } else if (decision.unverified) {
            unverifiedCaps += 1;
          }
        }

        if (holdReason === null && breaker.state === 'open' && breakerMutesPlan(plan)) {
          // Unit 7 item 3: the breaker mutes Free shops only; Basic/trial keep sending.
          holdReason = 'oa_quota_breaker_free_shop';
          failureMessage = 'Not sent: shared LINE OA monthly quota breaker is open for free shops';
          if (!breakerAlerted) {
            breakerAlerted = true;
            await sendOpsAlert({
              env: process.env,
              subject: '[BK01] LINE OA quota breaker open — free shop pushes paused',
              text: [
                `Shared OA quota usage ratio: ${breaker.ratio === null ? 'unknown' : breaker.ratio.toFixed(3)}`,
                'Free shops are paused; Basic/trial/Pro pushes continue.',
                'Raise the LINE OA plan or wait for the monthly reset.',
              ].join('\n'),
              transport: alertTransport,
            });
          }
        }

        if (holdReason === null) {
          try {
            /*
             * The channel decision is unchanged from B9(a): a paid shop with its
             * own OA uses it, everything else uses the central OA.
             */
            const isMerchantPlan = context.subscription_plan === 'basic_490' || context.subscription_plan === 'pro_990';
            const config = isMerchantPlan
              ? await resolveMerchant(context.shop_id)
              : resolveLineChannelConfig({ mode: 'trial', centralSecret: process.env.LINE_CHANNEL_SECRET, centralAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
            const date = context.booking_date;
            const time = String(context.start_time).slice(0, 5);
            const message = context.event_type === 'reminder_3h' || context.event_type === 'reminder_24h'
              ? buildCustomerReminderText({
                  shopName: context.shop_name,
                  bookingDate: date,
                  startTime: time,
                  bookingCode: context.booking_code ?? null,
                })
              : context.event_type === 'booking_cancelled'
                ? `ยกเลิกคิวที่ ${context.shop_name ?? 'ร้านค้า'} แล้ว`
                : context.event_type === 'booking_rescheduled'
                  ? `เลื่อนคิวเป็นวันที่ ${date} เวลา ${time}`
                  : `ยืนยันคิวที่ ${context.shop_name ?? 'ร้านค้า'} วันที่ ${date} เวลา ${time}`;
            const response = await send('https://api.line.me/v2/bot/message/push', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.accessToken}`, 'X-Line-Retry-Key': claim.id },
              body: JSON.stringify({ to: context.line_user_id, messages: [{ type: 'text', text: message }] }),
            });
            delivered = response.ok;
            if (!response.ok) failureMessage = `LINE push failed with HTTP ${response.status}`;
          } catch {
            failureMessage = 'LINE dispatch is unavailable';
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
    });
  } catch {
    return Response.json({ error: 'Runtime authorization unavailable' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return handleNotificationDispatch(req);
}
