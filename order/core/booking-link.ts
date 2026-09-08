import type { OrderLifecycle } from './index.ts';

export type BookingLinkRequest = Readonly<{ shopId: string; orderId: string; bookingId: string; idempotencyKey: string; orderLifecycle: OrderLifecycle; appointmentRequired: boolean }>;
export type BookingLinkDecision = Readonly<{ allowed: boolean; reason: 'READY_REQUIRED' | 'APPOINTMENT_NOT_REQUIRED' | 'DELEGATE_TO_BOOKING' }>;

export function authorizeOrderBookingLink(input: BookingLinkRequest): BookingLinkDecision {
  if (input.orderLifecycle !== 'READY') return { allowed: false, reason: 'READY_REQUIRED' };
  if (!input.appointmentRequired) return { allowed: false, reason: 'APPOINTMENT_NOT_REQUIRED' };
  if (!input.shopId || !input.orderId || !input.bookingId || !input.idempotencyKey) throw new Error('shopId, orderId, bookingId and idempotencyKey are required');
  return { allowed: true, reason: 'DELEGATE_TO_BOOKING' };
}
