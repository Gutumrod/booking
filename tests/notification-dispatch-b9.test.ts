import assert from 'node:assert/strict';
import test from 'node:test';

const dispatchRoute = await import('../apps/booking-consumer/src/app/api/notifications/dispatch/route.ts');

/**
 * B9 route-level reproduction. The unit tests pin the decisions; these run the
 * real dispatch handler with a trial shop and a stale appointment, which is what
 * the finding actually describes.
 *
 * The distinguishing assertions are on the OUTBOUND CALLS: the defect was not a
 * wrong message, it was that no message left at all (B9(a)) or that a mistimed
 * one did (B9(b)).
 */

function request() {
  return new Request('https://bk01.test/api/notifications/dispatch', {
    method: 'POST',
    headers: { authorization: 'Bearer dispatch-secret' },
  });
}

function runtimeFor(context: Record<string, unknown>, rpcCalls: Array<{ name: string; args: any }> = []) {
  const runtime = {
    rpc: async (name: string, args: any = {}) => {
      rpcCalls.push({ name, args });
      if (name === 'claim_due_line_notifications') {
        return { data: [{ id: 'n1', shop_id: 'shop-1', event_type: String(context.event_type), attempt_count: 1 }], error: null };
      }
      if (name === 'get_line_notification_delivery_context') {
        return {
          data: [{
            id: 'n1', shop_id: 'shop-1', event_type: 'reminder_24h', recipient_type: 'customer',
            attempt_count: 1, line_user_id: 'U-customer', line_oa_id: null, shop_name: 'ร้านทดลอง',
            subscription_plan: 'basic_490', booking_date: '2026-10-01', start_time: '09:00:00',
            booking_code: 'BK-TRIAL', can_resubmit: null, start_timestamptz: '2026-10-02T02:00:00Z',
            ...context,
          }],
          error: null,
        };
      }
      return { data: true, error: null };
    },
  };
  return { runtime, rpcCalls };
}

const ENV_KEYS = ['NOTIFICATION_DISPATCH_SECRET', 'LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'NEXT_PUBLIC_ADMIN_SITE_URL'];
async function withEnv(values: Record<string, string>, run: () => Promise<void>) {
  const previous = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, values);
    await run();
  } finally {
    for (const k of ENV_KEYS) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
}

const BASE_ENV = {
  NOTIFICATION_DISPATCH_SECRET: 'dispatch-secret',
  LINE_CHANNEL_SECRET: 'central-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'central-token',
};

