import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

// The handlers live in library modules now. Next 16.3.6 asserts that an App Router
// route module exports nothing but the HTTP methods and the documented config
// symbols (a non-method export fails the build as TS2344), so each route module
// re-exports POST and the handler is imported from `src/lib` here.
const lineRoute = await import('../apps/booking-consumer/src/lib/line-webhook.ts');
const dispatchRoute = await import('../apps/booking-consumer/src/lib/notification-dispatch.ts');
const uploadRoute = await import('../apps/booking-consumer/src/lib/deposit-slip-upload-intent.ts');

function request(path: string, body: string, headers: Record<string, string> = {}, method = 'POST') {
  return new Request(`https://bk01.test${path}`, { method, headers, body: method === 'GET' ? undefined : body });
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

function sign(body: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

const lineConfig = { mode: 'merchant' as const, channelSecret: 'line-secret', accessToken: 'line-access' };
const event = {
  type: 'message', webhookEventId: 'line-event-1', replyToken: 'reply-token', source: { userId: `U${'a'.repeat(32)}` },
  message: { type: 'text', text: 'ผูกคิว BK1234-ABCD123456' },
};

test('LINE rejects invalid signature before token issuer, and processes a signed merchant binding through RPCs', async () => {
  const body = JSON.stringify({ events: [event] });
  let tokenRequests = 0;
  const invalid = await lineRoute.handleLineWebhook(
    request('/api/line/webhook', body, { 'x-line-signature': 'bad' }), lineConfig, 'shop-1',
    async () => { tokenRequests += 1; throw new Error('must not run'); },
  );
  assert.equal(invalid.status, 401);
  assert.equal(tokenRequests, 0);

  const malformedBody = '{not-json';
  const malformed = await lineRoute.handleLineWebhook(
    request('/api/line/webhook', malformedBody, { 'x-line-signature': sign(malformedBody, lineConfig.channelSecret) }), lineConfig, 'shop-1',
    async () => { tokenRequests += 1; throw new Error('must not run'); },
  );
  assert.equal(malformed.status, 200);
  assert.equal((await responseJson(malformed)).success, false);
  assert.equal(tokenRequests, 0);

  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const runtime = { rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === 'bk01_line_bind_booking') return { data: [{
      claimed: true, booking_id: 'booking-1', shop_id: 'shop-1', customer_id: 'customer-1',
      line_user_id: event.source.userId, booking_context: { booking_code: 'BK-1234', booking_date: '2026-10-01', start_time: '09:00', shop_name: 'ร้านทดสอบ' }, lease_token: 'lease-1',
    }], error: null };
    return { data: true, error: null };
  } };
  const replyCalls: string[] = [];
  const response = await lineRoute.handleLineWebhook(
    request('/api/line/webhook', body, { 'x-line-signature': sign(body, lineConfig.channelSecret) }), lineConfig, 'shop-1',
    async () => runtime as any,
    async (url) => { replyCalls.push(String(url)); return new Response('{}', { status: 200 }); },
  );
  const result = await responseJson(response);
  assert.equal(response.status, 200);
  assert.equal(result.processedEvents, 1);
  assert.deepEqual(rpcCalls.map((call) => call.name), ['bk01_line_bind_booking', 'bk01_finish_line_webhook_delivery']);
  assert.equal(rpcCalls[0].args.p_line_user_id, event.source.userId);
  assert.equal(replyCalls.length, 1);
});

