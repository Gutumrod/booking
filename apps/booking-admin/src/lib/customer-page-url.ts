// Customer booking page URL for the merchant Preview action (R4-5 / Codex NEW-F9).
//
// Returns null unless a real shop slug is loaded, so callers render no Preview
// rather than a fake URL or `#`. Independent of readiness, payment or R7 state.
//
// Pure and framework-free for unit testing from `tests/`.

export const BOOKING_SITE_URL = (process.env.NEXT_PUBLIC_BOOKING_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

export function customerPageUrl(slug: string | null | undefined): string | null {
  const clean = typeof slug === 'string' ? slug.trim() : '';
  return clean ? `${BOOKING_SITE_URL}/book/${encodeURIComponent(clean)}` : null;
}
