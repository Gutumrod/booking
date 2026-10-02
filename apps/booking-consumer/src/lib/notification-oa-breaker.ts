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

import { type PushAlertKind } from './notification-alert-kind';

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
 * Whether the quota read FAILED for a reason the operator should hear about.
 *
 * Review finding F3: the breaker deliberately fails towards sending, which is
 * right, but a blind breaker that reports nothing is how the shared OA gets
 * exhausted with no warning. This is the "should an alert be raised" question,
 * kept next to the decision that produced it so the route does not have to
 * re-derive it from `openedBy`.
 *
 * `not_configured` is NOT an alert: no central token in this environment is a
 * deployment fact an operator already knows, and alerting on it would fire once
 * per shop per day on every environment that has not set the token yet.
 * `unlimited` is NOT an alert either: there is no percentage of "unlimited" to
 * exceed, so nothing is broken.
 */
export function quotaReadNeedsAlert(read: QuotaReadResult): boolean {
  return read.status === 'unavailable';
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
  /**
   * Send one operator alert.
   *
   * `idempotencyKey` is STABLE for one (kind, day key) pair and is carried to the
   * provider as a real idempotency header by the transport that understands one.
   * The ledger cannot prove exactly-once EXTERNAL delivery — SQL sees only its own
   * rows — so crash-then-retry inside the five-minute claim lease must not be able
   * to deliver the same alert twice, and that guarantee is this key's job.
   */
  send(input: {
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
  }): Promise<{ ok: boolean; status: number; error?: string }>;
}

/**
 * The once-per-Thai-day ledger an alert must pass through, speaking the ALERT-MODE
 * contract of `local_service.claim_due_shop_email_notifications` (the existing claim
 * RPC — no new function name, allowlist unchanged).
 *
 * TWO PHASES, and the direction of the flag is the whole point:
 *
 *   claim({ delivered: false })  BEFORE sending. `claimed: true` is the ONLY thing
 *                                that authorises a send. An undelivered claim holds
 *                                a five-minute lease, so a later run may retry it.
 *   claim({ delivered: true })   AFTER the provider ACCEPTED the message: this is an
 *                                ACKNOWLEDGEMENT. It returns `claimed: false` and
 *                                `delivered: true` and never authorises another send,
 *                                and a delivered key cannot be reclaimed that day.
 *                                Acknowledging with no prior claim raises in SQL.
 *
 * `kind` travels SEPARATELY from `key` on purpose: the kind is not derivable from
 * the key — `breaker_open` and `quota_unreadable` share the `<kind>:<date>` shape —
 * and the day key is validated in SQL against the current Bangkok date.
 */
export interface PushAlertSink {
  claim(input: {
    kind: PushAlertKind;
    key: string;
    delivered: boolean;
  }): Promise<{ claimed: boolean; delivered: boolean }>;
}

/** The claim RPC that carries the alert ledger inside it (no new function name). */
export const ALERT_CLAIM_RPC = 'claim_due_shop_email_notifications';