test('LINE replay, RPC failure, trial RPC, and issuer failure fail closed', async () => {
  const body = JSON.stringify({ events: [event] });
  const headers = { 'x-line-signature': sign(body, lineConfig.channelSecret) };
  let replies = 0;
  const replay = await lineRoute.handleLineWebhook(request('/line', body, headers), lineConfig, 'shop-1', async () => ({
    rpc: async () => ({ data: [{ claimed: false }], error: null }),
  }) as any, async () => { replies += 1; return new Response('{}'); });
  assert.equal((await responseJson(replay)).skippedEvents, 1);
  // G10 order (2026-10-02) supersedes the round-1 expectation of 0: a refused
  // binding now sends ONE neutral reply that names nobody and leaks nothing.
  assert.equal(replies, 1);

  const rpcFailure = await lineRoute.handleLineWebhook(request('/line', body, headers), lineConfig, 'shop-1', async () => ({
    rpc: async () => ({ data: null, error: { code: 'XX000' } }),
  }) as any, async () => new Response('{}'));
  assert.equal((await responseJson(rpcFailure)).failedEvents, 1);

  let calls = 0;
  const trialRpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const trial = await lineRoute.handleLineWebhook(request('/line', body, headers), { ...lineConfig, mode: 'central' }, undefined, async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls += 1;
      trialRpcCalls.push({ name, args });
      if (name === 'bk01_line_bind_booking_trial') return { data: [{
        claimed: true, booking_id: 'booking-1', shop_id: 'shop-1',
        booking_context: { booking_code: 'BK-1234', booking_date: '2026-10-01', start_time: '09:00', shop_name: 'ร้านทดสอบ' },
        lease_token: 'lease-trial-1',
      }], error: null };
      return { data: true, error: null };
    },
  }) as any, async () => new Response('{}', { status: 200 }));
  assert.equal(trial.status, 200);
  assert.equal((await responseJson(trial)).processedEvents, 1);
  assert.equal(calls, 2);
  assert.deepEqual(trialRpcCalls.map(({ name }) => name), ['bk01_line_bind_booking_trial', 'bk01_finish_line_webhook_delivery']);
  assert.deepEqual(trialRpcCalls[0].args, {
    p_webhook_event_id: event.webhookEventId,
    p_booking_code: 'BK1234',
    p_link_token: 'ABCD123456',
    p_line_user_id: event.source.userId,
  });

  let trialTokenCalls = 0;
  const trialRpcFailure = await lineRoute.handleLineWebhook(request('/line', body, headers), { ...lineConfig, mode: 'central' }, undefined, async () => {
    trialTokenCalls += 1;
    return { rpc: async () => ({ data: null, error: { code: 'XX000' } }) } as any;
  });
  assert.equal((await responseJson(trialRpcFailure)).failedEvents, 1);
  assert.equal(trialTokenCalls, 1);

  let invalidSignatureTokenCalls = 0;
  const invalidTrialSignature = await lineRoute.handleLineWebhook(request('/line', body, { 'x-line-signature': 'bad' }), { ...lineConfig, mode: 'central' }, undefined, async () => {
    invalidSignatureTokenCalls += 1;
    throw new Error('must not run');
  });
  assert.equal(invalidTrialSignature.status, 401);
  assert.equal(invalidSignatureTokenCalls, 0);

  const issuerFailure = await lineRoute.handleLineWebhook(request('/line', body, headers), lineConfig, 'shop-1', async () => {
    throw new Error('issuer down');
  });
  assert.equal(issuerFailure.status, 503);
});

