import type { FulfillmentType, OrderLifecycle } from './index.ts';

export type BookingLinkRequest = Readonly<{ shopId: string; orderId: string; bookingId: string; idempotencyKey: string; orderLifecycle: OrderLifecycle; fulfillmentType: FulfillmentType; appointmentRequired: boolean }>;
export type BookingLinkDecision = Readonly<{ allowed: boolean; reason: 'READY_REQUIRED' | 'APPOINTMENT_NOT_REQUIRED' | 'FULFILLMENT_NOT_APPOINTMENT' | 'DELEGATE_TO_BOOKING' }>;

export function authorizeOrderBookingLink(input: BookingLinkRequest): BookingLinkDecision {
  if (input.orderLifecycle !== 'READY') return { allowed: false, reason: 'READY_REQUIRED' };
  if (!input.appointmentRequired) return { allowed: false, reason: 'APPOINTMENT_NOT_REQUIRED' };
  if (input.fulfillmentType !== 'ON_SITE_SERVICE') return { allowed: false, reason: 'FULFILLMENT_NOT_APPOINTMENT' };
  if (!input.shopId || !input.orderId || !input.bookingId || !input.idempotencyKey) throw new Error('shopId, orderId, bookingId and idempotencyKey are required');
  return { allowed: true, reason: 'DELEGATE_TO_BOOKING' };
}
