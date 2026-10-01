import { resolveLineChannelConfig } from '../../../../lib/line-channel-config';
import { nextNotificationAttempt } from '../../../../lib/notification-policy';
import { resolveNotificationChannel } from '../../../../lib/notification-channel';
import { buildCustomerNotificationText } from '../../../../lib/customer-notify-text';
import { buildMerchantEmail } from '../../../../lib/notification-email';
import {
  createResendTransport,
  readMerchantEmailConfig,
  type MerchantEmailTransport,
} from '../../../../lib/notification-email-transport';

type ClaimedNotification = { id: string; shop_id: string; event_type: 'booking_created' | 'booking_rescheduled' | 'booking_cancelled' | 'reminder_24h' | 'deposit_approved'; attempt_count: number };
type DeliveryContext = {
  id: string; shop_id: string; event_type: string; recipient_type: string;
  attempt_count: number; line_user_id: string | null; line_oa_id: string | null; shop_name: string | null;
  subscription_plan: string | null; booking_date: string; start_time: string;
  booking_code: string | null; can_resubmit: boolean | null;
};
type RuntimeClient = Awaited<ReturnType<typeof import('../../../../lib/bk01-runtime').getBk01RuntimeClient>>;
type RuntimeProvider = () => Promise<RuntimeClient>;
const defaultRuntimeProvider: RuntimeProvider = async () => (await import('../../../../lib/bk01-runtime')).getBk01RuntimeClient();
type MerchantChannelResolver = (shopId: string) => Promise<ReturnType<typeof resolveLineChannelConfig>>;
const defaultMerchantChannelResolver: MerchantChannelResolver = async (shopId) =>
  (await import('../../../../lib/merchant-line-config')).resolveMerchantLineChannel(shopId);
/**
 * Where a merchant notification is addressed. The shop owner's address is the
 * e-mail on their Supabase Auth login, which the runtime role cannot read from
 * `auth.users`; `local_service.get_shop_notification_recipient(uuid)` is the SPEC
 * this unit hands the controller (see docs/design/BK01-NOTIFY-DESIGN-2026-10-01.md
 * section 5). While it is absent the call errors, the resolver throws, and the
 * outbox row is marked failed with "not configured" -- nothing is sent anywhere
 * else.
 */
type MerchantRecipientResolver = (shopId: string) => Promise<{ shopName: string; email: string } | null>;

export async function handleNotificationDispatch(
  req: Request,
  runtimeProvider: RuntimeProvider = defaultRuntimeProvider,
  send: typeof fetch = fetch,
  resolveMerchant: MerchantChannelResolver = defaultMerchantChannelResolver,
  merchantEmailTransport: MerchantEmailTransport | null = null,
  resolveMerchantRecipient: MerchantRecipientResolver | null = null,
) {
  const expectedSecret = process.env.NOTIFICATION_DISPATCH_SECRET;
  if (!expectedSecret || req.headers.get('authorization') !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const runtime = await runtimeProvider();

    // The e-mail transport is built from env at call time. With no key it still
    // exists and answers EMAIL_NOT_CONFIGURED -- there is no branch that quietly
    // reroutes a merchant message to another channel.
    const emailTransport = merchantEmailTransport
      ?? createResendTransport(readMerchantEmailConfig(process.env), send);
    const recipientResolver: MerchantRecipientResolver = resolveMerchantRecipient
      ?? (async (shopId: string) => {
        const { data, error } = await runtime.rpc('get_shop_notification_recipient', { p_shop_id: shopId });
        if (error) throw new Error('Merchant recipient lookup failed');
        const row = (Array.isArray(data) ? data[0] : data) as { shop_name?: string; recipient_email?: string } | null;
        if (!row?.recipient_email) return null;
        return { shopName: row.shop_name ?? '', email: row.recipient_email };
      });

    const { data: claims, error: claimError } = await runtime.rpc('claim_due_line_notifications', { p_limit: 25 });
    if (claimError) return Response.json({ error: 'Notification claim failed' }, { status: 500 });
    if (!Array.isArray(claims)) return Response.json({ error: 'Notification claim response is invalid' }, { status: 500 });
    const claimRows = claims as ClaimedNotification[];

    const adminOrigin = (process.env.NEXT_PUBLIC_ADMIN_SITE_URL || 'https://admin.bk01.wstera.com').replace(/\/$/, '');

    let sent = 0;
    let failed = 0;
    for (const claim of claimRows) {
      const { data: rows, error: contextError } = await runtime.rpc('get_line_notification_delivery_context', {
        p_id: claim.id,
        p_attempt_count: claim.attempt_count,
      });
      const context = (Array.isArray(rows) ? rows[0] : rows) as DeliveryContext | null;
      let delivered = false;
      let failureMessage = contextError || !context ? 'Notification delivery context unavailable' : 'Notification recipient unavailable';

      if (!contextError && context) {
        const channel = resolveNotificationChannel(context.recipient_type);

        if (channel === 'email') {
          // Merchant channel. Owner decision A-20: the shop is reached by e-mail
          // only, so this branch never touches LINE and never falls back to it.
          try {
            const recipient = await recipientResolver(context.shop_id);
            if (recipient) {
              const built = buildMerchantEmail({
                shopName: recipient.shopName || context.shop_name || '',
                queueCodes: [context.booking_code ?? ''],
                adminUrl: `${adminOrigin}/dashboard`,
                kind: 'immediate',
              });
              const result = await emailTransport.send({
                to: recipient.email,
                subject: built.subject,
                text: built.text,
                html: built.html,
              });
              delivered = result.ok;
              if (!result.ok) failureMessage = result.error ?? `Email failed with HTTP ${result.status}`;
            } else {
              failureMessage = 'Merchant notification recipient is not configured';
            }
          } catch {
            failureMessage = 'Merchant notification recipient lookup is unavailable';
          }
        } else if (channel === 'line' && context.line_user_id) {
          try {
            const isMerchantPlan = context.subscription_plan === 'basic_490' || context.subscription_plan === 'pro_990';
            const config = isMerchantPlan
              ? await resolveMerchant(context.shop_id)
              : resolveLineChannelConfig({ mode: 'trial', centralSecret: process.env.LINE_CHANNEL_SECRET, centralAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
            const message = buildCustomerNotificationText({
              eventType: context.event_type,
              shopName: context.shop_name,
              bookingDate: context.booking_date,
              startTime: context.start_time,
              canResubmit: context.can_resubmit ?? undefined,
            });
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

      const next = nextNotificationAttempt({
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
      else failed += 1;
    }

    return Response.json({ claimed: claimRows.length, sent, failed });
  } catch {
    return Response.json({ error: 'Runtime authorization unavailable' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return handleNotificationDispatch(req);
}
