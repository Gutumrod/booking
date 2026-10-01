import { supabase } from './supabase';
import { rowOrNull } from './load-result';
import type { ResubmitInput } from './deposit-resubmit';

/**
 * Customer-side read of one booking, by the recovery link the customer already
 * holds (BK01 brief 23, part B4).
 *
 * Before this, a customer had no way to look at a booking at all: the only
 * anon-callable booking functions were `create_booking_hold`, the cancel and the
 * reschedule, plus `submit_deposit_slip`. Nothing could be read, so a rejected
 * customer had nowhere to land and no way back in.
 *
 * The read goes through `local_service.get_booking_status`, which is a SPEC in
 * this work unit -- it is not written here (the rejection/re-upload functions
 * belong to the queue-lock unit, brief 23 section 0.2). While the function is
 * absent the Supabase client surfaces an error and this module throws, so the
 * screen shows its honest "not connected yet" state instead of a blank form.
 */

export interface CustomerBookingStatus {
  bookingId: string;
  bookingCode: string;
  shopName: string;
  bookingDate: string;
  startTime: string;
  status: string;
  depositStatus: string;
  expiresAt: string | null;
  slipSubmitCount: number;
  /** Only for display of the deposit the shop set; never re-used to reprice. */
  depositPrice: number;
}

interface RawBookingStatus {
  booking_id: string;
  booking_code: string;
  shop_name: string;
  booking_date: string;
  start_time: string;
  status: string;
  deposit_status: string;
  expires_at: string | null;
  slip_submit_count: number | null;
  deposit_price: number | string | null;
}

export async function getCustomerBookingStatus(
  bookingId: string,
  recoveryToken: string,
): Promise<CustomerBookingStatus> {
  const result = await supabase.rpc('get_booking_status', {
    p_booking_id: bookingId,
    p_recovery_token: recoveryToken,
  });
  const row = rowOrNull(result, 'booking status') as RawBookingStatus | null;
  if (!row?.booking_id) throw new Error('Booking status is unavailable');

  return {
    bookingId: row.booking_id,
    bookingCode: row.booking_code,
    shopName: row.shop_name,
    bookingDate: row.booking_date,
    startTime: String(row.start_time).slice(0, 5),
    status: row.status,
    depositStatus: row.deposit_status,
    expiresAt: row.expires_at,
    slipSubmitCount: Number(row.slip_submit_count ?? 0),
    depositPrice: Number(row.deposit_price ?? 0),
  };
}

/** The `ResubmitInput` shape the pure rule needs, from one read. */
export function toResubmitInput(
  status: CustomerBookingStatus,
  now: Date,
): ResubmitInput {
  return {
    status: status.status,
    depositStatus: status.depositStatus,
    expiresAt: status.expiresAt,
    slipSubmitCount: status.slipSubmitCount,
    now,
  };
}
