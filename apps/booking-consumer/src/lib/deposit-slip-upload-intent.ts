import { readClientIp } from './booking-ingress';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BK01_DEPOSIT_SLIP_BUCKET = 'deposit-slips';
type RuntimeClient = Awaited<ReturnType<typeof import('./bk01-runtime').getBk01RuntimeClient>>;
type RuntimeProvider = () => Promise<RuntimeClient>;
const defaultRuntimeProvider: RuntimeProvider = async () => (await import('./bk01-runtime')).getBk01RuntimeClient();

/**
 * How many upload grants one booking may be issued inside the window.
 *
 * WHY THIS EXISTS (council finding G36, AGY F-13). This endpoint had no admission
 * control of its own. The authorization RPC does call
 * `authorize_booking_recovery_attempt`, but that counter only increments on a FAILED
 * token (`supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql`: it
 * counts `failed_attempts` and blocks at five). A holder who presents the CORRECT
 * token DELETEs its counter row and returns true, so the limiter protects the token
 * from guessing and never limits the endpoint itself. The measured result was an
 * unbounded number of registered object paths and signed upload URLs for one live
 * booking — 5 MB each, none of which the holder ever has to submit.
 *
 * The budget is deliberately small: a customer uploads one slip, and a retry after a
 * rejected slip is the only honest reason to ask again. The window matches the
 * 5-minute lifetime of the signed URL several times over, which is what an operator
 * needs to see a stuck customer without opening a support ticket.
 */
export const UPLOAD_INTENT_BOOKING_LIMIT = 5;
export const UPLOAD_INTENT_IP_LIMIT = 20;
export const UPLOAD_INTENT_WINDOW_MS = 15 * 60 * 1000;

/**
 * In-memory, per Worker isolate — the same limitation the booking ingress documents,
 * reported rather than hidden. It is a hard ceiling per isolate against one holder,
 * and the durable counter remains an edge/platform configuration item.
 */
const uploadIntentBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * The one booking-id spelling this endpoint accepts: canonical, lower case, hyphenated
 * 8-4-4-4-12.
 *
 * WHY IT IS HERE (F1, found by both paired reviewers on `4d067fd`). The budget used to
 * key on the RAW `bookingId` string while the RPC's parameter is a Postgres `uuid`, and
 * Postgres accepts several spellings of one value (upper case, braces, hyphens omitted
 * or added after any four digits). One booking therefore had one bucket per spelling,
 * so the per-booking ceiling was a property of the spelling rather than of the booking:
 * a measured 20 grants — the full per-source ceiling — against a single booking by
 * varying only the spelling, and opencode measured 5 + 5 from a single address by
 * switching between the canonical and the hyphen-less form. `gen_random_uuid()` always
 * prints the canonical form, so refusing every other spelling costs no real caller
 * anything and closes the bypass before a bucket is ever consulted.
 */
const CANONICAL_BOOKING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Test seam: forget every bucket so a case starts from zero. */
export function resetUploadIntentRateLimit(): void {
  uploadIntentBuckets.clear();
}

interface BucketDecision {
  allowed: boolean;
  retryAfterSeconds: number | null;
}

function consume(key: string, limit: number, nowMs: number): BucketDecision {
  const existing = uploadIntentBuckets.get(key);
  if (!existing || existing.resetAt <= nowMs) {
    uploadIntentBuckets.set(key, { count: 1, resetAt: nowMs + UPLOAD_INTENT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: null };
  }
  if (existing.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)) };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSeconds: null };
}

/** Give back one unit of a budget a request reserved but did not earn. */
function release(key: string, nowMs: number): void {
  const existing = uploadIntentBuckets.get(key);
  if (!existing || existing.resetAt <= nowMs) return;
  existing.count = Math.max(0, existing.count - 1);
}

/**
 * The source bucket key. An unidentifiable caller shares one `unknown-client` bucket
 * instead of being given a pass, which is the fail-closed direction the booking ingress
 * chose for the same situation.
 */
function sourceBucketKey(clientIp: string | null): string {
  return typeof clientIp === 'string' && clientIp.trim().length > 0 ? clientIp.trim() : 'unknown-client';
}

/**
 * A 429 that names the layer that refused it (F5, opencode).
 *
 * WHY. The old text always blamed "this booking", including when the source ceiling was
 * what refused — a caller cannot act on a message that names the wrong layer, and the
 * two refusals have different remedies ("wait for this booking's window" vs "you are
 * sharing an address that is working many bookings").
 */
function rateLimited(scope: 'booking' | 'source', decision: BucketDecision): Response {
  const error = scope === 'booking'
    ? 'Too many upload attempts for this booking. Please try again shortly.'
    : 'Too many upload attempts from this network address. Please try again shortly.';
  return Response.json(
    { error, code: 'UPLOAD_INTENT_RATE_LIMITED', scope },
    { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds ?? 60) } },
  );
}

/**
 * The admission control, in the order the request passes through it.
 *
 * TWO BUDGETS, TWO DIFFERENT CHARGING RULES (F4, opencode). The booking budget is the
 * one that must hold, but the booking id is not a secret — it is in the customer's own
 * booking URL — so charging the booking budget for every attempt, valid token or not,
 * let anyone who could read a booking link spend the real customer's five attempts with
 * junk tokens and lock them out for the window (measured on `4d067fd`: five 403s turned
 * the customer's next honest upload into a 429).
 *
 * The booking unit is therefore RESERVED before the runtime — so the ceiling still
 * holds against a flood and against concurrent requests, which a read-then-charge
 * sequence would not — and RELEASED when the RPC refuses the token (`release`). A
 * refused token costs the caller nothing but their own source budget, and the source
 * budget is charged on every attempt and never released, so an attacker gains nothing
 * net.
 */
