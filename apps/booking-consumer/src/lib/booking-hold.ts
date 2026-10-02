import {
  bookingHoldRpcArgs,
  consumeBookingRateLimit,
  createTurnstileTransport,
  parseBookingHoldRequest,
  readClientIp,
  verifyBookingChallenge,
  type TurnstileTransport,
} from './booking-ingress';

/**
 * The ONLY way a public booking is created (BK01 P0 H4 — finding G01, A-24 item 1).
 *
 * The browser used to call `local_service.create_booking_hold` directly with the
 * anon key. The P0 SQL set revokes that RPC from `anon`/`authenticated` and grants it
 * to `bk01_runtime` alone, so this handler is now the door: it checks an abuse budget,
 * validates a Turnstile challenge SERVER-side, and only then calls the RPC through
 * the House runtime identity.
 *
 * THE ORDER IS THE SECURITY PROPERTY — rate limit first, challenge second. A flood of
 * junk must not be able to make this Worker spend a Turnstile round trip per request,
 * and a caller who is over budget must not be able to learn whether their token was
 * good. Both refusals happen before any database call.
 *
 * WHAT THIS HANDLER DOES NOT DO: it does not re-implement the RPC's rules. Quota,
 * staff availability, past-time rejection and the new concurrent-hold ceiling are
 * SQL decisions and stay there (the SQL side is R1 S10/S14). The handler's job is that
 * the request is a well-formed booking from a caller who passed a challenge and is
 * inside the budget — nothing more.
 *
 * ERROR SHAPE. A refusal names the reason so the page can render it, and never
 * distinguishes "your token was wrong" from "you are rate limited" in a way that
 * would help an attacker probe. The upstream RPC error is passed through with its
 * message, because the page already maps the RPC's own codes.
 *
 * The handler lives here, in a library module, rather than in the App Router route
 * module (`app/api/bookings/hold/route.ts`). Next 16.3.6 asserts that a route module
 * exports nothing but the HTTP methods and the documented config symbols; a
 * non-method export fails the production build as TS2344. The route re-exports only
 * `POST`, which delegates here with the same defaults.
 */

type RuntimeClient = Awaited<ReturnType<typeof import('./bk01-runtime').getBk01RuntimeClient>>;
type RuntimeProvider = () => Promise<RuntimeClient>;
const defaultRuntimeProvider: RuntimeProvider = async () => (await import('./bk01-runtime')).getBk01RuntimeClient();

export async function handleBookingHold(
  req: Request,
  runtimeProvider: RuntimeProvider = defaultRuntimeProvider,
  turnstileTransport: TurnstileTransport | null = null,
) {
  const body = await req.json().catch(() => null);
  const parsed = parseBookingHoldRequest(body);
  if (parsed.ok === false) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const request = parsed.value;

  /*
   * 1. Abuse budget. Keyed on ip + shop (brief 28 §4 H4). The IP comes from the
   *    Cloudflare header, not from the body — a client-supplied `p_ip` would be a
   *    number the attacker chooses (§5.5 of the council answers).
   */
  const clientIp = readClientIp(req.headers);
  const rate = consumeBookingRateLimit({ clientIp, shopId: request.shop_id });
  if (!rate.allowed) {
    return Response.json(
      { error: 'Too many booking attempts. Please try again shortly.', code: 'BOOKING_RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds ?? 60) } },
    );
  }

  /*
   * 2. The challenge, validated HERE. A token is single-use and short-lived, so it
   *    can only be redeemed once and only from the server that holds the secret.
   */
  const challenge = await verifyBookingChallenge({
    env: process.env,
    token: request.turnstileToken,
    remoteIp: clientIp,
    transport: turnstileTransport ?? createTurnstileTransport(fetch),
  });
  if (challenge.verified === false) {
    const status = challenge.reason === 'challenge_unavailable' || challenge.reason === 'challenge_not_configured' ? 503 : 403;
    return Response.json(
      { error: 'Booking verification failed. Please reload the page and try again.', code: 'BOOKING_CHALLENGE_FAILED' },
      { status },
    );
  }

  /*
   * 3. Only now the database, as `bk01_runtime`. The RPC takes the same nine named
   *    arguments the browser used to send, so nothing about the booking contract
   *    changes for the customer.
   */
  try {
    const runtime = await runtimeProvider();
    const { data, error } = await runtime.rpc('create_booking_hold', bookingHoldRpcArgs(request));
    if (error) {
      // The RPC's own refusals (blocked shop, quota, unavailable slot, past time)
      // are meaningful to the page, so they are passed through rather than flattened.
      const message = typeof error.message === 'string' && error.message.length > 0 ? error.message : 'Booking could not be created';
      return Response.json({ error: message }, { status: 409 });
    }
    return Response.json({ hold: data });
  } catch {
    return Response.json({ error: 'Booking service is unavailable' }, { status: 503 });
  }
}
