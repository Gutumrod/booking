import assert from 'node:assert/strict';
import test from 'node:test';

const dispatchRoute = await import('../apps/booking-consumer/src/app/api/notifications/dispatch/route.ts');

/**
 * The dispatch route is the one place a notification actually leaves the system.
 * Owner decision A-20 says the shop is reached by e-mail and never by LINE, so
 * the strongest statement this unit can make is: with a `shop_owner` row claimed,
 * no request to api.line.me is ever made, and the e-mail transport is the only
 * thing called. That is what these tests assert against a recorded fetch.
 */
function request(headers: Record<string, string>) {
  return new Request('https://bk01.test/api/notifications/dispatch', { method: 'POST', headers });
}

function contextRow(overrides: Record<string, unknown>) {
  return {
    id: 'notification-1', shop_id: 'shop-1', event_type: 'deposit_approved', recipient_type: 'shop_owner',
    attempt_count: 1, line_user_id: null, line_oa_id: 'oa-1', shop_name: 'ร้านทดสอบ', subscription_plan: 'basic_490',
    booking_date: '2026-10-02', start_time: '09:00:00', booking_code: 'BK-7K2M9Q', can_resubmit: null,
    start_timestamptz: '2099-01-01T02:00:00Z',
    ...overrides,
  };
}

function runtimeFor(contextOverrides: Record<string, unknown>) {
  const calls: string[] = [];
  const runtime = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === 'claim_due_line_notifications') {
        return { data: [{ id: 'notification-1', shop_id: 'shop-1', event_type: 'deposit_approved', attempt_count: 1 }], error: null };
      }
      if (name === 'get_line_notification_delivery_context') return { data: [contextRow(contextOverrides)], error: null };
      return { data: true, error: null };
    },
  };
  return { runtime, calls };
}

const ENV_KEYS = ['NOTIFICATION_DISPATCH_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM', 'NEXT_PUBLIC_ADMIN_SITE_URL', 'LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'];

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  return (async () => {
    try {
      for (const key of ENV_KEYS) delete process.env[key];
      Object.assign(process.env, values);
      await run();
    } finally {
      for (const key of ENV_KEYS) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  })();
}

test('a merchant row is delivered by e-mail and never touches LINE', async () => {
  await withEnv({
    NOTIFICATION_DISPATCH_SECRET: 'dispatch-secret',
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'shop@wstera.com',
    NEXT_PUBLIC_ADMIN_SITE_URL: 'https://admin.bk01.wstera.com',
    LINE_CHANNEL_SECRET: 'central-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'central-token',
  }, async () => {
    const outbound: string[] = [];
    const send = (async (url: string) => {
      outbound.push(String(url));
      if (String(url).includes('api.line.me')) return new Response('{}', { status: 200 });
      return new Response('{"id":"msg_1"}', { status: 200 });
    }) as unknown as typeof fetch;

    const { runtime, calls } = runtimeFor({});
    const response = await dispatchRoute.handleNotificationDispatch(
      request({ authorization: 'Bearer dispatch-secret' }),
      async () => runtime as any,
      send,
      async () => { throw new Error('merchant LINE channel must not be resolved for a shop row'); },
      null,
      async () => ({ shopName: 'ร้านทดสอบ', email: 'owner@example.com' }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { claimed: 1, sent: 1, failed: 0, skippedStaleAppointment: 0 });
    assert.deepEqual(outbound, ['https://api.resend.com/emails'], 'the only outbound call is Resend');
    assert.ok(!outbound.some((url) => url.includes('api.line.me')), 'no LINE request may be made for a shop_owner row');
    assert.deepEqual(calls, ['claim_due_line_notifications', 'get_line_notification_delivery_context', 'complete_line_notification']);
  });
});

test('with no e-mail key the merchant row fails closed and still sends nothing anywhere', async () => {
  await withEnv({
    NOTIFICATION_DISPATCH_SECRET: 'dispatch-secret',
    NEXT_PUBLIC_ADMIN_SITE_URL: 'https://admin.bk01.wstera.com',
    LINE_CHANNEL_SECRET: 'central-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'central-token',
  }, async () => {
    const outbound: string[] = [];
    const send = (async (url: string) => { outbound.push(String(url)); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;

    const recorded: Array<Record<string, unknown>> = [];
    const { runtime } = runtimeFor({});
    const runtimeWithRecord = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'complete_line_notification') recorded.push(args);
        return runtime.rpc(name);
      },
    };

    const response = await dispatchRoute.handleNotificationDispatch(
      request({ authorization: 'Bearer dispatch-secret' }),
      async () => runtimeWithRecord as any,
      send,
      async () => { throw new Error('must not resolve a merchant LINE channel'); },
      null,
      async () => ({ shopName: 'ร้านทดสอบ', email: 'owner@example.com' }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { claimed: 1, sent: 0, failed: 1, skippedStaleAppointment: 0 });
    assert.deepEqual(outbound, [], 'an unconfigured e-mail transport makes no call at all -- there is no fallback channel');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].p_sent_at, null);
    assert.match(String(recorded[0].p_error_message), /EMAIL_NOT_CONFIGURED/);
    // The retry policy is the existing one: a first failure re-queues with backoff
    // and the row only becomes `failed` at the fifth attempt. It is never `sent`.
    assert.equal(recorded[0].p_status, 'pending');
  });
});

