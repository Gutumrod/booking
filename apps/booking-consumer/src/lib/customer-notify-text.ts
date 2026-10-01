/**
 * Customer-facing notification text (BK01 brief 23, parts B3 and B4).
 *
 * The four messages that already existed are reproduced here byte-for-byte; the
 * new rejection message is added beside them. The text is bilingual (TH + EN)
 * only for the new message, because the older four are Thai-only in the route by
 * design and this unit does not change copy the shop and customers already see.
 * `tests/customer-notify-text.test.ts` pins the four legacy strings so a future
 * edit cannot silently change what a customer receives.
 */

export type CustomerNotificationEvent =
  | 'booking_created'
  | 'booking_rescheduled'
  | 'booking_cancelled'
  | 'reminder_1h'
  | 'reminder_24h'
  /** New in this unit: the shop rejected the slip and the customer can re-upload. */
  | 'deposit_rejected';

export interface CustomerNotificationInput {
  eventType: string;
  shopName: string | null;
  bookingDate: string;
  startTime: string;
  /** The shop's reason is NOT included: it may name the customer or carry detail. */
  canResubmit?: boolean;
}

const FALLBACK_SHOP_NAME = 'ร้านค้า';

export function buildCustomerNotificationText(input: CustomerNotificationInput): string {
  const shopName = input.shopName ?? FALLBACK_SHOP_NAME;
  const date = input.bookingDate;
  const time = String(input.startTime).slice(0, 5);

  switch (input.eventType) {
    case 'reminder_24h':
      return `แจ้งเตือนคิวที่ ${shopName} วันที่ ${date} เวลา ${time}`;
    case 'booking_cancelled':
      return `ยกเลิกคิวที่ ${shopName} แล้ว`;
    case 'booking_rescheduled':
      return `เลื่อนคิวเป็นวันที่ ${date} เวลา ${time}`;
    case 'deposit_rejected':
      return input.canResubmit
        ? [
            `${shopName}: สลิปที่ส่งมาไม่ผ่านการตรวจสอบ กรุณาอัปโหลดสลิปใหม่จากลิงก์จัดการคิว`,
            'EN: Your deposit slip was not approved. Please upload a new slip from your booking link.',
          ].join('\n')
        : [
            `${shopName}: สลิปที่ส่งมาไม่ผ่านการตรวจสอบ และคิวนี้ถูกจองไปแล้ว กรุณาจองคิวใหม่`,
            'EN: Your deposit slip was not approved and the slot is taken. Please book again.',
          ].join('\n');
    case 'booking_created':
    default:
      return `ยืนยันคิวที่ ${shopName} วันที่ ${date} เวลา ${time}`;
  }
}
