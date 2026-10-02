import crypto from 'crypto';
import { createBookingLinkBoundFlexCard } from './line-flex-templates';
import type { ResolvedLineChannelConfig } from './line-channel-config';

/**
 * The LINE webhook handler: signature verification, then the booking-binding RPC,
 * then the courtesy reply and the delivery finalization.
 *
 * ORDER IS THE SECURITY PROPERTY. The signature is checked over the raw body BEFORE
 * any runtime client is acquired, and a malformed JSON body is acknowledged without
 * touching the database. The binding RPC runs as `bk01_runtime`; the trial channel
 * uses the no-shop-id RPC so the central OA never has to name a trusted shop scope,
 * while the merchant channel refuses to bind at all without one.
 *
 * THE REPLY FAILS SOFT. The binding is the fact the customer cares about; the reply
 * is informational, its token is short-lived and a replayed message hits an expired
 * token. A reply failure must therefore NOT fail the binding and must NOT leave the
 * webhook event leased — it is logged and the event is finalized as processed.
 *
 * The handler lives here, in a library module, rather than in the App Router route
 * module (`app/api/line/webhook/route.ts`). Next 16.3.6 asserts that a route module
 * exports nothing but the HTTP methods and the documented config symbols; a
 * non-method export fails the production build as TS2344. The central route and the
 * merchant route both import this handler from here.
 */

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
type RuntimeClient = Awaited<ReturnType<typeof import('./bk01-runtime').getBk01RuntimeClient>>;
type RuntimeProvider = () => Promise<RuntimeClient>;
const defaultRuntimeProvider: RuntimeProvider = async () => (await import('./bk01-runtime')).getBk01RuntimeClient();

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
    if (config.mode === 'merchant' && !expectedShopId) {
      return Response.json({ error: 'Merchant LINE booking binding requires a trusted shop scope' }, { status: 503 });
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
      const rpcName = config.mode === 'central' ? 'bk01_line_bind_booking_trial' : 'bk01_line_bind_booking';
      const rpcArgs = config.mode === 'central'
        ? {
            p_webhook_event_id: event.webhookEventId,
            p_booking_code: bookingCode,
            p_link_token: linkToken,
            p_line_user_id: lineUserId,
          }
        : {
            p_webhook_event_id: event.webhookEventId,
            p_booking_code: bookingCode,
            p_link_token: linkToken,
            p_expected_shop_id: expectedShopId,
            p_line_user_id: lineUserId,
          };
      const { data, error } = await runtime.rpc(rpcName, rpcArgs);
      if (error) throw new Error('LINE booking binding RPC failed');
      binding = (Array.isArray(data) ? data[0] : data) as LineBinding | null;
      if (!binding?.claimed) {
        skippedEvents += 1;
        continue;
      }
      if (!binding.booking_context || !binding.booking_id || !binding.lease_token) throw new Error('LINE booking binding returned incomplete context');
      if (!config.accessToken || !event.replyToken) throw new Error('LINE reply is not configured');

      // The reply is informational: its only job is to tell the customer the queue
      // is bound and when the reminder will arrive. A reply failure therefore must
      // NOT fail the binding — and it must not leave the webhook event leased.
      // LINE reply tokens are short-lived and the customer's own message can be
      // replayed, so a late duplicate hits an expired token; that is a normal
      // outcome, not an error to surface as EVENT_PROCESSING_FAILED.
      try {
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
      } catch (replyError) {
        // The binding itself is done and the DB lease is about to be released as
        // processed; only the courtesy reply was lost.
        console.error('LINE binding reply could not be delivered', { eventIndex, code: 'REPLY_NOT_DELIVERED', reason: messageOf(replyError) });
      }

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
