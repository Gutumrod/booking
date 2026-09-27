
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
type RuntimeClient = Awaited<ReturnType<typeof import('../../../../lib/bk01-runtime').getBk01RuntimeClient>>;
type RuntimeProvider = () => Promise<RuntimeClient>;
const defaultRuntimeProvider: RuntimeProvider = async () => (await import('../../../../lib/bk01-runtime')).getBk01RuntimeClient();

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

    const { data, error } = await runtime.storage.from('deposit-slips').createSignedUploadUrl(grant.object_path);
    if (error || !data?.token) {
      // TODO(HOUSE-STORAGE-UPLOAD-GRANT): route through the separately reviewed
      // House Storage artifact if bk01_runtime cannot create a scoped upload URL.
      return Response.json({ error: 'Storage upload authorization is unavailable', code: 'STORAGE_GRANT_UNAVAILABLE' }, { status: 503 });
    }
    return Response.json({ objectPath: grant.object_path, token: data.token });
  } catch {
    return Response.json({ error: 'Runtime upload authorization is unavailable' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return handleUploadIntent(req);
}
