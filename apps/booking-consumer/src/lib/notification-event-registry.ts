/**
 * The exhaustive registry of notification events (BK01 P0 H1 — council findings
 * G19 / G20 / G16, brief 28 §4).
 *
 * WHY THIS FILE EXISTS. Round 1 of the review found the dispatcher deciding what
 * to say with a chain that ENDED IN A DEFAULT: anything it did not recognise fell
 * through to `ยืนยันคิวที่ … เรียบร้อยแล้ว` — a confirmation. A rejected deposit
 * slip therefore reached the customer as "your booking is confirmed" (G19), and a
 * shop's e-mail row was claimed by the LINE worker and answered from the same
 * default (G16). Both are the same defect: an unknown event silently became a
 * success message.
 *
 * The repair is a registry that is COMPLETE over the database's own
 * `line_notification_logs_event_type_check` list, so every event the outbox can
 * hold has an explicit row here. Three facts are recorded per event and each one
 * answers a question the dispatcher used to guess:
 *
 *   - `channel` / `recipient` — who the row is FOR. A row whose recipient is the
 *     shop must never be sent down the customer LINE path, and the LINE worker
 *     quarantines it instead of pushing it at a customer (G16).
 *   - `entitlement` — the pack right that pays for the send, or `null` when no
 *     pack right exists for it. `null` is NOT "unlimited": it means either the
 *     event travels on a path that is already free (the binding reply) or the
 *     event must not be pushed at all. The dispatcher never treats `null` as a
 *     licence to send.
 *   - `meter` — whether a send consumes the shop's monthly push budget. The
 *     controller's ruling of 2026-10-01 (room, F1 of the round-1 review) splits
 *     this exactly: cancellation and reschedule reach the customer on EVERY pack
 *     and do NOT count; a reminder and a slip decision count.
 *
 * UNKNOWN IS A HOLD, NOT A DEFAULT. `notificationEventSpec()` answers `null` for
 * anything not listed, and the dispatcher retires that row as `unknown_event_type`
 * with no message built. Adding an event to the database CHECK without adding it
 * here therefore produces a visible, recorded hold — never a wrong message. That
 * direction is the whole point of H1 and is pinned by
 * `tests/house-pack-notify-events.test.ts`, which reads the CHECK list out of the
 * SQL and requires this registry to cover it exactly.
 *
 * Pure and framework-free so `tests/` can pin it without a database.
 */

import type { PlanNotificationEntitlements } from './notification-entitlement';

/** Where a row travels. `line` is the customer OA push path this app owns. */
export type NotificationChannel = 'line' | 'email';

/** Who the row is addressed to, as `line_notification_logs.recipient_type` says. */
export type NotificationRecipient = 'customer' | 'shop_owner';

/** Whether a send consumes the shop's monthly push budget (A-21). */
export type NotificationMeter = 'metered' | 'unmetered';

/**
 * What the LINE dispatcher may do with the row:
 *
 *   - `send_customer_line` — build a customer message and push it. Every such
 *     event needs an explicit text branch in `notification-customer-text.ts`.
 *   - `handled_elsewhere` — a real event that does not travel on this push path
 *     (the binding confirmation is a LINE reply, which LINE bills as free). The
 *     dispatcher records a reason and sends nothing.
 *   - `quarantine` — a shop-addressed row that must never be pushed to a
 *     customer. Retiring it is a deliberate hold, not a failure: the e-mail
 *     worker is the consumer that owns it.
 */
export type NotificationDisposition = 'send_customer_line' | 'handled_elsewhere' | 'quarantine';

export interface NotificationEventSpec {
  /** The exact string the database CHECK permits. */
  eventType: string;
  recipient: NotificationRecipient;
  channel: NotificationChannel;
  /** The pack right that pays for this send, or `null` when none governs it. */
  entitlement: keyof PlanNotificationEntitlements | null;
  meter: NotificationMeter;
  disposition: NotificationDisposition;
  /** Why the row reads the way it does — the decision this row encodes. */
  note: string;
}

/**
 * Complete over `line_notification_logs_event_type_check` after the Group 6+7
 * migration (`20261001140000_bk01_pack_notify_group67.sql:102-108`), plus
 * `binding_confirmation`, which is not an outbox row at all: it is the LINE reply
 * the webhook sends at binding time and is listed here so "reply is never metered"
 * has one authoritative home.
 */
