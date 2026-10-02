/**
 * Central LINE OA Link Utility
 * Format: https://line.me/R/oaMessage/@{central_oa_id}/?ผูกคิว%20{booking_code}-{link_token}
 */

/**
 * The ONE public binding target for the booking page and the URL builder.
 *
 * `NEXT_PUBLIC_CENTRAL_LINE_OA_ID` is public by design (it ships in the page HTML),
 * so it is a NEXT_PUBLIC_ variable. This constant is the single source the page now
 * imports, so `book/[slug]` and `generateLineBindingUrl` cannot drift apart — and the
 * public profile no longer carries a per-shop OA id at all.
 */
export const CENTRAL_LINE_OA_ID =
  process.env.NEXT_PUBLIC_CENTRAL_LINE_OA_ID || 'central_booking_oa'; // Central LINE OA Handle

export function generateLineBindingUrl(bookingCode: string, linkToken: string, centralOaId: string = CENTRAL_LINE_OA_ID): string {
  const cleanOaId = centralOaId.replace(/^@/, '');
  const encodedText = encodeURIComponent(`ผูกคิว ${bookingCode}-${linkToken}`);
  return `https://line.me/R/oaMessage/@${cleanOaId}/?${encodedText}`;
}
