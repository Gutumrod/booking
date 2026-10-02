/**
 * The customer-facing LINE message for one event (BK01 P0 H1 — council findings
 * G19 / G20, brief 28 §4).
 *
 * WHY THIS FILE EXISTS. The round-1 review found the dispatcher building the
 * message with a nested ternary whose final branch was a CONFIRMATION. A rejected
 * deposit slip therefore told the customer `ยืนยันคิวที่ … เรียบร้อยแล้ว` — the
 * opposite of the outcome — and every event nobody had thought about inherited
 * the same text (G19). The `else` default is gone; each event the dispatcher may
 * send now has an explicit builder here, and an event with no builder returns
 * `null` so the caller HOLDS instead of guessing.
 *
 * WHO DECIDES WHICH EVENTS ARE SENDABLE: `notification-event-registry.ts`. This
 * module only decides the WORDS. `tests/house-pack-notify-events.test.ts` proves
 * the two agree: every event the registry marks `send_customer_line` has a
 * builder, every event with a builder is marked `send_customer_line`, and no
 * unknown event can produce text.
 *
 * THE SLIP OUTCOME COMES FROM THE PAYLOAD, NOT FROM THE EVENT NAME. An approval
 * and a rejection share one event type (`deposit_slip_decision`) and are told
 * apart by the booking's `deposit_status`. When the outcome is missing or is one
 * this module does not recognise the answer is `null` — a hold — because telling
 * a customer "approved" or "rejected" without the fact would be worse than saying
 * nothing at all. The legacy `deposit_rejected` name is unambiguous and always
 * renders the rejection text. A rejection tells the customer the slip did NOT
 * pass AND to contact the shop, as §4 H1 requires.
 *
 * BILINGUAL ON PURPOSE. Every customer-visible string in this product is TH + EN
 * (L-01), and the reminder already is. A rejection the customer cannot read is a
 * rejection they will dispute, so both languages travel together.
 *
 * SHORT AND FACT-ONLY. The messages name the shop, the date, the time and — for
 * a rejection — the reason the shop recorded, and nothing else. No amount, no
 * customer name, no deposit figure: those are not in the delivery context this
 * path is allowed to read, and inventing them would leak figures the shop never
 * chose to send.
 *
 * Pure and framework-free so `tests/` can pin it without a database or a clock.
 */

import {
  notificationEventSpec,
  type NotificationEventSpec,
} from './notification-event-registry';
import { buildCustomerReminderText } from './customer-reminder-text';

/** What the delivery context supplies that a customer message may use. */
export interface CustomerMessageContext {
  /** The exact `line_notification_logs.event_type`. */
  eventType: string;
  shopName: string | null;
  /** `YYYY-MM-DD` as stored on the booking. */
  bookingDate: string | null;
  /** `HH:MM[:SS]` as stored on the booking. */
  startTime: string | null;
  /** The booking code the customer sees in LINE and in the admin. */
  bookingCode?: string | null;
  /**
   * The booking's deposit outcome, when the row carries one. `deposit_slip_decision`
   * is used for BOTH an approval and a rejection, so the text cannot be chosen from
   * the event name alone.
   */
  depositStatus?: string | null;
  /** The reason the shop recorded, when the row carries one. Never invented. */
  decisionReason?: string | null;
}

const FALLBACK_SHOP_NAME = 'ร้านค้า';
const FALLBACK_CODE = '-';

function line(parts: string[]): string[] {
  return parts.filter((part) => part.length > 0);
}

