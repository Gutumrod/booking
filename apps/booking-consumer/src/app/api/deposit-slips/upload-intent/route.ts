import { NextRequest, NextResponse } from 'next/server';

import { buildDepositSlipObjectPath } from '@/lib/deposit-slip-contract';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    bookingId?: string;
    recoveryToken?: string;
    contentType?: string;
    size?: number;
  } | null;
  if (!body?.bookingId || !body.recoveryToken || !body.contentType || !ALLOWED_TYPES.has(body.contentType)
      || !Number.isFinite(body.size) || Number(body.size) <= 0 || Number(body.size) > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Invalid upload request' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: recoveryAuthorized, error: recoveryError } = await admin.rpc('authorize_booking_recovery_attempt', {
    p_booking_id: body.bookingId,
    p_recovery_token: body.recoveryToken,
  });
  if (recoveryError || recoveryAuthorized !== true) {
    return NextResponse.json({ error: 'Invalid or expired booking capability' }, { status: 403 });
  }
  const { data: booking } = await admin.from('bookings')
    .select('id,status,deposit_status,expires_at')
    .eq('id', body.bookingId).maybeSingle();
  const now = Date.now();
  const authorized = booking
    && booking.status === 'hold'
    && ['awaiting', 'rejected'].includes(booking.deposit_status)
    && new Date(booking.expires_at).getTime() > now;
  if (!authorized) return NextResponse.json({ error: 'Invalid or expired booking capability' }, { status: 403 });

  const objectPath = buildDepositSlipObjectPath(body.bookingId, body.contentType);
  const { data, error } = await admin.storage.from('deposit-slips').createSignedUploadUrl(objectPath);
  if (error || !data?.token) return NextResponse.json({ error: 'Could not authorize upload' }, { status: 500 });
  return NextResponse.json({ objectPath, token: data.token });
}