/** The runtime surface the ledger needs: the allowlisted RPC call, and nothing else. */
export interface AlertLedgerRuntime {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * The REAL sink: the alert-mode call on the existing claim RPC.
 *
 * Alert mode supplies all three alert arguments and the returned row carries NULL
 * notification_id/shop_id/email/attempt_count/pending_slip_count with
 * `event_type='ops_alert'` — so this read touches no shop and no customer data at
 * all, which is why it needs no shop context to make the call.
 *
 * FAIL-CLOSED: an RPC error throws, and `sendOpsAlert` turns that into "no alert".
 * An alert whose ledger cannot be consulted is never sent on a guess.
 */
export function createPushAlertSink(runtime: AlertLedgerRuntime): PushAlertSink {
  return {
    async claim({ kind, key, delivered }) {
      const { data, error } = await runtime.rpc(ALERT_CLAIM_RPC, {
        p_limit: 1,
        p_alert_kind: kind,
        p_alert_key: key,
        p_delivered: delivered,
      });
      if (error) throw new Error('Alert ledger is unavailable');
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
      return {
        claimed: row?.alert_claimed === true,
        delivered: row?.alert_delivered === true,
      };
    },
  };
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

/**
 * The provider idempotency key for one (kind, day key) pair.
 *
 * STABLE BY CONSTRUCTION: derived from the kind and the ledger key ONLY — never
 * from a timestamp, a counter or a random value — so a crash-then-retry inside
 * the five-minute claim lease re-issues the SAME request and the provider
 * collapses the two into one message. SQL cannot prove exactly-once EXTERNAL
 * delivery (it sees only its own rows), so this key is the app's half of that
 * promise; `createResendOpsAlertTransport` puts it on the wire as the real
 * `Idempotency-Key` header.
 */
export function providerAlertIdempotencyKey(kind: PushAlertKind, alertKey: string): string {
  return `${kind}:${alertKey}`;
}

/**
 * The ledger key for one alert kind on one Thai day — the CURRENT key contract.
 *
 * AUTHORITY: `reports/CONTRACT-BK01-P0-SQL-2026-10-02.md`, section "Opencode R1
 * review follow-up — F1/F2", carried by
 * `supabase/bk01-migrations/20261002140000_bk01_review_f1_f2.sql`. That migration
 * redefines `claim_due_shop_email_notifications` and VALIDATES the key it is
 * handed; the strings below are the ones it accepts:
 *
 *   - shop-scoped   cap_unverified   : `push_cap_unverified:<lowercase local_service.shops.id UUID>:<YYYY-MM-DD>`
 *   - system-scoped quota_unreadable : `quota_unreadable:global:<YYYY-MM-DD>`
 *   - system-scoped breaker_open     : `breaker_open:global:<YYYY-MM-DD>`
 *
 * `<YYYY-MM-DD>` is the CURRENT Bangkok day (see `bangkokDayKey`). SQL rejects an
 * empty, missing, dash, malformed or non-UUID shop segment, a shop UUID that is
 * not a row in `local_service.shops`, a missing or wrong `global` segment, a
 * mismatched kind, and a non-current day.
 *
 * A REFUSAL, NOT A FALLBACK. A cap alert that cannot name its shop has no valid
 * key at all: `push_cap_unverified:-:<day>` is a string SQL refuses, and sending
 * it would record a FAILED alert where the honest answer is NO alert. So the
 * function returns `{ ok: false }` (visible to the caller, which then records no
 * alert rather than a failure) instead of inventing a dash.
 *
 * The `:global:` segment is emitted for BOTH system kinds because they are facts
 * about the ONE central OA, not about any shop — the earlier `${kind}:${day}`
 * shape is a key this migration rejects, so the two system kinds must match the
 * exact `kind:global:day` string.
 */
export type PushAlertDedupeKey =
  | { ok: true; key: string }
  | { ok: false; reason: 'shop_id_required' | 'shop_id_invalid' };

/** The exact shop-UUID shape the F1/F2 migration accepts, case-insensitively. */
const SHOP_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pushAlertDedupeKey(input: {
  kind: PushAlertKind;
  shopId?: string;
  at: Date;
}): PushAlertDedupeKey {
  const day = bangkokDayKey(input.at);
  if (input.kind === 'breaker_open' || input.kind === 'quota_unreadable') {
    return { ok: true, key: `${input.kind}:global:${day}` };
  }
  const shopId = typeof input.shopId === 'string' ? input.shopId.trim() : '';
  if (shopId.length === 0) return { ok: false, reason: 'shop_id_required' };
  if (!SHOP_UUID.test(shopId)) return { ok: false, reason: 'shop_id_invalid' };
  // SQL's regex is lowercase-only, so the segment is normalised rather than sent
  // as the caller happened to spell it.
  return { ok: true, key: `push_cap_unverified:${shopId.toLowerCase()}:${day}` };
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
  /** The ledger KIND for `dedupeKey`. Omitted ⇒ no alert is sent. */
  kind?: PushAlertKind | null;
}): Promise<OpsAlert> {
  const to = input.env.OPS_ALERT_EMAIL?.trim() ?? '';
  if (to.length === 0) return { sent: false, reason: 'not_configured', to: null, dedupeKey: null };
  if (!input.transport) return { sent: false, reason: 'transport_unavailable', to, dedupeKey: null };

  const dedupeKey = input.dedupeKey ?? null;
  const kind = input.kind ?? null;
  if (dedupeKey === null || kind === null || !input.sink) {
    // No way to honour the once-per-day limit: the alert is withheld and the
    // caller can see why. Same direction as the missing address — never a second
    // path, never an unlimited burst. The kind is NOT derivable from the key
    // (`breaker_open` and `quota_unreadable` share the `<kind>:<date>` shape), so
    // an absent kind is as unledgerable as an absent key.
    return { sent: false, reason: 'transport_unavailable', to, dedupeKey: null };
  }

  /*
   * PHASE 1 — CLAIM. `delivered: false` = "this key is not yet acknowledged". A
   * claim that comes back false is a key already ACKNOWLEDGED that Thai day (or a
   * lease another run still holds): nothing may be sent, and no acknowledgement is
   * owed. An unacknowledged claim holds a five-minute lease, so a later run may
   * retry it — which is exactly what must happen when the send below fails.
   */
  let claimed: boolean;
  try {
    claimed = (await input.sink.claim({ kind, key: dedupeKey, delivered: false })).claimed;
  } catch {
    return { sent: false, reason: 'transport_unavailable', to, dedupeKey };
  }
  if (!claimed) return { sent: false, reason: 'already_alerted_today', to, dedupeKey };

  /*
   * PHASE 2 — SEND. The provider idempotency key `kind:key` is stable for this
   * (kind, Thai day) pair and is handed to the transport, which puts it on the
   * wire: a crash between the claim and this call, re-run inside the five-minute
   * lease, sends the SAME idempotent request and the provider collapses it. SQL
   * cannot prove exactly-once external delivery, so this is the app's job.
   */
  let result: { ok: boolean; status: number };
  try {
    result = await input.transport.send({
      to,
      subject: input.subject,
      text: input.text,
      // STABLE for this (kind, day key) pair: the transport carries it to the
      // provider as the real `Idempotency-Key` header, so a retry after a crash
      // inside the five-minute lease collapses at the provider instead of
      // delivering a second copy.
      idempotencyKey: providerAlertIdempotencyKey(kind, dedupeKey),
    });
  } catch {
    // Do NOT acknowledge: the day key must stay retryable after the lease expires
    // rather than be recorded as delivered when nothing left.
    return { sent: false, reason: 'transport_unavailable', to, dedupeKey };
  }
  if (!result.ok) {
    // Same rule for a transport that reports failure: no acknowledgement, so a
    // later run can still deliver this alert.
    return { sent: false, reason: 'transport_unavailable', to, dedupeKey };
  }

  /*
   * PHASE 3 — ACKNOWLEDGE, only after the provider ACCEPTED the message. The
   * acknowledgement never authorises another send: it returns claimed=false and
   * delivered=true, and a delivered key cannot be reclaimed that Thai day. A
   * failure to acknowledge is not a failed alert — the mail left — so the result
   * stays `sent` and the key simply stays claimable until the next run records it.
   */
  try {
    await input.sink.claim({ kind, key: dedupeKey, delivered: true });
  } catch {
    // Deliberately swallowed: see above.
  }
  return { sent: true, reason: 'sent', to, dedupeKey };
}