function sanitize(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function shop(context: CustomerMessageContext): string {
  return sanitize(context.shopName) || FALLBACK_SHOP_NAME;
}

function date(context: CustomerMessageContext): string {
  return sanitize(context.bookingDate) || '-';
}

function time(context: CustomerMessageContext): string {
  return sanitize(context.startTime).slice(0, 5) || '-';
}

function code(context: CustomerMessageContext): string {
  return sanitize(context.bookingCode) || FALLBACK_CODE;
}

/** The shop, the date, the time and the queue code, as one readable pair. */
function appointmentLines(context: CustomerMessageContext): string[] {
  return [
    `${shop(context)} วันที่ ${date(context)} เวลา ${time(context)} รหัสคิว ${code(context)}`,
    `${shop(context)} on ${date(context)} at ${time(context)}, queue ${code(context)}`,
  ];
}

/** The shop cancelled the appointment. Reaches the customer on EVERY pack. */
function buildCancelledText(context: CustomerMessageContext): string {
  return line([
    `ยกเลิกคิวที่ ${shop(context)} แล้ว หากต้องการจองใหม่ กรุณาติดต่อร้าน`,
    `Cancelled: your appointment with ${shop(context)} has been cancelled. Contact the shop to book again.`,
  ]).join('\n');
}

/** The shop moved the appointment to a new date and time. */
function buildRescheduledText(context: CustomerMessageContext): string {
  return line([
    `เลื่อนคิวเป็น ${shop(context)} วันที่ ${date(context)} เวลา ${time(context)} รหัสคิว ${code(context)}`,
    `Rescheduled: ${shop(context)} on ${date(context)} at ${time(context)}, queue ${code(context)}`,
  ]).join('\n');
}

/**
 * The slip passed. The shop verified the transfer, so the queue stands.
 */
function buildSlipApprovedText(context: CustomerMessageContext): string {
  return line([
    `สลิปมัดจำผ่านการตรวจสอบแล้ว ${shop(context)} วันที่ ${date(context)} เวลา ${time(context)} รหัสคิว ${code(context)}`,
    `Deposit slip approved: ${shop(context)} on ${date(context)} at ${time(context)}, queue ${code(context)}`,
  ]).join('\n');
}

/**
 * The slip did NOT pass. §4 H1 requires the message to say so AND to send the
 * customer to the shop; the round-1 defect was this outcome arriving as a
 * confirmation.
 */
function buildSlipRejectedText(context: CustomerMessageContext): string {
  const reason = sanitize(context.decisionReason);
  return line([
    `สลิปมัดจำไม่ผ่านการตรวจสอบ ${shop(context)} วันที่ ${date(context)} เวลา ${time(context)} รหัสคิว ${code(context)}`,
    reason.length > 0 ? `เหตุผลจากร้าน: ${reason}` : '',
    'กรุณาติดต่อร้านเพื่อแนบสลิปใหม่หรือยืนยันการโอน คิวยังไม่ได้รับการยืนยัน',
    `Deposit slip rejected at ${shop(context)} (${date(context)}, ${time(context)}), queue ${code(context)}. Please contact the shop to re-send the slip or confirm the transfer. The booking is NOT confirmed.`,
  ]).join('\n');
}

/**
 * The outcome of a slip decision, read from the row rather than guessed from the
 * event name. `null` when the row does not say, which makes the caller hold.
 */
function slipOutcome(context: CustomerMessageContext): 'approved' | 'rejected' | null {
  const status = sanitize(context.depositStatus).toLowerCase();
  if (status === 'verified' || status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  return null;
}

/**
 * The message for one customer event, or `null` when none may be built.
 *
 * `null` covers three different refusals and the caller must treat them the same
 * way — hold and record why: an event the registry does not know; an event the
 * registry knows but that does not travel on this push path; and a slip decision
 * whose outcome the row did not state.
 */
export function buildCustomerEventText(context: CustomerMessageContext): string | null {
  const spec: NotificationEventSpec | null = notificationEventSpec(context.eventType);
  if (spec === null || spec.disposition !== 'send_customer_line') return null;

  switch (spec.eventType) {
    case 'booking_cancelled':
      return buildCancelledText(context);
    case 'booking_rescheduled':
      return buildRescheduledText(context);
    // Approval and rejection share one event type; only the row says which.
    case 'deposit_rejected':
      return buildSlipRejectedText(context);
    // The legacy approval name states the outcome itself, so no extra column is
    // needed for a row carrying it.
    case 'deposit_approved':
      return buildSlipApprovedText(context);
    case 'deposit_slip_decision': {
      const outcome = slipOutcome(context);
      if (outcome === 'approved') return buildSlipApprovedText(context);
      if (outcome === 'rejected') return buildSlipRejectedText(context);
      // The live event type is produced for BOTH outcomes and the outbox row holds
      // neither the status nor a payload in the contract as it stands, so an
      // unstated outcome is a HOLD: the text must never fall back to a confirmation
      // (G19). The delivery-context schema is a SQL contract item reported to the
      // controller — the app does not guess around it.
      return null;
    }
    case 'reminder_3h':
    case 'reminder_24h':
    case 'reminder_1h':
      return buildReminderText(context);
    default:
      // A registry row this module has not been taught to word must hold, not
      // fall through to another event's message.
      return null;
  }
}

/**
 * The reminder body. It delegates to the builder the reminder unit already
 * pinned (`customer-reminder-text.ts`) instead of re-wording it here: that file
 * is the single source of the reminder text, and a second copy is exactly the
 * kind of drift that produced the round-1 defect.
 */
function buildReminderText(context: CustomerMessageContext): string | null {
  return buildCustomerReminderText({
    shopName: context.shopName,
    bookingDate: date(context),
    startTime: time(context),
    bookingCode: context.bookingCode ?? null,
  });
}
