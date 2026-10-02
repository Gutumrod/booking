/**
 * The trusted booking ingress (BK01 P0 H4 — council finding G01, brief 28 §4, and
 * Owner decision A-24 item 1).
 *
 * WHY THIS EXISTS. `create_booking_hold` was EXECUTE-able by `anon`, so the public
 * booking page called it straight from the browser. A caller could therefore skip
 * the page entirely: no account, no CAPTCHA, no rate limit, no server in the path.
 * The measured results were a Free shop burnt out of its 50-bookings-a-month
 * allowance by one attacker (`SHOP_NOT_ACCEPTING_ONLINE_BOOKINGS` for the real
 * customers who followed) and a paying shop's whole day of slots held by 22 fake
 * requests.
 *
 * The fix has two halves and BOTH are required — the SQL side revokes the RPC from
 * `anon`/`authenticated` and grants it to `bk01_runtime` only (R1 S14); this side
 * builds the server route that is then the ONLY way in, and it is the place where a
 * challenge can be checked and an abuse budget applied. Revoking alone would just
 * break booking; adding a route alone would leave the bypass open.
 *
 * WHAT IS CHECKED HERE, AND IN WHAT ORDER. The order is the security property:
 *
 *   1. RATE — the cheapest check, and the one that must not be skippable. It runs
 *      before the challenge so a flood of junk cannot make us spend a Turnstile
 *      round trip per request. The counter keys on `ip + shop`, exactly what brief
 *      28 §4 H4 asks for: per IP alone would let one attacker spread across shops,
 *      and per shop alone would let one attacker spend the whole shop's budget.
 *   2. CHALLENGE — Cloudflare Turnstile, validated SERVER-side at
 *      `siteverify`. The token is single-use and short-lived, so the check has to
 *      happen where the token can be redeemed once — never in the browser. §5.5 of
 *      the council answers says the same thing: a client-side widget does not bind
 *      someone who calls the RPC directly.
 *   3. THEN the RPC, as `bk01_runtime`.
 *
 * WHO SUPPLIES THE IP. `CF-Connecting-IP`, which Cloudflare sets on the request at
 * the edge and a client cannot forge through Cloudflare. The council explicitly
 * rejects trusting a client-sent `p_ip` (§5.5: "source identity comes from a trusted
 * boundary, not `p_ip` the client sends itself"). A request with no such header is
 * NOT given a pass: it is rate-limited under a single shared bucket, which is the
 * fail-closed direction for an unrecognised caller.
 *
 * WHERE THE COUNTER LIVES. In memory, per Worker isolate. That is a real limitation
 * and it is reported, not hidden: isolates are recycled and Cloudflare runs many of
 * them, so the effective limit is softer than the number below. What it does buy is
 * a hard ceiling per isolate against a single-source flood, and it costs nothing and
 * cannot break booking. The durable counter is an edge/platform configuration item
 * (Cloudflare rate-limiting rules) that the Owner must confirm is deployed — brief
 * 28 §4 names it as a decision, and §3.14 of the council answers calls the missing
 * WAF/rate limit "the number-one revenue risk". This module is what makes the
 * request path correct so that turning the edge rules on is a configuration change,
 * not a code change.
 *
 * TURNSTILE KEYS. Per A-24 the REAL keys are created by the Owner later and must
 * never appear in code. The official Cloudflare TEST secret
 * (`1x0000000000000000000000000000000AA`, which "always passes validation") is used
 * only when the environment says this is not production and no real secret is
 * configured. In production a missing secret is a FAIL, never a pass — see
 * `resolveTurnstileSecret`.
 *
 * Pure decision + injected transports, so `tests/` drives the real route with a fake
 * Turnstile and a fake clock and no network.
 */

/** Cloudflare's server-side validation endpoint. */
export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * The official Cloudflare TEST secret that always passes. Development only, and only
 * when no real secret is configured — see `resolveTurnstileSecret`.
 */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

/** Requests allowed per `ip + shop` inside the window. */
export const BOOKING_RATE_LIMIT_MAX = 10;

/** The window, in milliseconds. */
export const BOOKING_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/** The header Cloudflare sets and a client cannot forge through Cloudflare. */
export const CLIENT_IP_HEADER = 'cf-connecting-ip';

export type TurnstileSecretSource = 'configured' | 'development_test_key';

export interface TurnstileSecret {
  secret: string | null;
  source: TurnstileSecretSource | 'missing';
}

