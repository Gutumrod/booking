import crypto from 'crypto';
import { createBookingLinkBoundFlexCard } from '../../../../lib/line-flex-templates';
import { resolveLineChannelConfig, type ResolvedLineChannelConfig } from '../../../../lib/line-channel-config';

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

function verifySignature(body: string, signature: string | null, channelSecret: string): boolean {
  if (!channelSecret || !signature) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', channelSecret).update(body).digest('base64'));
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

type LineWebhookEvent = {
  type?: string;
  webhookEventId?: string;
  replyToken?: string;
  message?: { type?: string; text?: string };
  source?: { userId?: string };
};

type LineBinding = {
  claimed: boolean;
  booking_id: string | null;
  shop_id: string | null;
  customer_id: string | null;
  line_user_id: string | null;
  booking_context: { booking_code?: string; booking_date?: string; start_time?: string; shop_name?: string } | null;
  lease_token: string | null;
};
type RuntimeClient = Awaited<ReturnType<typeof import('../../../../lib/bk01-runtime').getBk01RuntimeClient>>;
type RuntimeProvider = () => Promise<RuntimeClient>;
const defaultRuntimeProvider: RuntimeProvider = async () => (await import('../../../../lib/bk01-runtime')).getBk01RuntimeClient();

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'LINE webhook processing failed';
}

export async function handleLineWebhook(
  req: Request,
  config: ResolvedLineChannelConfig,
  expectedShopId?: string,
  runtimeProvider: RuntimeProvider = defaultRuntimeProvider,
  send: typeof fetch = fetch,
) {
  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get('x-line-signature'), config.channelSecret)) {
    return Response.json({ error: 'Invalid LINE signature' }, { status: 401 });
  }

  let payload: { events?: unknown };
  try {
    payload = JSON.parse(rawBody) as { events?: unknown };
  } catch {
    return Response.json({ success: false, error: 'Webhook processing failed' });
  }
  const events = Array.isArray(payload.events) ? payload.events as LineWebhookEvent[] : [];
  const failures: Array<{ eventIndex: number; reason: 'EVENT_PROCESSING_FAILED' }> = [];
  let processedEvents = 0;
  let skippedEvents = 0;

  for (const [eventIndex, event] of events.entries()) {
    const userMessage = event.type === 'message' && event.message?.type === 'text' ? (event.message.text || '').trim() : '';
    const match = userMessage.match(/ผูกคิว\s+([A-Z0-9-]+)[-\s]+([A-Z0-9]+)/i);
    const lineUserId = event.source?.userId;
    if (!match || !lineUserId) {
      skippedEvents += 1;
      continue;
    }
    // The frozen WU-B RPC requires a trusted shop UUID. Trial routing has no such
    // identity and must remain closed until the caretaker ships a follow-up RPC.
    if (!expectedShopId) {
      return Response.json({ error: 'LINE trial booking binding is unavailable pending a trusted shop scope' }, { status: 503 });
    }
    if (!event.webhookEventId || event.webhookEventId.length > 200) {
      failures.push({ eventIndex, reason: 'EVENT_PROCESSING_FAILED' });
      continue;
    }

    const bookingCode = match[1].toUpperCase();
    const linkToken = match[2].toUpperCase();
    let runtime: RuntimeClient | null = null;
    let binding: LineBinding | null = null;
    let deliverySucceeded = false;
    try {
      runtime = await runtimeProvider();
      const { data, error } = await runtime.rpc('bk01_line_bind_booking', {
        p_webhook_event_id: event.webhookEventId,
        p_booking_code: bookingCode,
        p_link_token: linkToken,
        p_expected_shop_id: expectedShopId,
        p_line_user_id: lineUserId,
      });
      if (error) throw new Error('LINE booking binding RPC failed');
      binding = (Array.isArray(data) ? data[0] : data) as LineBinding | null;
      if (!binding?.claimed) {
        skippedEvents += 1;
        continue;
      }
      if (!binding.booking_context || !binding.booking_id || !binding.lease_token) throw new Error('LINE booking binding returned incomplete context');
      if (!config.accessToken || !event.replyToken) throw new Error('LINE reply is not configured');

      const card = createBookingLinkBoundFlexCard({
        bookingCode: binding.booking_context.booking_code ?? bookingCode,
        shopName: binding.booking_context.shop_name ?? 'ร้านค้าบริการ',
        bookingDate: binding.booking_context.booking_date ?? '',
        startTime: binding.booking_context.start_time ?? '',
      });
      const lineResponse = await send('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.accessToken}` },
        body: JSON.stringify({ replyToken: event.replyToken, messages: [card] }),
      });
      if (!lineResponse.ok) throw new Error(`LINE reply failed with HTTP ${lineResponse.status}`);
      deliverySucceeded = true;

      const { data: finished, error: finishError } = await runtime.rpc('bk01_finish_line_webhook_delivery', {
        p_webhook_event_id: event.webhookEventId,
        p_lease_token: binding.lease_token,
        p_status: 'processed',
        p_error_message: null,
      });
      if (finishError || finished !== true) throw new Error('LINE delivery could not be finalized');
      processedEvents += 1;
    } catch (error) {
      if (!runtime) return Response.json({ error: 'LINE runtime authorization is unavailable' }, { status: 503 });
      console.error('LINE webhook event processing failed', { eventIndex, code: 'EVENT_PROCESSING_FAILED' });
      failures.push({ eventIndex, reason: 'EVENT_PROCESSING_FAILED' });
      if (runtime && binding?.claimed && binding.lease_token && !deliverySucceeded) {
        try {
          await runtime.rpc('bk01_finish_line_webhook_delivery', {
            p_webhook_event_id: event.webhookEventId,
            p_lease_token: binding.lease_token,
            p_status: 'failed',
            p_error_message: messageOf(error),
          });
        } catch {
          // Failure finalization is best effort; the DB lease remains time-bounded.
        }
      }
    }
  }

  return Response.json({ success: failures.length === 0, receivedEvents: events.length, processedEvents, failedEvents: failures.length, skippedEvents, failures });
}

export async function POST(req: Request) {
  try {
    const config = resolveLineChannelConfig({ mode: 'trial', centralSecret: LINE_CHANNEL_SECRET, centralAccessToken: LINE_CHANNEL_ACCESS_TOKEN });
    return handleLineWebhook(req, config);
  } catch {
    return Response.json({ error: 'LINE channel is not configured' }, { status: 503 });
  }
}
