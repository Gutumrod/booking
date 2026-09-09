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
  /** shop.require_deposit (public contract field). */
  requireDeposit: boolean;
  promptpayNumber: string | null | undefined;
  /** shop.promptpay_name -- not a derived value. */
  promptpayName: string | null | undefined;
  /**
   * True only when EVERY active service resolves to a positive deposit, i.e. the
   * shop offers no no-deposit booking path. Computed by the caller from the
   * server's own resolution rule (explicit service amount, else shop default).
   * A shop with any explicit-zero or no-deposit service is NOT payment-blocked
   * at the page level -- F1's post-hold guard handles those attempts.
   */
  everyServiceNeedsDeposit: boolean;
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export function resolveBookingPageState(input: BookingStateInput): BookingPageState {
  if (input.isLoading) return 'LOADING';
  if (input.loadError) return 'LOAD_ERROR';
  if (!input.shop) return 'SHOP_NOT_FOUND';
  if (input.shop.is_accepting_online_bookings === false) return 'BOOKING_DISABLED';
  if (input.serviceCount === 0) return 'NO_SERVICES';
  if (input.staffCount === 0) return 'NO_STAFF';
  if (input.scheduleCount === 0) return 'NO_SCHEDULE';
  if (
    input.requireDeposit
    && input.everyServiceNeedsDeposit
    && !(nonEmpty(input.promptpayNumber) && nonEmpty(input.promptpayName))
  ) {
    return 'PAYMENT_NOT_CONFIGURED';
  }
  return 'OK';
}