/**
 * The secret to validate with.
 *
 * In production a missing `TURNSTILE_SECRET_KEY` yields `missing` and the caller
 * MUST refuse the request — an unconfigured challenge is not a reason to let every
 * booking through. Outside production the documented test secret is used so the
 * route is exercisable without an Owner credential. `NODE_ENV` is read from the
 * injected env, never guessed.
 */
export function resolveTurnstileSecret(env: Record<string, string | undefined>): TurnstileSecret {
  const configured = env.TURNSTILE_SECRET_KEY?.trim();
  if (configured) return { secret: configured, source: 'configured' };
  if (env.NODE_ENV === 'production') return { secret: null, source: 'missing' };
  return { secret: TURNSTILE_TEST_SECRET, source: 'development_test_key' };
}

export interface TurnstileTransport {
  verify(input: { secret: string; token: string; remoteIp: string | null }): Promise<{ ok: boolean; body: unknown }>;
}

/** The real transport: one form-encoded POST to `siteverify`, as Cloudflare documents. */
export function createTurnstileTransport(fetchImpl: typeof fetch = fetch): TurnstileTransport {
  return {
    async verify({ secret, token, remoteIp }) {
      const form = new URLSearchParams({ secret, response: token });
      if (remoteIp) form.set('remoteip', remoteIp);
      try {
        const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        return { ok: response.ok, body };
      } catch {
        return { ok: false, body: null };
      }
    },
  };
}

export type TurnstileOutcome =
  | { verified: true }
  | { verified: false; reason: 'challenge_not_configured' | 'challenge_token_missing' | 'challenge_rejected' | 'challenge_unavailable' };

/**
 * Validate one challenge response.
 *
 * Everything that is not a confirmed `success: true` from the provider is a refusal,
 * including an unreachable provider: the challenge is the whole point of the ingress,
 * so "we could not check it" must not become "let it through". (This is the opposite
 * direction from the LINE quota breaker, and deliberately so: that one guards a cost,
 * this one guards the door.)
 */
export async function verifyBookingChallenge(input: {
  env: Record<string, string | undefined>;
  token: string | null | undefined;
  remoteIp: string | null;
  transport: TurnstileTransport | null;
}): Promise<TurnstileOutcome> {
  const secret = resolveTurnstileSecret(input.env);
  if (secret.secret === null) return { verified: false, reason: 'challenge_not_configured' };

  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (token.length === 0) return { verified: false, reason: 'challenge_token_missing' };
  if (!input.transport) return { verified: false, reason: 'challenge_unavailable' };

  const result = await input.transport.verify({ secret: secret.secret, token, remoteIp: input.remoteIp });
  if (!result.ok || typeof result.body !== 'object' || result.body === null) {
    return { verified: false, reason: 'challenge_unavailable' };
  }
  return (result.body as { success?: unknown }).success === true
    ? { verified: true }
    : { verified: false, reason: 'challenge_rejected' };
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** The bucket key, reported so an operator can see what was counted. */
  key: string;
  retryAfterSeconds: number | null;
}

/** The per-isolate counters. Module scope so the bucket survives across requests. */
const buckets = new Map<string, { count: number; resetAt: number }>();

/** The bucket a request is counted in: one IP on one shop (brief 28 §4 H4). */
export function bookingRateLimitKey(input: { clientIp: string | null; shopId: string }): string {
  const ip = typeof input.clientIp === 'string' && input.clientIp.trim().length > 0 ? input.clientIp.trim() : 'unknown-client';
  return `booking:${ip}:${input.shopId}`;
}

/**
 * Count one request and decide whether it may proceed.
 *
 * A request with no identifiable IP is counted in ONE shared `unknown-client` bucket
 * per shop rather than given a free pass, so an unrecognised caller is limited
 * instead of unlimited.
 */
