import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';
import { createBookingBoundFlexCard } from '../../../../lib/line-flex-templates';
import { resolveLineChannelConfig, type ResolvedLineChannelConfig } from '../../../../lib/line-channel-config';

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

function verifySignature(body: string, signature: string | null, channelSecret: string): boolean {
  if (!channelSecret || !signature) return false;

  const expected = Buffer.from(
    crypto.createHmac('sha256', channelSecret).update(body).digest('base64'),
  );
  const received = Buffer.from(signature);

  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

type LineWebhookEvent = {
  type?: string;
  replyToken?: string;
  message?: {
    type?: string;
    text?: string;
  };
  source?: {
    userId?: string;
  };
};

type WebhookEventFailure = {
  eventIndex: number;
  reason: 'EVENT_PROCESSING_FAILED';
};

function getRelatedRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === 'object' ? first as Record<string, unknown> : null;
  }

  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown webhook processing error';
}

async function writeNotificationFailure(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  booking: { id: string; shop_id: string },
  message: string,
  notificationLogId?: string,
) {
  const failureRecord = {
    status: 'failed',
    error_message: message.slice(0, 500),
  };

  const { error } = notificationLogId
    ? await supabaseAdmin
      .from('line_notification_logs')
      .update(failureRecord)
      .eq('id', notificationLogId)
    : await supabaseAdmin.from('line_notification_logs').insert({
      shop_id: booking.shop_id,
      booking_id: booking.id,
      event_type: 'booking_created',
      recipient_type: 'customer',
      ...failureRecord,
    });

  if (error) {
    console.error('LINE webhook failed to write failure audit log', {
      bookingId: booking.id,
      error: error.message,
    });
  }
}

