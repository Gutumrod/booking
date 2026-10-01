/**
 * LINE quota reading + the shared-OA circuit breaker (BK01 brief 25, unit 7 item 3).
 *
 * Owner decision (A-21): when the ONE shared LINE OA is over 80% consumed for the
 * month, the breaker stops pushing for FREE shops first and keeps Basic/trial
 * running, and the Owner is told. The point is that a free shop flooding the OA
 * must not stop the reminders of a customer whose shop is paying.
 *
 * WHERE THE NUMBER COMES FROM — verified against LINE's official reference
 * (`https://developers.line.biz/en/reference/messaging-api/`), not guessed:
 *
 *   GET https://api.line.me/v2/bot/message/quota              -> { type, value }
 *   GET https://api.line.me/v2/bot/message/quota/consumption  -> { totalUsage }
 *
 * `GET /v2/bot/message/quota` answers the target limit for the month and
 * `.../quota/consumption` answers how many were sent this month. Both are read
 * with the channel token of the central OA. When `type` is `none` the plan does
 * not have a monthly limit, so consumption alone decides nothing and the breaker
 * stays off (there is no percentage of "unlimited" to exceed).
 *
 * FAIL CLOSED, and specifically fail TOWARDS SENDING: if the quota cannot be read
 * (no credentials, a 4xx/5xx, a shape we do not recognise), the breaker does NOT
 * engage — a quota we cannot measure must not silently mute every shop's
 * notifications. That direction is deliberate and is the opposite of the
 * entitlement/push-cap decisions, which fail towards suppressing a single send.
 * Muting every paying shop because one GET failed would be the worse failure.
 *
 * The transport is injected and defaults to `fetch`; with no central token the
 * reader answers `not_configured` without any outbound call at all.
 *
 * Pure decision + a thin transport, so `tests/` can exercise both without a
 * network.
 */

export const CENTRAL_OA_QUOTA_URL = 'https://api.line.me/v2/bot/message/quota';
export const CENTRAL_OA_CONSUMPTION_URL = 'https://api.line.me/v2/bot/message/quota/consumption';

/** Owner decision A-21: break at 80% of the shared OA's monthly allowance. */
export const OA_QUOTA_BREAKER_THRESHOLD = 0.8;

export type QuotaReadStatus = 'read' | 'unlimited' | 'not_configured' | 'unavailable';

export interface QuotaReadResult {
  status: QuotaReadStatus;
  /** The month's target limit, when LINE reports a finite one. */
  limit: number | null;
  /** Messages already sent this month, when the read succeeded. */
  used: number | null;
}

export interface QuotaTransport {
  getJson(url: string, accessToken: string): Promise<{ ok: boolean; status: number; body: unknown }>;
}