test('a shop owner with no resolvable address fails closed, not by falling back to LINE', async () => {
  await withEnv({
    NOTIFICATION_DISPATCH_SECRET: 'dispatch-secret',
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'shop@wstera.com',
    LINE_CHANNEL_SECRET: 'central-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'central-token',
  }, async () => {
    const outbound: string[] = [];
    const send = (async (url: string) => { outbound.push(String(url)); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const { runtime } = runtimeFor({});

    const response = await dispatchRoute.handleNotificationDispatch(
      request({ authorization: 'Bearer dispatch-secret' }),
      async () => runtime as any,
      send,
      async () => { throw new Error('must not resolve a merchant LINE channel'); },
      null,
      async () => null,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { claimed: 1, sent: 0, failed: 1, skippedStaleAppointment: 0 });
    assert.deepEqual(outbound, [], 'no recipient means no call, and never a LINE call');
  });
});

test('a customer row still goes over LINE with the message it always had', async () => {
  await withEnv({
    NOTIFICATION_DISPATCH_SECRET: 'dispatch-secret',
    LINE_CHANNEL_SECRET: 'central-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'central-token',
  }, async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    const send = (async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const { runtime } = runtimeFor({
      recipient_type: 'customer', event_type: 'reminder_24h', line_user_id: 'U-customer', subscription_plan: 'free',
      start_timestamptz: '2099-01-01T02:00:00Z',
    });

    const response = await dispatchRoute.handleNotificationDispatch(
      request({ authorization: 'Bearer dispatch-secret' }),
      async () => runtime as any,
      send,
      null as any,
      null,
      null,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { claimed: 1, sent: 1, failed: 0, skippedStaleAppointment: 0 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://api.line.me/v2/bot/message/push');
    assert.deepEqual(sent[0].body, {
      to: 'U-customer',
      messages: [{ type: 'text', text: 'แจ้งเตือนคิวที่ ร้านทดสอบ วันที่ 2026-10-02 เวลา 09:00' }],
    });
  });
});

test('a rejected-slip row tells the customer in both languages, per the re-upload rule', async () => {
  await withEnv({
    NOTIFICATION_DISPATCH_SECRET: 'dispatch-secret',
    LINE_CHANNEL_SECRET: 'central-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'central-token',
  }, async () => {
    const sent: Array<{ body: any }> = [];
    const send = (async (_url: string, init: RequestInit) => {
      sent.push({ body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    for (const canResubmit of [true, false]) {
      const { runtime } = runtimeFor({
        recipient_type: 'customer', event_type: 'deposit_rejected', line_user_id: 'U-customer',
        subscription_plan: 'free', can_resubmit: canResubmit,
      });
      const response = await dispatchRoute.handleNotificationDispatch(
        request({ authorization: 'Bearer dispatch-secret' }),
        async () => runtime as any,
        send,
        null as any,
        null,
        null,
      );
      assert.equal(response.status, 200);
    }

    assert.equal(sent.length, 2);
    assert.match(sent[0].body.messages[0].text, /อัปโหลดสลิปใหม่/);
    assert.match(sent[0].body.messages[0].text, /EN:/);
    assert.match(sent[1].body.messages[0].text, /จองคิวใหม่/);
    assert.match(sent[1].body.messages[0].text, /EN:/);
  });
});