interface UploadIntentAdmission {
  /** The key the booking budget is kept under, canonicalised once. */
  bookingKey: string;
  /** The source bucket decision, already charged — `allowed: false` ends the request. */
  source: BucketDecision;
  /** The booking bucket decision, already charged and refundable — see `release`. */
  booking: BucketDecision;
}

function admitUploadIntent(input: { bookingId: string; clientIp: string | null; nowMs: number }): UploadIntentAdmission {
  const bookingKey = `upload-intent:booking:${input.bookingId}`;
  const source = consume(`upload-intent:ip:${sourceBucketKey(input.clientIp)}`, UPLOAD_INTENT_IP_LIMIT, input.nowMs);
  if (!source.allowed) {
    // The source layer already refused, so this request cannot reach the runtime; do not
    // let it also drain a booking's budget, which would let one shared address exhaust
    // the budgets of many bookings while being refused itself.
    return { bookingKey, source, booking: { allowed: true, retryAfterSeconds: null } };
  }
  return { bookingKey, source, booking: consume(bookingKey, UPLOAD_INTENT_BOOKING_LIMIT, input.nowMs) };
}

/**
 * The deposit-slip upload-intent handler.
 *
 * It authorizes one upload through `authorize_deposit_slip_upload` (the RPC that
 * registers the object path atomically) and then asks Storage for a signed upload
 * URL for exactly that path. The bucket name is a constant, not a request value:
 * BK01's House allowlist grants only `deposit-slips`, so a caller cannot name a
 * bucket. The handler refuses before the runtime when the request could not be an
 * image upload at all.
 *
 * The handler lives here, in a library module, rather than in the App Router route
 * module (`app/api/deposit-slips/upload-intent/route.ts`). Next 16.3.6 asserts that
 * a route module exports nothing but the HTTP methods and the documented config
 * symbols; a non-method export fails the production build as TS2344. The route
 * re-exports only `POST`, which delegates here with the same defaults.
 */

export async function handleUploadIntent(req: Request, runtimeProvider: RuntimeProvider = defaultRuntimeProvider) {
  const body = await req.json().catch(() => null) as {
    bookingId?: string; recoveryToken?: string; contentType?: string; size?: number;
  } | null;
  if (!body?.bookingId || !body.recoveryToken || !body.contentType || !ALLOWED_TYPES.has(body.contentType)
      || !Number.isInteger(body.size) || Number(body.size) <= 0 || Number(body.size) > 5 * 1024 * 1024) {
    return Response.json({ error: 'Invalid upload request' }, { status: 400 });
  }

  /*
   * F1: the booking id is canonicalised BEFORE it becomes a budget key. Postgres would
   * accept several spellings of this uuid, so a bucket keyed on the raw string was a
   * bucket per spelling. The id has to be exactly the form `gen_random_uuid()` prints —
   * the form the caller was given in their own booking URL — or it is not a booking id
   * at all, and the request stops here rather than being counted under a made-up key.
   */
  if (!CANONICAL_BOOKING_ID.test(body.bookingId)) {
    return Response.json({ error: 'Invalid upload request' }, { status: 400 });
  }

  /*
   * The abuse budget runs BEFORE the runtime, exactly like the booking ingress: a
   * flood must not be able to spend a House runtime token round trip and a database
   * transaction per request, and a caller over budget must not learn anything about
   * whether their token was good.
   */
  const nowMs = Date.now();
  const admission = admitUploadIntent({ bookingId: body.bookingId, clientIp: readClientIp(req.headers), nowMs });
  if (!admission.source.allowed) return rateLimited('source', admission.source);
  if (!admission.booking.allowed) return rateLimited('booking', admission.booking);

  try {
    const runtime = await runtimeProvider();
    const { data: grants, error: grantError } = await runtime.rpc('authorize_deposit_slip_upload', {
      p_booking_id: body.bookingId,
      p_recovery_token: body.recoveryToken,
      p_content_type: body.contentType,
      p_size_bytes: body.size,
    });
    const grant = Array.isArray(grants) ? grants[0] : grants;
    if (grantError || !grant?.object_path) {
      /*
       * The token was not good, so this attempt must not count against the booking: the
       * id is public, and an attacker holding only the id would otherwise be able to
       * spend a real customer's budget with junk (F4). The unit reserved above is given
       * back; the source unit is not, so the attacker's own budget still pays for the
       * attempt.
       */
      release(admission.bookingKey, nowMs);
      return Response.json({ error: 'Invalid or expired booking capability' }, { status: 403 });
    }

    // BK01's House allowlist grants only this bucket; the returned object path is
    // the exact path registered atomically by authorize_deposit_slip_upload.
    const { data, error } = await runtime.storage.from(BK01_DEPOSIT_SLIP_BUCKET).createSignedUploadUrl(grant.object_path);
    if (error || !data?.token) {
      // The grant was registered but no URL could be minted; the holder may honestly
      // retry, so this attempt is refunded too rather than costing the booking a unit.
      release(admission.bookingKey, nowMs);
      return Response.json({ error: 'Storage upload authorization is unavailable', code: 'STORAGE_GRANT_UNAVAILABLE' }, { status: 503 });
    }
    return Response.json({ objectPath: grant.object_path, token: data.token });
  } catch {
    release(admission.bookingKey, nowMs);
    return Response.json({ error: 'Runtime upload authorization is unavailable' }, { status: 503 });
  }
}
