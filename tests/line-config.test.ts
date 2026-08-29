import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLineChannelConfig } from '../apps/booking-consumer/src/lib/line-channel-config.ts';

test('uses central OA only for trial/onboarding mode', () => {
  assert.deepEqual(resolveLineChannelConfig({ mode: 'trial', centralSecret: 'secret', centralAccessToken: 'token' }), {
    mode: 'central',
    channelSecret: 'secret',
    accessToken: 'token',
  });
});

test('requires server-side merchant credentials for paid mode', () => {
  assert.deepEqual(resolveLineChannelConfig({ mode: 'paid', merchantSecret: 'shop-secret', merchantAccessToken: 'shop-token' }), {
    mode: 'merchant',
    channelSecret: 'shop-secret',
    accessToken: 'shop-token',
  });
  assert.throws(() => resolveLineChannelConfig({ mode: 'paid' }), /merchant LINE credentials/i);
  assert.throws(() => resolveLineChannelConfig({ mode: 'trial' }), /central LINE credentials/i);
});

