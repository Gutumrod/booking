// Truthful customer-page state (KMO-09 / brief section 11, Codex R4 review F6).
//
// The booking page used to fall through to the step-1 stepper for every failure
// mode except an explicitly disabled shop, so a partly-configured shop (no
// services, no staff, no schedule, or a deposit-required shop with no payment
// setup) or a transient load failure showed a dead stepper with an HTTP 200.
// This resolver picks one honest state from data the page already fetched; the
// component renders a dedicated screen per non-OK state. HTTP status is
// unchanged -- a truthful 200 negative state is fine, a 200 dead stepper is not.
//
// Pure and framework-free for unit testing from `tests/`.

export type BookingPageState =
  | 'LOADING'
  | 'LOAD_ERROR'
  | 'SHOP_NOT_FOUND'
  | 'BOOKING_DISABLED'
  | 'NO_SERVICES'
  | 'NO_STAFF'
  | 'NO_SCHEDULE'
  | 'PAYMENT_NOT_CONFIGURED'
  | 'OK';

export interface BookingStateInput {
  isLoading: boolean;
  loadError: boolean;
  shop: { is_accepting_online_bookings?: boolean } | null;
  serviceCount: number;
  staffCount: number;
  scheduleCount: number;
  /**
   * True only when EVERY active service is blocked by the per-service payment
   * gate (`isServicePaymentBlocked` in payment-instruction.ts), i.e. the shop
   * offers no bookable path at all. A shop with any no-deposit, explicit-zero or
   * unset-deposit service is NOT page-blocked; the page applies the same gate
   * to the selected service before any hold is created (Codex R2-4 / F6).
   */
  everyServicePaymentBlocked: boolean;
}

export function resolveBookingPageState(input: BookingStateInput): BookingPageState {
  if (input.isLoading) return 'LOADING';
  if (input.loadError) return 'LOAD_ERROR';
  if (!input.shop) return 'SHOP_NOT_FOUND';
  if (input.shop.is_accepting_online_bookings === false) return 'BOOKING_DISABLED';
  if (input.serviceCount === 0) return 'NO_SERVICES';
  if (input.staffCount === 0) return 'NO_STAFF';
  if (input.scheduleCount === 0) return 'NO_SCHEDULE';
  if (input.everyServicePaymentBlocked) return 'PAYMENT_NOT_CONFIGURED';
  return 'OK';
}