export const NOTIFICATION_EVENT_REGISTRY: readonly NotificationEventSpec[] = [
  {
    eventType: 'booking_created',
    recipient: 'customer',
    channel: 'line',
    entitlement: null,
    meter: 'unmetered',
    disposition: 'handled_elsewhere',
    note: 'Free confirms a queue with the LINE reply at binding time (A-21 item 3); there is no pack right to push a confirmation, and pushing one would also bill Free for a message the reply already delivered.',
  },
  {
    eventType: 'booking_cancelled',
    recipient: 'customer',
    channel: 'line',
    entitlement: null,
    meter: 'unmetered',
    disposition: 'send_customer_line',
    note: 'Controller ruling 2026-10-01 (room, F1): the customer must be told the shop cancelled, on EVERY pack, and the send does not count against the monthly cap.',
  },
  {
    eventType: 'booking_rescheduled',
    recipient: 'customer',
    channel: 'line',
    entitlement: null,
    meter: 'unmetered',
    disposition: 'send_customer_line',
    note: 'Controller ruling 2026-10-01 (room, F1): the customer must be told the appointment moved, on EVERY pack, and the send does not count against the monthly cap.',
  },
  {
    eventType: 'deposit_approved',
    recipient: 'customer',
    channel: 'line',
    entitlement: 'customer_slip_decision_push',
    meter: 'metered',
    disposition: 'send_customer_line',
    note: 'The legacy name for a slip approval. It is the same pack right as deposit_slip_decision (Basic/trial and Pro), and it counts (A-21 item 3).',
  },
  {
    eventType: 'reminder_1h',
    recipient: 'customer',
    channel: 'line',
    entitlement: 'customer_reminder_push',
    meter: 'metered',
    disposition: 'send_customer_line',
    note: 'A legacy reminder row still permitted by the CHECK. A pending row of this type is a genuine reminder the pack paid for, so it uses the reminder right rather than being retired silently.',
  },
  {
    eventType: 'reminder_24h',
    recipient: 'customer',
    channel: 'line',
    entitlement: 'customer_reminder_push',
    meter: 'metered',
    disposition: 'send_customer_line',
    note: 'Retired as a producer (the reminder moved to 3 hours, A-21) but still permitted by the CHECK for rows created before the move.',
  },
  {
    eventType: 'reminder_3h',
    recipient: 'customer',
    channel: 'line',
    entitlement: 'customer_reminder_push',
    meter: 'metered',
    disposition: 'send_customer_line',
    note: 'The live reminder (A-21 item 3): one message per booking, three hours before the appointment, on every pack, and it counts.',
  },
  {
    eventType: 'deposit_rejected',
    recipient: 'customer',
    channel: 'line',
    entitlement: 'customer_slip_decision_push',
    meter: 'metered',
    disposition: 'send_customer_line',
    note: 'The legacy name for a slip rejection. The customer must be told the slip did NOT pass and to contact the shop — never that the queue is confirmed (G19).',
  },
  {
    eventType: 'deposit_slip_decision',
    recipient: 'customer',
    channel: 'line',
    entitlement: 'customer_slip_decision_push',
    meter: 'metered',
    disposition: 'send_customer_line',
    note: 'The live slip-decision event, produced for both verified and rejected outcomes. The text must follow the outcome, not a default (G19).',
  },
  {
    eventType: 'shop_email_slip',
    recipient: 'shop_owner',
    channel: 'email',
    entitlement: 'shop_email_slip',
    meter: 'unmetered',
    disposition: 'quarantine',
    note: 'A shop-addressed e-mail row. The LINE worker must not claim or push it: the delivery context historically returned the CUSTOMER line id for it, which sent a shop notification to a customer (G16).',
  },
  {
    eventType: 'shop_email_booking',
    recipient: 'shop_owner',
    channel: 'email',
    entitlement: 'shop_email_booking',
    meter: 'unmetered',
    disposition: 'quarantine',
    note: 'Pro-only shop e-mail on a new booking. Same quarantine rule as shop_email_slip (G16).',
  },
  {
    eventType: 'shop_email_slip_summary',
    recipient: 'shop_owner',
    channel: 'email',
    entitlement: 'shop_email_slip',
    meter: 'unmetered',
    disposition: 'quarantine',
    note: 'The 09:00/17:00 digest row, created with booking_id NULL. Same quarantine rule as shop_email_slip (G16, G17).',
  },
  {
    eventType: 'binding_confirmation',
    recipient: 'customer',
    channel: 'line',
    entitlement: null,
    meter: 'unmetered',
    disposition: 'handled_elsewhere',
    note: 'The reply the webhook sends when a customer binds a queue (A-21 item 3). LINE bills replies as free, so it is never metered and never a push.',
  },
];

const SPEC_BY_EVENT = new Map<string, NotificationEventSpec>(
  NOTIFICATION_EVENT_REGISTRY.map((spec) => [spec.eventType, spec]),
);

/**
 * The spec for one event type, or `null` when the registry does not know it.
 * `null` is the dispatcher's signal to HOLD — an unrecognised event is never
 * answered with a default message.
 */
export function notificationEventSpec(eventType: unknown): NotificationEventSpec | null {
  return typeof eventType === 'string' ? SPEC_BY_EVENT.get(eventType) ?? null : null;
}

export function isKnownNotificationEvent(eventType: unknown): boolean {
  return notificationEventSpec(eventType) !== null;
}

/** Every event type the registry knows, sorted — the exact key set. */
export function knownNotificationEventTypes(): string[] {
  return [...SPEC_BY_EVENT.keys()].sort();
}

/**
 * Events whose send consumes the monthly push budget. Derived from the registry
 * so the metering list cannot drift from the event list — the round-1 review found
 * the two maintained separately.
 */
export function meteredNotificationEventTypes(): string[] {
  return NOTIFICATION_EVENT_REGISTRY
    .filter((spec) => spec.disposition === 'send_customer_line' && spec.meter === 'metered')
    .map((spec) => spec.eventType)
    .sort();
}

/** Customer events that reach the customer WITHOUT counting (controller ruling). */
export function unmeteredNotificationEventTypes(): string[] {
  return NOTIFICATION_EVENT_REGISTRY
    .filter((spec) => spec.disposition !== 'quarantine' && spec.meter === 'unmetered')
    .map((spec) => spec.eventType)
    .sort();
}
