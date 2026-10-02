import { handleBookingHold } from '../../../../lib/booking-hold';

/**
 * The App Router entry point for the trusted booking ingress.
 *
 * The handler lives in `lib/booking-hold.ts` because Next 16.3.6 asserts that a
 * route module exports nothing but the HTTP methods and the documented config
 * symbols (`export async function handleBookingHold` failed the build as TS2344).
 * The security property — rate limit first, challenge second, RPC last — is
 * documented on the handler; this module only delegates, with the same defaults.
 */

export async function POST(req: Request) {
  return handleBookingHold(req);
}