export function consumeBookingRateLimit(
  input: { clientIp: string | null; shopId: string; now?: Date },
): RateLimitDecision {
  const key = bookingRateLimitKey(input);
  const nowMs = (input.now ?? new Date()).getTime();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= nowMs) {
    buckets.set(key, { count: 1, resetAt: nowMs + BOOKING_RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: BOOKING_RATE_LIMIT_MAX - 1, key, retryAfterSeconds: null };
  }

  if (existing.count >= BOOKING_RATE_LIMIT_MAX) {
    return {
      allowed: false,
      remaining: 0,
      key,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: BOOKING_RATE_LIMIT_MAX - existing.count, key, retryAfterSeconds: null };
}

/** The client IP Cloudflare put on the request, or null when there is none. */
export function readClientIp(headers: { get(name: string): string | null }): string | null {
  const value = headers.get(CLIENT_IP_HEADER);
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

/** Test seam: forget every bucket so a case starts from zero. */
export function resetBookingRateLimit(): void {
  buckets.clear();
}

/**
 * The fields the server route accepts, validated the same way the RPC validates them.
 *
 * The route does not re-implement the RPC's business rules (quota, availability,
 * time windows) — those stay in SQL, which is the authority. What it does is refuse
 * a body that could not possibly be a booking, so a malformed request never reaches
 * the database at all.
 */
export interface BookingHoldRequest {
  shop_id: string;
  service_id: string;
  staff_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  booking_date: string;
  start_time: string;
  notes: string | null;
  turnstileToken: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const THAI_MOBILE = /^0[689]\d{8}$/;

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A `YYYY-MM-DD` that is a date the calendar actually has (not 2026-02-31). */
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** An `HH:MM[:SS]` inside one day, so `25:99` never reaches the RPC. */
function isRealClockTime(value: string): boolean {
  const [hours, minutes, seconds = '0'] = value.split(':');
  const h = Number(hours);
  const m = Number(minutes);
  const s = Number(seconds);
  return Number.isInteger(h) && Number.isInteger(m) && Number.isInteger(s)
    && h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59;
}

/**
 * Turn a parsed JSON body into the nine named RPC arguments, or report what is
 * wrong. Optional fields become `null` rather than being absent, so the call always
 * has the same shape the browser used to send.
 */
export function parseBookingHoldRequest(
  body: unknown,
): { ok: true; value: BookingHoldRequest } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'Invalid booking request' };
  const raw = body as Record<string, unknown>;

  const shopId = asString(raw.shop_id);
  const serviceId = asString(raw.service_id);
  const staffIdRaw = asString(raw.staff_id);
  const name = asString(raw.customer_name);
  const phone = asString(raw.customer_phone).replace(/[\s-]/g, '');
  const email = asString(raw.customer_email);
  const bookingDate = asString(raw.booking_date);
  const startTime = asString(raw.start_time);
  const notes = asString(raw.notes);
  const token = asString(raw.turnstileToken);

  if (!UUID.test(shopId) || !UUID.test(serviceId)) return { ok: false, error: 'Invalid booking request' };
  if (staffIdRaw.length > 0 && !UUID.test(staffIdRaw)) return { ok: false, error: 'Invalid booking request' };
  if (name.length === 0 || name.length > 120) return { ok: false, error: 'Invalid customer name' };
  if (!THAI_MOBILE.test(phone)) return { ok: false, error: 'Invalid customer phone' };
  if (email.length > 0 && (email.length > 254 || !email.includes('@'))) return { ok: false, error: 'Invalid customer email' };
  if (!DATE.test(bookingDate) || !isRealCalendarDate(bookingDate)) return { ok: false, error: 'Invalid booking date' };
  if (!TIME.test(startTime) || !isRealClockTime(startTime)) return { ok: false, error: 'Invalid start time' };
  if (notes.length > 500) return { ok: false, error: 'Invalid notes' };
  if (token.length === 0) return { ok: false, error: 'Challenge response is required' };

  return {
    ok: true,
    value: {
      shop_id: shopId,
      service_id: serviceId,
      staff_id: staffIdRaw.length > 0 ? staffIdRaw : null,
      customer_name: name,
      customer_phone: phone,
      customer_email: email.length > 0 ? email : null,
      booking_date: bookingDate,
      start_time: startTime.length === 5 ? `${startTime}:00` : startTime,
      notes: notes.length > 0 ? notes : null,
      turnstileToken: token,
    },
  };
}

/**
 * The nine named arguments `create_booking_hold` takes, in the shape the RPC has
 * always taken. Exported so the route and its tests cannot drift from the
 * signature the CONTRACT pins (`reports/CONTRACT-BK01-P0-SQL-2026-10-02.md`).
 */
export function bookingHoldRpcArgs(request: BookingHoldRequest): Record<string, unknown> {
  return {
    p_shop_id: request.shop_id,
    p_service_id: request.service_id,
    p_staff_id: request.staff_id,
    p_customer_name: request.customer_name,
    p_customer_phone: request.customer_phone,
    p_customer_email: request.customer_email,
    p_booking_date: request.booking_date,
    p_start_time: request.start_time,
    p_notes: request.notes,
  };
}
