/**
 * The customer reminder text (BK01 brief 25, unit 6 — HOUSE-BK01-REMIND-3H).
 *
 * The Owner moved the single customer reminder from 24 hours before the
 * appointment to 3 hours (STATUS-HOUSE A-21, 2026-10-01). Two things change in
 * the text besides the timing:
 *
 *   - it must carry the QUEUE CODE, so the customer can match the message to a
 *     booking without opening the app;
 *   - it is bilingual (TH + EN) like every other customer-visible string (L-01).
 *
 * It stays short on purpose: shop name, date, time, queue code and nothing else.
 * No customer name, no amount, no service or staff name travel in it.
 *
 * The same text is used for every pack (A-21: the reminder reaches customers of
 * Free, Basic and trial shops alike); what differs per pack is only whether the
 * push is allowed at all, which `notification-entitlement.ts` and
 * `notification-push-budget.ts` decide.
 *
 * Pure and framework-free so `tests/` can pin it without a database or a clock.
 */

export const REMINDER_LEAD_HOURS = 3;

export const REMINDER_EVENT_TYPE = 'reminder_3h';

export interface CustomerReminderInput {
  shopName: string | null;
  /** `YYYY-MM-DD` as stored on the booking. */
  bookingDate: string;
  /** `HH:MM[:SS]` as stored on the booking. */
  startTime: string;
  /** The booking code the customer sees in LINE and in the admin. */
  bookingCode: string | null;
}

const FALLBACK_SHOP_NAME = 'ร้านค้า';
const FALLBACK_CODE = '-';

/**
 * The reminder body: one Thai line and one English line.
 *
 * An absent queue code prints `-` rather than being omitted: a reminder that
 * shows no code is a reminder the customer cannot act on, and a visible `-` says
 * the code was missing instead of pretending the line does not exist.
 */
export function buildCustomerReminderText(input: CustomerReminderInput): string {
  const shopName = sanitize(input.shopName) || FALLBACK_SHOP_NAME;
  const date = sanitize(input.bookingDate);
  const time = sanitize(input.startTime).slice(0, 5);
  const code = sanitize(input.bookingCode) || FALLBACK_CODE;

  return [
    `แจ้งเตือนคิวที่ ${shopName} วันที่ ${date} เวลา ${time} รหัสคิว ${code}`,
    `Reminder: ${shopName} on ${date} at ${time}, queue ${code}`,
  ].join('\n');
}

function sanitize(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