test('dispatch checks its secret before runtime, claims context, sends LINE, and completes via RPC', async () => {
  const oldSecret = process.env.NOTIFICATION_DISPATCH_SECRET;
  const oldLineSecret = process.env.LINE_CHANNEL_SECRET;
  const oldLineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  process.env.NOTIFICATION_DISPATCH_SECRET = 'dispatch-secret';
  process.env.LINE_CHANNEL_SECRET = 'central-secret';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'central-token';
  try {
    let tokenRequests = 0;
    const unauthorized = await dispatchRoute.handleNotificationDispatch(request('/dispatch', ''), async () => {
      tokenRequests += 1; throw new Error('must not run');
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(tokenRequests, 0);

    const calls: string[] = [];
    const runtime = { rpc: async (name: string) => {
      calls.push(name);
      if (name === 'claim_due_line_notifications') return { data: [{ id: 'notification-1', shop_id: 'shop-1', event_type: 'reminder_24h', attempt_count: 1 }], error: null };
      if (name === 'get_line_notification_delivery_context') return { data: [{
        id: 'notification-1', shop_id: 'shop-1', event_type: 'reminder_24h', recipient_type: 'customer', attempt_count: 1,
        line_user_id: event.source.userId, line_oa_id: null, shop_name: 'ร้านทดสอบ', subscription_plan: 'free', booking_date: '2026-10-01', start_time: '09:00:00',
      }], error: null };
      return { data: true, error: null };
    } };
    const response = await dispatchRoute.handleNotificationDispatch(
      request('/dispatch', '', { authorization: 'Bearer dispatch-secret' }), async () => runtime as any,
      async () => new Response('{}', { status: 200 }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['claim_due_line_notifications', 'get_line_notification_delivery_context', 'complete_line_notification']);

    const rpcFailure = await dispatchRoute.handleNotificationDispatch(
      request('/dispatch', '', { authorization: 'Bearer dispatch-secret' }),
      async () => ({ rpc: async () => ({ data: null, error: { code: 'XX000' } }) }) as any,
    );
    assert.equal(rpcFailure.status, 500);
  } finally {
    process.env.NOTIFICATION_DISPATCH_SECRET = oldSecret;
    process.env.LINE_CHANNEL_SECRET = oldLineSecret;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = oldLineToken;
  }
});

test('upload intent authorizes by RPC, returns Storage URL, and reports Storage/issuer failures clearly', async () => {
  // The intent handler now requires the canonical booking uuid (G36 F1: a raw-string key
  // gave one booking one bucket per spelling). This case is about the RPC/Storage wiring,
  // so it uses the form `gen_random_uuid()` prints.
  const uploadBookingId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const body = JSON.stringify({ bookingId: uploadBookingId, recoveryToken: 'recovery', contentType: 'image/png', size: 2048 });
  const runtime = { rpc: async () => ({ data: [{ object_path: `${uploadBookingId}/grant.png` }], error: null }), storage: {
    from: (bucket: string) => ({ createSignedUploadUrl: async (path: string) => ({ data: { token: `${bucket}:${path}` }, error: null }) }),
  } };
  const response = await uploadRoute.handleUploadIntent(request('/upload', body), async () => runtime as any);
  assert.deepEqual(await responseJson(response), { objectPath: `${uploadBookingId}/grant.png`, token: `deposit-slips:${uploadBookingId}/grant.png` });

  const grantFailure = await uploadRoute.handleUploadIntent(request('/upload', body), async () => ({
    rpc: async () => ({ data: null, error: { code: '42501' } }), storage: runtime.storage,
  }) as any);
  assert.equal(grantFailure.status, 403);

  const storageFailure = await uploadRoute.handleUploadIntent(request('/upload', body), async () => ({
    ...runtime, storage: { from: () => ({ createSignedUploadUrl: async () => ({ data: null, error: { code: '42501' } }) }) },
  }) as any);
  assert.equal(storageFailure.status, 503);
  assert.equal((await responseJson(storageFailure)).code, 'STORAGE_GRANT_UNAVAILABLE');

  const issuerFailure = await uploadRoute.handleUploadIntent(request('/upload', body), async () => { throw new Error('issuer down'); });
  assert.equal(issuerFailure.status, 503);
});

test('Stripe verifies signature before token issuer; happy, replay, RPC error, and issuer error paths use only RPCs', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'stripe-secret';
  process.env.STRIPE_SECRET_KEY = 'stripe-api-key';
  const stripeRoute = await import('../apps/booking-admin/src/lib/stripe-webhook.ts');
  const stripeClient = (constructError = false) => ({ webhooks: {
    constructEvent: () => {
      if (constructError) throw new Error('signature invalid');
      return { id: 'evt_1', type: 'unsupported.event', created: 1, data: { object: {} } };
    },
  } } as any);

  let issuerCalls = 0;
  const invalid = await stripeRoute.handleStripeWebhook(request('/stripe', '{}', { 'stripe-signature': 'invalid' }), async () => {
    issuerCalls += 1; throw new Error('must not run');
  }, () => stripeClient(true));
  assert.equal(invalid.status, 400);
  assert.equal(issuerCalls, 0);

  const calls: string[] = [];
  const runtime = { rpc: async (name: string) => {
    calls.push(name);
    if (name === 'claim_stripe_webhook_event') return { data: true, error: null };
    return { data: true, error: null };
  } };
  const success = await stripeRoute.handleStripeWebhook(request('/stripe', '{}', { 'stripe-signature': 'valid' }), async () => runtime as any, () => stripeClient());
  assert.equal(success.status, 200);
  assert.deepEqual(calls, ['claim_stripe_webhook_event', 'finish_stripe_webhook_event']);

  const replay = await stripeRoute.handleStripeWebhook(request('/stripe', '{}', { 'stripe-signature': 'valid' }), async () => ({
    rpc: async () => ({ data: false, error: null }),
  }) as any, () => stripeClient());
  assert.equal((await responseJson(replay)).duplicate, true);

  const rpcFailure = await stripeRoute.handleStripeWebhook(request('/stripe', '{}', { 'stripe-signature': 'valid' }), async () => ({
    rpc: async () => ({ data: null, error: { code: 'XX000' } }),
  }) as any, () => stripeClient());
  assert.equal(rpcFailure.status, 500);

  const issuerFailure = await stripeRoute.handleStripeWebhook(request('/stripe', '{}', { 'stripe-signature': 'valid' }), async () => { throw new Error('issuer down'); }, () => stripeClient());
  assert.equal(issuerFailure.status, 500);
});