export async function handleLineWebhook(req: NextRequest, config: ResolvedLineChannelConfig, expectedShopId?: string) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-line-signature');

    if (!verifySignature(rawBody, signature, config.channelSecret)) {
      return NextResponse.json({ error: 'Invalid LINE signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody) as { events?: unknown };
    const events = Array.isArray(payload.events) ? payload.events as LineWebhookEvent[] : [];
    const failures: WebhookEventFailure[] = [];
    let processedEvents = 0;
    let skippedEvents = 0;

    for (const [eventIndex, event] of events.entries()) {
      if (event.type === 'message' && event.message?.type === 'text') {
        const userMessage = (event.message.text || '').trim();
        const replyToken = event.replyToken;
        const lineUserId = event.source?.userId;

        // Check for binding pattern: "ผูกคิว BK-7K2M9Q-A3F2" or "ผูกคิว BK-7K2M9Q A3F2"
        const match = userMessage.match(/ผูกคิว\s+([A-Z0-9-]+)[-\s]+([A-Z0-9]+)/i);

        if (match && lineUserId) {
          const bookingCode = match[1].toUpperCase();
          const linkToken = match[2].toUpperCase();
          let bookingForFailureLog: { id: string; shop_id: string } | null = null;
          let notificationLogId: string | undefined;
          let lineDeliverySucceeded = false;

          try {
            const supabaseAdmin = getSupabaseAdmin();

            const { data: booking, error } = await supabaseAdmin
              .from('bookings')
              .select(`
                id,
                shop_id,
                customer_id,
                booking_code,
                link_token,
                link_token_expires_at,
                booking_date,
                start_time,
                status,
                deposit_status,
                deposit_amount,
                total_price,
                shops ( name, line_oa_id ),
                services ( name ),
                staff ( name, nickname )
              `)
              .eq('booking_code', bookingCode)
              .single();

            if (error || !booking) {
              throw new Error(error?.message || 'Booking not found');
            }
            if (expectedShopId && booking.shop_id !== expectedShopId) {
              throw new Error('Booking does not belong to this merchant LINE channel');
            }
            const { data: subscription, error: subscriptionError } = await supabaseAdmin
              .from('subscriptions').select('plan').eq('shop_id', booking.shop_id).maybeSingle();
            if (subscriptionError) throw new Error(`Subscription lookup failed: ${subscriptionError.message}`);
            const paidPlan = subscription?.plan === 'basic_490' || subscription?.plan === 'pro_990';
            if ((!expectedShopId && paidPlan) || (expectedShopId && !paidPlan)) {
              throw new Error('Booking was presented to the wrong LINE channel mode');
            }

            bookingForFailureLog = { id: booking.id, shop_id: booking.shop_id };

            if (booking.link_token !== linkToken) {
              throw new Error('Invalid booking link token');
            }

            if (booking.link_token_expires_at && new Date(booking.link_token_expires_at) < new Date()) {
              throw new Error('Booking link token has expired');
            }

            const { error: lineUserError } = await supabaseAdmin.from('line_users').upsert({
              shop_id: booking.shop_id,
              customer_id: booking.customer_id,
              line_user_id: lineUserId,
            }, { onConflict: 'shop_id, line_user_id' });

            if (lineUserError) throw new Error(`LINE user upsert failed: ${lineUserError.message}`);

            if (booking.customer_id) {
              const { error: customerError } = await supabaseAdmin
                .from('customers')
                .update({ line_user_id: lineUserId })
                .eq('id', booking.customer_id)
                .eq('shop_id', booking.shop_id);

              if (customerError) throw new Error(`Customer update failed: ${customerError.message}`);
            }

            const shop = getRelatedRecord(booking.shops);
            const service = getRelatedRecord(booking.services);
            const staff = getRelatedRecord(booking.staff);

            const flexCard = createBookingBoundFlexCard({
              bookingCode: booking.booking_code,
              shopName: typeof shop?.name === 'string' ? shop.name : 'ร้านค้าบริการ',
              serviceName: typeof service?.name === 'string' ? service.name : 'บริการ',
              staffName: typeof staff?.nickname === 'string'
                ? staff.nickname
                : typeof staff?.name === 'string' ? staff.name : 'ไม่ระบุพนักงาน',
              bookingDate: booking.booking_date,
              startTime: booking.start_time,
              statusText: booking.status === 'confirmed' ? 'ยืนยันคิวเรียบร้อย' : 'รอตรวจสอบสลิป',
              depositAmount: booking.deposit_amount || 0,
              totalPrice: booking.total_price || 0,
            });

            if (!config.accessToken || !replyToken) {
              throw new Error('LINE reply credentials are not configured');
            }

            const { data: notificationLog, error: pendingLogError } = await supabaseAdmin
              .from('line_notification_logs')
              .insert({
                shop_id: booking.shop_id,
                booking_id: booking.id,
                event_type: 'booking_created',
                recipient_type: 'customer',
                status: 'pending',
              })
              .select('id')
              .single();

            if (pendingLogError || !notificationLog) {
              throw new Error(`Pending notification audit log failed: ${pendingLogError?.message || 'No row returned'}`);
            }

            notificationLogId = notificationLog.id;

            const lineResponse = await fetch('https://api.line.me/v2/bot/message/reply', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.accessToken}`,
              },
              body: JSON.stringify({
                replyToken,
                messages: [flexCard],
              }),
            });

            if (!lineResponse.ok) {
              throw new Error(`LINE reply failed with HTTP ${lineResponse.status}`);
            }

            lineDeliverySucceeded = true;

            const { error: notificationError } = await supabaseAdmin
              .from('line_notification_logs')
              .update({
                status: 'sent',
                error_message: null,
              })
              .eq('id', notificationLog.id);

            if (notificationError) {
              throw new Error(`Notification audit status update failed: ${notificationError.message}`);
            }

            processedEvents += 1;
          } catch (error) {
            const message = errorMessage(error);

            console.error('LINE webhook event processing failed', {
              eventIndex,
              bookingCode,
              error: message,
            });

            failures.push({ eventIndex, reason: 'EVENT_PROCESSING_FAILED' });

            if (bookingForFailureLog && !lineDeliverySucceeded) {
              await writeNotificationFailure(
                getSupabaseAdmin(),
                bookingForFailureLog,
                message,
                notificationLogId,
              );
            }
          }
        } else {
          skippedEvents += 1;
        }
      } else {
        skippedEvents += 1;
      }
    }

    return NextResponse.json({
      success: failures.length === 0,
      receivedEvents: events.length,
      processedEvents,
      failedEvents: failures.length,
      skippedEvents,
      failures,
    });
  } catch (error) {
    const message = errorMessage(error);
    console.error('LINE webhook request processing failed', { error: message });

    return NextResponse.json({
      success: false,
      error: 'Webhook processing failed',
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const config = resolveLineChannelConfig({
      mode: 'trial',
      centralSecret: LINE_CHANNEL_SECRET,
      centralAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
    });
    return handleLineWebhook(req, config);
  } catch (error) {
    console.error('Central LINE configuration unavailable', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'LINE channel is not configured' }, { status: 503 });
  }
}
