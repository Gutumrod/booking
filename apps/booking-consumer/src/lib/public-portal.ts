// Public Business Portal — capability model + card selection.
//
// One merchant link (`/shop/[slug]`) exposes only the capabilities enabled for
// that shop. Booking derives from the one truthful public signal that exists
// today (`shop_public_profile.is_accepting_online_bookings`). Order and Claim
// have no live server-side capability source until the BK01 shared-runtime gate
// opens, so they fail closed (disabled) in production. Test fixtures may inject
// explicit enabled states; production capability source never carries them yet.
//
// Source of truth: docs/order/03_PUBLIC_PORTAL_CLAIM_AND_PARALLEL_EXECUTION_DECISION_2026-09-08.md

export type PublicShopCapabilities = {
  bookingEnabled: boolean;
  orderEnabled: boolean;
  claimEnabled: boolean;
};

/**
 * Raw capability inputs from public, non-sensitive sources.
 *
 * - `isAcceptingOnlineBookings` comes from `shop_public_profile` and is the only
 *   field that is real today.
 * - `orderEnabled` / `claimEnabled` are reserved for the post-gate live
 *   capability source. Production leaves them undefined; only tests/dev fixtures
 *   set them.
 */
export type PublicShopCapabilitySource = {
  isAcceptingOnlineBookings?: boolean | null;
  orderEnabled?: boolean | null;
  claimEnabled?: boolean | null;
};

export function resolveShopCapabilities(
  source: PublicShopCapabilitySource | null | undefined,
): PublicShopCapabilities {
  return {
    bookingEnabled: source?.isAcceptingOnlineBookings === true,
    // Fail closed: strict `=== true` so `undefined`/`null` from the production
    // source can never enable an intake path that has no live runtime behind it.
    orderEnabled: source?.orderEnabled === true,
    claimEnabled: source?.claimEnabled === true,
  };
}

export type PortalCapability = 'booking' | 'order' | 'claim';

export type PortalCard = {
  capability: PortalCapability;
  href: string;
};

/**
 * The usable intake cards for a shop. A capability that is not enabled is not
 * returned at all — the portal never renders a clickable capability that would
 * dead-link or return fake success.
 */
export function selectPortalCards(
  slug: string,
  caps: PublicShopCapabilities,
): PortalCard[] {
  const all: Array<PortalCard & { enabled: boolean }> = [
    { capability: 'booking', href: `/book/${slug}`, enabled: caps.bookingEnabled },
    { capability: 'order', href: `/order/${slug}`, enabled: caps.orderEnabled },
    { capability: 'claim', href: `/shop/${slug}/claim`, enabled: caps.claimEnabled },
  ];
  return all.filter((c) => c.enabled).map(({ capability, href }) => ({ capability, href }));
}

/** Capabilities that exist as a concept but are currently unavailable for intake. */
export function disabledCapabilities(caps: PublicShopCapabilities): PortalCapability[] {
  const out: PortalCapability[] = [];
  if (!caps.bookingEnabled) out.push('booking');
  if (!caps.orderEnabled) out.push('order');
  if (!caps.claimEnabled) out.push('claim');
  return out;
}

export function hasAnyCapability(caps: PublicShopCapabilities): boolean {
  return caps.bookingEnabled || caps.orderEnabled || caps.claimEnabled;
}
