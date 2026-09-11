// Route-scoped loader for /book/[slug] (Codex NEW-F11 / R4-6).
//
// loadBookingRoute() returns one complete snapshot for a single slug: every
// field is replaced on every load, so a no-row shop is always `shop: null`
// (SHOP_NOT_FOUND) and any accessor error is `loadError: true` with no partial
// data (LOAD_ERROR, preserving the NEW-F8 adapters' error contract).
// createRequestGate() gives each load an identity so a late response from an
// older slug (or an unmounted page) can never overwrite the current route.
//
// Pure and framework-free for unit testing from `tests/`; accessors are passed
// in so no Supabase client is needed here.

import type { Service, Shop, ShopAvailability, ShopHoliday, Staff, StaffSchedule } from './booking-service';

export interface BookingRouteAccessors {
  getShopBySlug(slug: string): Promise<Shop | null>;
  getShopServices(shopId: string): Promise<Service[]>;
  getShopStaff(shopId: string): Promise<Staff[]>;
  getShopAvailability(shopId: string): Promise<ShopAvailability>;
}

export interface BookingRouteData {
  shop: Shop | null;
  services: Service[];
  staff: Staff[];
  schedules: StaffSchedule[];
  holidays: ShopHoliday[];
  loadError: boolean;
}

const EMPTY: Omit<BookingRouteData, 'shop' | 'loadError'> = { services: [], staff: [], schedules: [], holidays: [] };

export async function loadBookingRoute(slug: string, api: BookingRouteAccessors): Promise<BookingRouteData> {
  try {
    const shop = await api.getShopBySlug(slug);
    // Do not request booking resources for a missing shop or one the public
    // profile marks as unavailable. The server RPC remains the enforcement
    // boundary; this only keeps the customer flow truthful.
    if (!shop || shop.is_accepting_online_bookings === false) {
      return { ...EMPTY, shop, loadError: false };
    }
    const [services, staff, availability] = await Promise.all([
      api.getShopServices(shop.id),
      api.getShopStaff(shop.id),
      api.getShopAvailability(shop.id),
    ]);
    return {
      shop,
      services,
      staff,
      schedules: availability.schedules,
      holidays: availability.holidays,
      loadError: false,
    };
  } catch (error) {
    console.error('Error loading booking page data:', error);
    return { ...EMPTY, shop: null, loadError: true };
  }
}

/** Request identity: only the latest start() that has not been cancelled may apply. */
export function createRequestGate() {
  let current = 0;
  return {
    start(): () => boolean {
      const id = ++current;
      return () => id === current;
    },
    cancel(): void {
      current += 1;
    },
  };
}
