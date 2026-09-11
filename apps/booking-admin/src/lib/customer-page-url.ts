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

/** The canonical selected shop (lib/shop-selection) as resolved by the dashboard layout. */
export interface SelectedShopIdentity {
  shopId: string | null;
  slug: string | null;
}

/**
 * Preview URL for the layout's selected shop (Codex NEW-F12). Fails closed
 * (null) when the identity or slug is missing, or when the page has already
 * loaded data for a different shop -- Preview must never point at a tenant
 * other than the one whose data is on screen.
 */
export function tenantPreviewUrl(identity: SelectedShopIdentity, activeShopId?: string | null): string | null {
  if (!identity.shopId) return null;
  if (activeShopId && activeShopId !== identity.shopId) return null;
  return customerPageUrl(identity.slug);
}