/** The real transport. `fetch` is injected so tests prove the call and its shape. */
export function createLineQuotaTransport(fetchImpl: typeof fetch = fetch): QuotaTransport {
  return {
    async getJson(url, accessToken) {
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        return { ok: response.ok, status: response.status, body };
      } catch {
        return { ok: false, status: 0, body: null };
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Read the shared OA's month usage. Never throws: every failure becomes a status
 * the caller can act on, and the caller's policy is what decides whether that
 * failure mutes anything (it does not).
 */
export async function readCentralOaQuota(input: {
  accessToken: string | null | undefined;
  transport: QuotaTransport;
}): Promise<QuotaReadResult> {
  const token = typeof input.accessToken === 'string' ? input.accessToken.trim() : '';
  if (token.length === 0) return { status: 'not_configured', limit: null, used: null };

  const quota = await input.transport.getJson(CENTRAL_OA_QUOTA_URL, token);
  if (!quota.ok || !isRecord(quota.body)) return { status: 'unavailable', limit: null, used: null };
  const type = quota.body.type;
  if (type === 'none') return { status: 'unlimited', limit: null, used: null };
  if (type !== 'limited') return { status: 'unavailable', limit: null, used: null };
  const limit = quota.body.value;
  if (!Number.isFinite(limit) || (limit as number) <= 0) return { status: 'unavailable', limit: null, used: null };

  const consumption = await input.transport.getJson(CENTRAL_OA_CONSUMPTION_URL, token);
  if (!consumption.ok || !isRecord(consumption.body)) return { status: 'unavailable', limit: null, used: null };
  const used = consumption.body.totalUsage;
  if (!Number.isFinite(used) || (used as number) < 0) return { status: 'unavailable', limit: null, used: null };

  return { status: 'read', limit: Math.floor(limit as number), used: Math.floor(used as number) };
}

export type BreakerState = 'closed' | 'open';

export interface BreakerDecision {
  state: BreakerState;
  /** Fraction of the month's allowance consumed, or null when it is not knowable. */
  ratio: number | null;
  /** True when the breaker opened on a reading that was actually made. */
  openedBy: 'quota_exceeded' | 'quota_unmeasurable' | null;
}

/**
 * Decide the breaker state from a quota read.
 *
 * `quota_exceeded` is the only state that mutes anything. Everything unmeasurable
 * — no credentials, an unreadable endpoint, an `unlimited` plan — leaves the
 * breaker closed and says which of those it was, so the operator can see the
 * breaker never engaged rather than inferring it did.
 */
export function resolveBreakerDecision(read: QuotaReadResult): BreakerDecision {
  if (read.status !== 'read' || read.limit == null || read.used == null || read.limit <= 0) {
    // Closed on purpose: see the fail-towards-sending note above.
    return { state: 'closed', ratio: null, openedBy: 'quota_unmeasurable' };
  }
  const ratio = read.used / read.limit;
  if (ratio > OA_QUOTA_BREAKER_THRESHOLD) {
    return { state: 'open', ratio, openedBy: 'quota_exceeded' };
  }
  return { state: 'closed', ratio, openedBy: null };
}

/**
 * Which shops the breaker mutes: Free only (A-21). Basic/trial shops keep sending,
 * and Pro, when it is sold, keeps sending as well. The answer is an EFFECTIVE
 * plan, so a running trial (resolved to `basic_490`) is not muted — that is the
 * whole point of naming Free rather than "everything that is not Basic".
 */
export function breakerMutesPlan(effectivePlan: unknown): boolean {
  return effectivePlan === 'free';
}

/**
 * The Owner alert an opened breaker owes. `OPS_ALERT_EMAIL` is the address A-21
 * names; with no address there is NO fallback channel — the alert is recorded as
 * a log line and the reason states it was not e-mailed. Silence plus a working
 * breaker is acceptable; a hidden side channel to the Owner is not.
 *
 * The same function carries the two OTHER alerts this unit owes (a cap that could
 * not be verified, and the breaker opening): the route decides WHAT to say and
 * when, this decides whether anything may leave at all.
 */
export interface OpsAlert {
  sent: boolean;
  reason: 'sent' | 'not_configured' | 'transport_unavailable' | 'already_alerted_today';
  to: string | null;
  /** The day key the alert was deduped on, or null when no sink/key was supplied. */
  dedupeKey: string | null;
}

export interface OpsAlertTransport {
  send(input: { to: string; subject: string; text: string }): Promise<{ ok: boolean; status: number; error?: string }>;
}

/**
 * The once-per-Thai-day ledger an alert must pass through. The route may only
 * reach data through allowlisted RPCs, so the ledger is injected like the other
 * transports — and a MISSING ledger is treated as fail-closed (below), never as
 * "no ledger, alert freely".
 */
export interface PushAlertSink {
  /**
   * Atomically claims the day for `dedupeKey`.
   *
   * `delivered: true` means a previous attempt of this key already went out and
   * the key must never fire again. `delivered: false` means the key may be
   * re-claimed by a later attempt while the day lasts: if the mail was never
   * delivered, silently swallowing it in the ledger would leave the operator
   * believing they were told about a guard that is not running.
   */
  claim(input: { dedupeKey: string; delivered: boolean }): Promise<{ claimed: boolean }>;
}

/**
 * `YYYY-MM-DD` in Asia/Bangkok — the day an alert is limited to.
 *
 * The limit is one alert per key per Thai day. It is keyed per shop for the cap
 * alert (a broken counter is a per-shop fact) and not per shop for the breaker
 * (which is a fact about the ONE central OA, not about any shop).
 *
 * The day boundary is computed from a fixed +07:00 offset rather than a time zone
 * database: Thailand has had no DST since 1941, so the offset is exact, and this
 * module stays dependency- and clock-free.
 */
export function bangkokDayKey(at: Date): string {
  const shifted = new Date(at.getTime() + 7 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** The ledger key for one alert kind on one Thai day. */
export function pushAlertDedupeKey(input: {
  kind: 'cap_unverified' | 'breaker_open';
  shopId?: string;
  at: Date;
}): string {
  const day = bangkokDayKey(input.at);
  return input.kind === 'breaker_open'
    ? `oa_breaker_open:${day}`
    : `push_cap_unverified:${input.shopId ?? '-'}:${day}`;
}

export async function sendOpsAlert(input: {
  env: Record<string, string | undefined>;
  subject: string;
  text: string;
  transport: OpsAlertTransport | null;
  /** The once-per-day ledger. Omitted ⇒ no alert is sent (fail-closed). */
  sink?: PushAlertSink | null;
  /** Required for any send that is deduped; omitted ⇒ no alert is sent. */
  dedupeKey?: string | null;
  /** Whether this alert is already-delivered before the ledger is consulted. */
  delivered?: boolean;
}): Promise<OpsAlert> {
  const to = input.env.OPS_ALERT_EMAIL?.trim() ?? '';
  if (to.length === 0) return { sent: false, reason: 'not_configured', to: null, dedupeKey: null };
  if (!input.transport) return { sent: false, reason: 'transport_unavailable', to, dedupeKey: null };

  const dedupeKey = input.dedupeKey ?? null;
  if (dedupeKey === null || !input.sink) {
    // No way to honour the once-per-day limit: the alert is withheld and the
    // caller can see why. Same direction as the missing address — never a second
    // path, never an unlimited burst.
    return { sent: false, reason: 'transport_unavailable', to, dedupeKey: null };
  }
  let claimed: boolean;
  try {
    claimed = (await input.sink.claim({ dedupeKey, delivered: input.delivered ?? true })).claimed;
  } catch {
    return { sent: false, reason: 'transport_unavailable', to, dedupeKey };
  }
  if (!claimed) return { sent: false, reason: 'already_alerted_today', to, dedupeKey };

  try {
    const result = await input.transport.send({ to, subject: input.subject, text: input.text });
    return result.ok
      ? { sent: true, reason: 'sent', to, dedupeKey }
      : { sent: false, reason: 'transport_unavailable', to, dedupeKey };
  } catch {
    return { sent: false, reason: 'transport_unavailable', to, dedupeKey };
  }
}
