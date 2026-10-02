import assert from 'node:assert/strict';
import test from 'node:test';

/*
 * N1 recurrence guard (HOUSE-BK01-P0-APP, independent review 2026-10-02, Qwen).
 *
 * `handleNotificationDispatch` reports an `oaQuotaAlerted` boolean. The pre-fix
 * source set it to `true` BEFORE `sendOpsAlert` ran, so the response claimed an
 * operator alert had gone out even when the address was unset, the transport was
 * absent, the day key was already acknowledged, or the provider rejected the mail.
 *
 * The only honest value is `sendOpsAlert`'s own `sent`, which is true strictly after
 * the provider ACCEPTED the message. These two cases are the two ends of that:
 * a transport that accepts => reported true; a transport that fails => reported
 * false. The ledger key stays retryable in the failing case either way — only the
 * reported flag must not lie.
 */

const route = await import('../apps/booking-consumer/src/lib/notification-dispatch.ts');

function runtime() {
  return {
    rpc: async (name: string) => {
      if (name === 'claim_due_line_notifications') return { data: [], error: null };
      return { data: true, error: null };
    },
  };
}

async function dispatchWithAlertTransport(transport: { send: (input: unknown) => Promise<{ ok: boolean; status: number }> }) {
  const savedToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const savedSecret = process.env.NOTIFICATION_DISPATCH_SECRET;
  const savedOps = process.env.OPS_ALERT_EMAIL;
  process.env.NOTIFICATION_DISPATCH_SECRET = 'dispatch-secret';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'central-token';
  process.env.OPS_ALERT_EMAIL = 'ops@example.com';
  try {
    const req = new Request('https://bk01.test/dispatch', {
      method: 'POST',
      headers: { authorization: 'Bearer dispatch-secret' },
      body: '',
    });
    // The quota read FAILS (ok:false) => status 'unavailable' => the alert path runs.
    const quotaTransport = { getJson: async () => ({ ok: false, status: 503, body: null }) };
    const sink = { claim: async () => ({ claimed: true, delivered: false }) };
    const response = await route.handleNotificationDispatch(
      req,
      async () => runtime(),
      fetch,
      quotaTransport,
      transport,
      async () => 0,
      sink,
    );
    return response.json();
  } finally {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = savedToken;
    process.env.NOTIFICATION_DISPATCH_SECRET = savedSecret;
    process.env.OPS_ALERT_EMAIL = savedOps;
  }
}

test('N1 oaQuotaAlerted is true only after the alert transport accepted the mail', async () => {
  const body = await dispatchWithAlertTransport({ send: async () => ({ ok: true, status: 200 }) });
  assert.equal(body.oaQuotaAlerted, true, 'a provider-accepted alert must be reported as sent');
});

test('N1 oaQuotaAlerted is false when the alert transport rejects the mail', async () => {
  const body = await dispatchWithAlertTransport({ send: async () => ({ ok: false, status: 500 }) });
  assert.equal(body.oaQuotaAlerted, false, 'a rejected alert must not be reported as sent');
});
