const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BK01_DEPOSIT_SLIP_BUCKET = 'deposit-slips';
type RuntimeClient = Awaited<ReturnType<typeof import('./bk01-runtime').getBk01RuntimeClient>>;
type RuntimeProvider = () => Promise<RuntimeClient>;
const defaultRuntimeProvider: RuntimeProvider = async () => (await import('./bk01-runtime')).getBk01RuntimeClient();

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
