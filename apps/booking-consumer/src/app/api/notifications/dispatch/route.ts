import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseAdmin } from '../../../../lib/supabase-admin';
import { resolveLineChannelConfig } from '../../../../lib/line-channel-config';
import { resolveMerchantLineChannel } from '../../../../lib/merchant-line-config';
import { nextNotificationAttempt } from '../../../../lib/notification-policy';

type ClaimedNotification = {
  id: string;
  booking_id: string;
  event_type: 'booking_created' | 'booking_rescheduled' | 'booking_cancelled' | 'reminder_24h';
  attempt_count: number;
};

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.NOTIFICATION_DISPATCH_SECRET;
  if (!expectedSecret || req.headers.get('authorization') !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: claims, error: claimError } = await admin.rpc('claim_due_line_notifications', { p_limit: 25 });
  if (claimError) return NextResponse.json({ error: 'Notification claim failed' }, { status: 500 });

  let sent = 0;
  let failed = 0;
  for (const claim of (claims ?? []) as ClaimedNotification[]) {
    const { data: booking, error } = await admin
      .from('bookings')
      .select('id,shop_id,booking_code,booking_date,start_time,status,customers(line_user_id),shops(name)')
      .eq('id', claim.booking_id)
      .single();

    let delivered = false;
    let failureMessage = error?.message ?? 'Notification recipient unavailable';
    if (booking && !error) {
      const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
      const shop = Array.isArray(booking.shops) ? booking.shops[0] : booking.shops;
      const { data: subscription } = await admin.from('subscriptions').select('plan').eq('shop_id', booking.shop_id).maybeSingle();
      const recipient = customer?.line_user_id;
      try {
        if (!recipient) throw new Error('Customer has not linked LINE');
        const config = subscription?.plan === 'basic_490' || subscription?.plan === 'pro_990'
          ? resolveMerchantLineChannel(booking.shop_id)
          : resolveLineChannelConfig({
              mode: 'trial',
              centralSecret: process.env.LINE_CHANNEL_SECRET,
              centralAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
            });
        const message = claim.event_type === 'reminder_24h'
          ? `แจ้งเตือนคิว ${booking.booking_code} ที่ ${shop?.name ?? 'ร้านค้า'} วันที่ ${booking.booking_date} เวลา ${String(booking.start_time).slice(0, 5)}`
          : claim.event_type === 'booking_cancelled'
            ? `ยกเลิกคิว ${booking.booking_code} ที่ ${shop?.name ?? 'ร้านค้า'} แล้ว`
            : claim.event_type === 'booking_rescheduled'
              ? `เลื่อนคิว ${booking.booking_code} เป็นวันที่ ${booking.booking_date} เวลา ${String(booking.start_time).slice(0, 5)}`
              : `ยืนยันคิว ${booking.booking_code} ที่ ${shop?.name ?? 'ร้านค้า'} วันที่ ${booking.booking_date} เวลา ${String(booking.start_time).slice(0, 5)}`;
        const response = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.accessToken}`,
            'X-Line-Retry-Key': claim.id,
          },
          body: JSON.stringify({ to: recipient, messages: [{ type: 'text', text: message }] }),
        });
        delivered = response.ok;
        if (!response.ok) failureMessage = `LINE push failed with HTTP ${response.status}`;
      } catch (dispatchError) {
        failureMessage = dispatchError instanceof Error ? dispatchError.message : 'LINE dispatch failed';
      }

      const next = nextNotificationAttempt({ attemptCount: claim.attempt_count, bookingStatus: booking.status, delivered });
      const nextRetryAt = next.nextRetrySeconds == null ? null : new Date(Date.now() + next.nextRetrySeconds * 1000).toISOString();
      const { data: completed, error: completionError } = await admin.rpc('complete_line_notification', {
        p_id: claim.id,
        p_attempt_count: claim.attempt_count,
        p_status: next.status,
        p_sent_at: delivered ? new Date().toISOString() : null,
        p_next_retry_at: nextRetryAt,
        p_error_message: delivered ? null : failureMessage,
      });
      if (completionError || completed !== true) {
        return NextResponse.json({ error: 'Notification delivery evidence could not be persisted' }, { status: 500 });
      }
      if (delivered) sent += 1; else failed += 1;
    } else {
      const { data: completed, error: completionError } = await admin.rpc('complete_line_notification', {
        p_id: claim.id,
        p_attempt_count: claim.attempt_count,
        p_status: 'failed',
        p_sent_at: null,
        p_next_retry_at: null,
        p_error_message: failureMessage,
      });
      if (completionError || completed !== true) {
        return NextResponse.json({ error: 'Notification failure evidence could not be persisted' }, { status: 500 });
      }
      failed += 1;
    }
  }

  return NextResponse.json({ claimed: claims?.length ?? 0, sent, failed });
}
