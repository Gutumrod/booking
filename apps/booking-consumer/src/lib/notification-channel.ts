/**
 * Which channel carries a notification (BK01 brief 23, part B3).
 *
 * Before this change the dispatch route pushed every claimed row to LINE, using
 * `line_user_id` for a customer and `line_oa_id` for a shop owner. Owner decision
 * A-20 forbids reaching the shop over LINE: the shop is told by the admin badge
 * and by e-mail. So the channel is decided here, purely, from `recipient_type`,
 * and the dispatch route never builds a LINE request for a `shop_owner` row.
 */

export type NotificationRecipientType = 'customer' | 'shop_owner';
export type NotificationChannel = 'line' | 'email';

export function resolveNotificationChannel(recipientType: string | null | undefined): NotificationChannel | null {
  if (recipientType === 'customer') return 'line';
  if (recipientType === 'shop_owner') return 'email';
  return null;
}

/** Rows the e-mail path owns. Kept next to the resolver so the two cannot drift. */
export function isMerchantEmailEvent(recipientType: string | null | undefined): boolean {
  return resolveNotificationChannel(recipientType) === 'email';
}
