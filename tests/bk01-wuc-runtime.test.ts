import assert from 'node:assert/strict';
import test from 'node:test';

const { getBk01RuntimeClient } = await import('../apps/booking-consumer/src/lib/bk01-runtime.ts');

function runtimeToken(expiresAt: number, role = 'bk01_runtime', audience = 'wstera-lab') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role, aud: audience, exp: expiresAt })).toString('base64url');
  return `${header}.${payload}.signature`;
}

test('House issuer requests are single-flight; Supabase uses anon apikey plus runtime bearer; issuer failure has no fallback', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const oldEnv = {
    issuer: process.env.HOUSE_RUNTIME_ISSUER_URL,
    audience: process.env.HOUSE_RUNTIME_AUDIENCE,
    clientId: process.env.HOUSE_RUNTIME_CLIENT_ID,
    clientSecret: process.env.HOUSE_RUNTIME_CLIENT_SECRET,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  const now = Math.floor(Date.now() / 1000);
  process.env.HOUSE_RUNTIME_ISSUER_URL = 'https://issuer.test/oauth/token';
  process.env.HOUSE_RUNTIME_AUDIENCE = 'wstera-lab';
  process.env.HOUSE_RUNTIME_CLIENT_ID = 'bk01-client';
  process.env.HOUSE_RUNTIME_CLIENT_SECRET = 'test-client-secret';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';

  let issuerRequests = 0;
  let apiRequests = 0;
  let issuerBody = '';
  let dataApiHeaders: Headers | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://issuer.test/')) {
      issuerRequests += 1;
      issuerBody = String(init?.body ?? '');
      if (issuerRequests === 2) return Response.json({ access_token: runtimeToken(now + 120, 'admin') });
      if (issuerRequests > 2) return new Response('{}', { status: 503 });
      return Response.json({ access_token: runtimeToken(now + 120) });
    }
    apiRequests += 1;
    dataApiHeaders = new Headers(init?.headers);
    return Response.json(true);
  }) as typeof fetch;

  try {
    const [clientA, clientB] = await Promise.all([getBk01RuntimeClient(), getBk01RuntimeClient()]);
    assert.equal(clientA, clientB);
    assert.equal(issuerRequests, 1);
    assert.match(issuerBody, /grant_type=client_credentials/);
    assert.match(issuerBody, /audience=wstera-lab/);
    assert.match(issuerBody, /scope=bk01_runtime/);

    const result = await clientA.rpc('probe_runtime_authority');
    assert.equal(result.data, true);
    assert.equal(apiRequests, 1);
    assert.equal(dataApiHeaders?.get('apikey'), 'anon-test-key');
    assert.equal(dataApiHeaders?.get('content-profile') ?? dataApiHeaders?.get('accept-profile'), 'local_service');
    assert.match(dataApiHeaders?.get('Authorization') ?? '', /^Bearer [^.]+\.[^.]+\.[^.]+$/);
    assert.doesNotMatch(dataApiHeaders?.get('Authorization') ?? '', /test-client-secret|anon-test-key/);

    Date.now = () => (now + 100) * 1000;
    await assert.rejects(getBk01RuntimeClient(), /outside the bk01 contract/i);
    assert.equal(issuerRequests, 2);
    await assert.rejects(getBk01RuntimeClient(), /issuer rejected/i);
    assert.equal(issuerRequests, 3);
    assert.equal(apiRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    for (const [key, value] of Object.entries({
      HOUSE_RUNTIME_ISSUER_URL: oldEnv.issuer,
      HOUSE_RUNTIME_AUDIENCE: oldEnv.audience,
      HOUSE_RUNTIME_CLIENT_ID: oldEnv.clientId,
      HOUSE_RUNTIME_CLIENT_SECRET: oldEnv.clientSecret,
      NEXT_PUBLIC_SUPABASE_URL: oldEnv.supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: oldEnv.anonKey,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
