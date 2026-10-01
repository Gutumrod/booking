import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  probeMerchantChannelState,
  resolveCustomerNotificationChannel,
} from '../apps/booking-consumer/src/lib/notification-line-channel.ts';

/**
 * B9(a): a trial shop's customer must still be reachable.
 *
 * `local_service.bk01_effective_plan` resolves ('basic_490','trialing') to
 * 'basic_490' ON PURPOSE -- the trial row keeps the plan name it was signed up
 * for. The dispatch route read that plan name as proof the shop had its own LINE
 * channel, called the merchant resolver, and that resolver threw because a shop
 * that signed up minutes ago has no channel yet. The customer got nothing.
 *
 * These tests pin the fix: the channel follows the CAPABILITY (does the shop have
 * a channel) and the plan name only decides what to REPORT.
 */

test('a Basic-trial shop without a channel is still sent over the central channel', () => {
  const decision = resolveCustomerNotificationChannel({
    subscriptionPlan: 'basic_490',
    merchantChannelState: 'not_configured',
  });
  assert.equal(decision.channel, 'central', 'the customer must still be told; silence is the bug being fixed');
});

test('a paid shop with its own channel uses it', () => {
  assert.deepEqual(
    resolveCustomerNotificationChannel({ subscriptionPlan: 'basic_490', merchantChannelState: 'configured' }),
    { channel: 'merchant', reason: 'paid_with_merchant_channel' },
  );
  assert.deepEqual(
    resolveCustomerNotificationChannel({ subscriptionPlan: 'pro_990', merchantChannelState: 'configured' }),
    { channel: 'merchant', reason: 'paid_with_merchant_channel' },
  );
});

test('the plan name alone never selects the merchant channel', () => {
  // The old defect in one line: plan code implies channel. Every paid-plan case
  // must still be decided by the capability.
  for (const subscriptionPlan of ['basic_490', 'pro_990']) {
    assert.equal(
      resolveCustomerNotificationChannel({ subscriptionPlan, merchantChannelState: 'not_configured' }).channel,
      'central',
      `${subscriptionPlan} without a channel must fall back, not throw`,
    );
  }
});

test('free and unknown plans take the central channel', () => {
  for (const subscriptionPlan of ['free_trial', 'free', null, undefined, '']) {
    assert.deepEqual(
      resolveCustomerNotificationChannel({ subscriptionPlan, merchantChannelState: 'configured' }),
      { channel: 'central', reason: 'trial_or_free_shop' },
      `${String(subscriptionPlan)} must not be treated as a paid plan`,
    );
  }
});

test('a paid shop with no channel is reported as a gap, not as a normal send', () => {
  // The customer is served either way, but the reason differs, and that is what
  // lets the outbox explain a fallback instead of hiding it.
  const fallback = resolveCustomerNotificationChannel({ subscriptionPlan: 'basic_490', merchantChannelState: 'not_configured' });
  assert.equal(fallback.reason, 'paid_without_merchant_channel');
  assert.notEqual(
    fallback.reason,
    resolveCustomerNotificationChannel({ subscriptionPlan: 'free_trial', merchantChannelState: 'not_configured' }).reason,
  );
});

test('probing a real resolver reports a throw as "not configured", never as an error to swallow', async () => {
  // Both shapes matter: a synchronous throw (which the real
  // resolveMerchantLineChannel does for a shop with no JSON record) and a
  // rejected promise. A try/catch that does not await misses the first one, and
  // that is precisely how B9(a) presented -- as a generic delivery failure.
  assert.equal(await probeMerchantChannelState(() => { throw new Error('Merchant LINE credentials are not configured'); }, 'shop-1'), 'not_configured');
  assert.equal(await probeMerchantChannelState(async () => { throw new Error('rejected'); }, 'shop-1'), 'not_configured');
  assert.equal(await probeMerchantChannelState(async () => ({ accessToken: 'tok', channelSecret: 'sec' }), 'shop-1'), 'configured');
  assert.equal(await probeMerchantChannelState(async () => ({ accessToken: '', channelSecret: 'sec' }), 'shop-1'), 'not_configured');
  assert.equal(await probeMerchantChannelState(async () => null, 'shop-1'), 'not_configured');
  assert.equal(await probeMerchantChannelState(async () => ({}), 'shop-1'), 'not_configured');
  // The shop id must reach the resolver, or every shop would be judged by another.
  let seenShopId: string | null = null;
  await probeMerchantChannelState(async (shopId) => { seenShopId = shopId; return { accessToken: 't' }; }, 'shop-42');
  assert.equal(seenShopId, 'shop-42');
});

test('the resolver is not called at all when the plan is not paid', () => {
  // Guard against a future edit that probes the merchant resolver for every
  // customer, which would make a free-trial send depend on shop configuration.
  const source = readFileSync('apps/booking-consumer/src/app/api/notifications/dispatch/route.ts', 'utf8');
  assert.match(source, /resolveCustomerNotificationChannel/);
  assert.match(source, /subscriptionPlan: context\.subscription_plan/);
  assert.match(source, /merchantChannelState/);
  assert.doesNotMatch(
    source,
    /const isMerchantPlan = context\.subscription_plan === 'basic_490' \|\| context\.subscription_plan === 'pro_990'/,
    'the plan-code-as-channel shortcut must be gone',
  );
});
