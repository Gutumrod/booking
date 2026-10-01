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
 */
export interface OpsAlert {
  sent: boolean;
  reason: 'sent' | 'not_configured' | 'transport_unavailable';
  to: string | null;
}

export interface OpsAlertTransport {
  send(input: { to: string; subject: string; text: string }): Promise<{ ok: boolean; status: number; error?: string }>;
}

export async function sendOpsAlert(input: {
  env: Record<string, string | undefined>;
  subject: string;
  text: string;
  transport: OpsAlertTransport | null;
}): Promise<OpsAlert> {
  const to = input.env.OPS_ALERT_EMAIL?.trim() ?? '';
  if (to.length === 0) return { sent: false, reason: 'not_configured', to: null };
  if (!input.transport) return { sent: false, reason: 'transport_unavailable', to };
  try {
    const result = await input.transport.send({ to, subject: input.subject, text: input.text });
    return result.ok
      ? { sent: true, reason: 'sent', to }
      : { sent: false, reason: 'transport_unavailable', to };
  } catch {
    return { sent: false, reason: 'transport_unavailable', to };
  }
}
