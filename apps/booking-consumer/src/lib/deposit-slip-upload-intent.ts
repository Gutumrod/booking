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

/**
 * Count one intent request against BOTH budgets and refuse if either is spent.
 *
 * The booking key is the one that must hold: it is the only identity an anonymous
 * caller always has, so a caller behind no `CF-Connecting-IP` is still capped. The
 * per-source key is defence in depth for one address working many bookings. An
 * unidentifiable caller shares one `unknown-client` bucket instead of being given a
 * pass, which is the same fail-closed direction the booking ingress chose.
 */
function consumeUploadIntentBudget(input: { bookingId: string; clientIp: string | null; now?: Date }): BucketDecision {
  const nowMs = (input.now ?? new Date()).getTime();
  const ip = typeof input.clientIp === 'string' && input.clientIp.trim().length > 0 ? input.clientIp.trim() : 'unknown-client';
  const byBooking = consume(`upload-intent:booking:${input.bookingId}`, UPLOAD_INTENT_BOOKING_LIMIT, nowMs);
  const byIp = consume(`upload-intent:ip:${ip}`, UPLOAD_INTENT_IP_LIMIT, nowMs);
  if (!byBooking.allowed) return byBooking;
  return byIp;
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
   * The abuse budget runs BEFORE the runtime, exactly like the booking ingress: a
   * flood must not be able to spend a House runtime token round trip and a database
   * transaction per request, and a caller over budget must not learn anything about
   * whether their token was good.
   */
  const rate = consumeUploadIntentBudget({ bookingId: body.bookingId, clientIp: readClientIp(req.headers) });
  if (!rate.allowed) {
    return Response.json(
      { error: 'Too many upload attempts for this booking. Please try again shortly.', code: 'UPLOAD_INTENT_RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds ?? 60) } },
    );
  }

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
      return Response.json({ error: 'Invalid or expired booking capability' }, { status: 403 });
    }

    // BK01's House allowlist grants only this bucket; the returned object path is
    // the exact path registered atomically by authorize_deposit_slip_upload.
    const { data, error } = await runtime.storage.from(BK01_DEPOSIT_SLIP_BUCKET).createSignedUploadUrl(grant.object_path);
    if (error || !data?.token) {
      return Response.json({ error: 'Storage upload authorization is unavailable', code: 'STORAGE_GRANT_UNAVAILABLE' }, { status: 503 });
    }
    return Response.json({ objectPath: grant.object_path, token: data.token });
  } catch {
    return Response.json({ error: 'Runtime upload authorization is unavailable' }, { status: 503 });
  }
}