test('B9(a) a Basic-trial shop with no merchant channel still reaches the customer over the central channel', async () => {
  await withEnv(BASE_ENV, async () => {
    const outbound: Array<{ url: string; auth: string | null; body: any }> = [];
    const send = (async (url: string, init: RequestInit) => {
      outbound.push({
        url: String(url),
        auth: (init?.headers as Record<string, string>)?.Authorization ?? null,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    // The merchant resolver is what a trial shop cannot satisfy: it throws,
    // exactly as resolveMerchantLineChannel does with no record in
    // LINE_MERCHANT_CHANNELS_JSON.
    const merchantResolver = async () => { throw new Error('Merchant LINE credentials are not configured'); };

    const { runtime } = runtimeFor({});
    const response = await dispatchRoute.handleNotificationDispatch(
      request(), async () => runtime as any, send, merchantResolver as any, null, null,
    );

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, number>;
    assert.equal(body.sent, 1, 'the customer must be reached; before the fix this was sent=0');
    assert.equal(body.failed, 0);
    assert.equal(outbound.length, 1, 'exactly one push, and it must be the central channel');
    assert.equal(outbound[0].url, 'https://api.line.me/v2/bot/message/push');
    assert.equal(outbound[0].auth, 'Bearer central-token', 'the central channel credential, not a merchant one');
    assert.equal(outbound[0].body.to, 'U-customer');
  });
});

test('B9(a) a paid shop WITH its own channel still uses the merchant channel', async () => {
  await withEnv(BASE_ENV, async () => {
    const auths: string[] = [];
    const send = (async (_url: string, init: RequestInit) => {
      auths.push((init?.headers as Record<string, string>)?.Authorization ?? '');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const { runtime } = runtimeFor({});
    const response = await dispatchRoute.handleNotificationDispatch(
      request(), async () => runtime as any, send,
      (async () => ({ mode: 'merchant', channelSecret: 'm-sec', accessToken: 'merchant-token' })) as any,
      null, null,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(auths, ['Bearer merchant-token'], 'a configured shop keeps its own channel');
  });
});

test('B9(b) a reminder for an appointment already past is skipped, retired, and never pushed', async () => {
  await withEnv(BASE_ENV, async () => {
    const outbound: string[] = [];
    const send = (async (url: string) => { outbound.push(String(url)); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;

    const rpcCalls: Array<{ name: string; args: any }> = [];
    // Appointment three hours ago; the reminder is due now. This is the state the
    // reproduction produced: a row created while the appointment was future, then
    // dispatched late.
    const { runtime } = runtimeFor({ start_timestamptz: new Date(Date.now() - 3 * 3600_000).toISOString() }, rpcCalls);

    const response = await dispatchRoute.handleNotificationDispatch(
      request(), async () => runtime as any, send, (async () => { throw new Error('no channel'); }) as any, null, null,
    );

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, number>;
    assert.equal(body.sent, 0);
    assert.equal(body.skippedStaleAppointment, 1, 'the skip must be reported as its own outcome');
    assert.deepEqual(outbound, [], 'no LINE call may be made for a stale reminder');

    const completed = rpcCalls.find((c) => c.name === 'complete_line_notification');
    assert.ok(completed, 'the row must be retired, not left pending');
    assert.equal(completed.args.p_status, 'failed');
    assert.equal(completed.args.p_sent_at, null);
    assert.equal(completed.args.p_next_retry_at, null, 'a stale reminder must not be retried');
    assert.match(String(completed.args.p_error_message), /appointment time has already passed/);
  });
});

test('B9(b) a reminder for an appointment still ahead is delivered as before', async () => {
  await withEnv(BASE_ENV, async () => {
    const outbound: any[] = [];
    const send = (async (url: string, init: RequestInit) => {
      outbound.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const { runtime } = runtimeFor({ start_timestamptz: new Date(Date.now() + 24 * 3600_000).toISOString() });
    const response = await dispatchRoute.handleNotificationDispatch(
      request(), async () => runtime as any, send, (async () => { throw new Error('no channel'); }) as any, null, null,
    );

    const body = await response.json() as Record<string, number>;
    assert.equal(body.sent, 1);
    assert.equal(body.skippedStaleAppointment, 0);
    assert.equal(outbound.length, 1);
    assert.match(outbound[0].body.messages[0].text, /แจ้งเตือนคิวที่/);
  });
});

test('the appointment guard does not suppress a cancellation notice', async () => {
  await withEnv(BASE_ENV, async () => {
    const outbound: any[] = [];
    const send = (async (_url: string, init: RequestInit) => {
      outbound.push({ body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const { runtime } = runtimeFor({
      event_type: 'booking_cancelled',
      start_timestamptz: new Date(Date.now() - 5 * 3600_000).toISOString(),
    });
    const response = await dispatchRoute.handleNotificationDispatch(
      request(), async () => runtime as any, send, (async () => { throw new Error('no channel'); }) as any, null, null,
    );

    const body = await response.json() as Record<string, number>;
    assert.equal(body.sent, 1, 'a past appointment must not silence a cancellation');
    assert.equal(body.skippedStaleAppointment, 0);
    assert.match(outbound[0].body.messages[0].text, /ยกเลิกคิวที่/);
  });
});

test('an unknown appointment time fails closed for a reminder', async () => {
  await withEnv(BASE_ENV, async () => {
    const outbound: string[] = [];
    const send = (async (url: string) => { outbound.push(String(url)); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const { runtime } = runtimeFor({ start_timestamptz: null });

    const response = await dispatchRoute.handleNotificationDispatch(
      request(), async () => runtime as any, send, (async () => { throw new Error('no channel'); }) as any, null, null,
    );

    const body = await response.json() as Record<string, number>;
    assert.equal(body.sent, 0);
    assert.equal(body.skippedStaleAppointment, 1);
    assert.deepEqual(outbound, []);
  });
});
