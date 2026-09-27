import { resolveLineChannelConfig } from '../../../../lib/line-channel-config';
import { nextNotificationAttempt } from '../../../../lib/notification-policy';

type ClaimedNotification = { id: string; shop_id: string; event_type: 'booking_created' | 'booking_rescheduled' | 'booking_cancelled' | 'reminder_24h'; attempt_count: number };
type DeliveryContext = {
  id: string; shop_id: string; event_type: ClaimedNotification['event_type']; recipient_type: string;
  attempt_count: number; line_user_id: string | null; line_oa_id: string | null; shop_name: string | null;
  subscription_plan: string | null; booking_date: string; start_time: string;
};
type RuntimeClient = Awaited<ReturnType<typeof import('../../../../lib/bk01-runtime').getBk01RuntimeClient>>;
type RuntimeProvider = () => Promise<RuntimeClient>;
const defaultRuntimeProvider: RuntimeProvider = async () => (await import('../../../../lib/bk01-runtime')).getBk01RuntimeClient();
type MerchantChannelResolver = (shopId: string) => Promise<ReturnType<typeof resolveLineChannelConfig>>;
const defaultMerchantChannelResolver: MerchantChannelResolver = async (shopId) =>
  (await import('../../../../lib/merchant-line-config')).resolveMerchantLineChannel(shopId);

export async function handleNotificationDispatch(
  req: Request,
  runtimeProvider: RuntimeProvider = defaultRuntimeProvider,
  send: typeof fetch = fetch,
  resolveMerchant: MerchantChannelResolver = defaultMerchantChannelResolver,
) {
  const expectedSecret = process.env.NOTIFICATION_DISPATCH_SECRET;
  if (!expectedSecret || req.headers.get('authorization') !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const runtime = await runtimeProvider();
    const { data: claims, error: claimError } = await runtime.rpc('claim_due_line_notifications', { p_limit: 25 });
    if (claimError) return Response.json({ error: 'Notification claim failed' }, { status: 500 });
    if (!Array.isArray(claims)) return Response.json({ error: 'Notification claim response is invalid' }, { status: 500 });
    const claimRows = claims as ClaimedNotification[];

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

      if (!contextError && context?.line_user_id) {
        try {
          const isMerchantPlan = context.subscription_plan === 'basic_490' || context.subscription_plan === 'pro_990';
          const config = isMerchantPlan
            ? await resolveMerchant(context.shop_id)
            : resolveLineChannelConfig({ mode: 'trial', centralSecret: process.env.LINE_CHANNEL_SECRET, centralAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
          const date = context.booking_date;
          const time = String(context.start_time).slice(0, 5);
          const message = context.event_type === 'reminder_24h'
            ? `แจ้งเตือนคิวที่ ${context.shop_name ?? 'ร้านค้า'} วันที่ ${date} เวลา ${time}`
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
