import 'server-only';

import { createClient } from '@supabase/supabase-js';

const TOKEN_REFRESH_SKEW_SECONDS = 30;
const MAX_TOKEN_TTL_SECONDS = 15 * 60;
const RUNTIME_ROLE = 'bk01_runtime';
const RUNTIME_SCOPE = 'bk01_runtime';

type RuntimeToken = { value: string; expiresAt: number };
type RuntimeApiClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
  storage: {
    from(bucket: string): {
      createSignedUploadUrl(path: string): Promise<{ data: { token?: string } | null; error: unknown | null }>;
    };
  };
};

let cachedToken: RuntimeToken | null = null;
let tokenRequest: Promise<RuntimeToken> | null = null;
let cachedClient: { token: string; client: RuntimeApiClient } | null = null;

function readJwtClaims(token: string): { exp?: number; aud?: string | string[]; role?: string } {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('House runtime issuer returned an invalid token');
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
  } catch {
    throw new Error('House runtime issuer returned an invalid token');
  }
}

function requiredRuntimeConfig() {
  const issuerUrl = process.env.HOUSE_RUNTIME_ISSUER_URL;
  const audience = process.env.HOUSE_RUNTIME_AUDIENCE;
  const clientId = process.env.HOUSE_RUNTIME_CLIENT_ID;
  const clientSecret = process.env.HOUSE_RUNTIME_CLIENT_SECRET;
  if (!issuerUrl || !audience || !clientId || !clientSecret) {
    throw new Error('House runtime issuer is not configured');
  }
  let parsedIssuerUrl: URL;
  try {
    parsedIssuerUrl = new URL(issuerUrl);
  } catch {
    throw new Error('House runtime issuer is not configured');
  }
  if ((parsedIssuerUrl.protocol !== 'https:'
      && !(parsedIssuerUrl.protocol === 'http:' && parsedIssuerUrl.hostname === 'localhost'))
      || parsedIssuerUrl.username || parsedIssuerUrl.password || parsedIssuerUrl.hash) {
    throw new Error('House runtime issuer must use HTTPS');
  }
  return { issuerUrl: parsedIssuerUrl.toString(), audience, clientId, clientSecret };
}

async function requestRuntimeToken(): Promise<RuntimeToken> {
  const config = requiredRuntimeConfig();
  const credentials = btoa(`${config.clientId}:${config.clientSecret}`);
  let response: Response;
  try {
    response = await fetch(config.issuerUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        audience: config.audience,
        scope: RUNTIME_SCOPE,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('House runtime issuer is unavailable');
  }
  if (!response.ok) throw new Error('House runtime issuer rejected the request');

  let body: { access_token?: unknown };
  try {
    body = await response.json() as { access_token?: unknown };
  } catch {
    throw new Error('House runtime issuer returned an invalid response');
  }
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error('House runtime issuer returned an invalid response');
  }

  const claims = readJwtClaims(body.access_token);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1000);
  if (claims.role !== RUNTIME_ROLE || !audiences.includes(config.audience)
      || !Number.isInteger(claims.exp) || (claims.exp as number) <= now + TOKEN_REFRESH_SKEW_SECONDS
      || (claims.exp as number) > now + MAX_TOKEN_TTL_SECONDS) {
    throw new Error('House runtime issuer returned a token outside the BK01 contract');
  }
  return { value: body.access_token, expiresAt: claims.exp as number };
}

async function getRuntimeToken(): Promise<RuntimeToken> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_SKEW_SECONDS > now) return cachedToken;
  if (!tokenRequest) {
    tokenRequest = requestRuntimeToken()
      .then((token) => {
        cachedToken = token;
        return token;
      })
      .finally(() => { tokenRequest = null; });
  }
  return tokenRequest;
}

export async function getBk01RuntimeClient() {
  const token = await getRuntimeToken();
  if (cachedClient?.token === token.value) return cachedClient.client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error('Supabase runtime API is not configured');
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    db: { schema: 'local_service' },
    global: { headers: { Authorization: `Bearer ${token.value}` } },
  }) as unknown as RuntimeApiClient;
  cachedClient = { token: token.value, client };
  return client;
}
