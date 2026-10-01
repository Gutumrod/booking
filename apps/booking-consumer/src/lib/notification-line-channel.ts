/**
 * Which LINE channel carries a CUSTOMER notification (BK01 brief 23, part B9(a)).
 *
 * The route used to pick the channel from the plan code alone:
 *
 *     const isMerchantPlan = plan === 'basic_490' || plan === 'pro_990';
 *
 * A shop on a Basic trial has exactly that plan code (`local_service.
 * bk01_effective_plan` resolves `basic_490` + `trialing` to `basic_490` on
 * purpose), but it has no merchant LINE channel yet -- a shop cannot configure
 * one before it has customers. `resolveMerchantLineChannel` then throws
 * "Merchant LINE credentials are not configured", the catch records a generic
 * failure, and the customer is never told anything. That is the defect.
 *
 * So the decision is made from a CAPABILITY, not from a plan name: the merchant
 * channel is used only when the shop actually has one. Everything else takes the
 * central channel, which is what `mode: 'trial'` in `resolveLineChannelConfig`
 * was always for.
 *
 * The plan code still matters, and it is reported: a paid shop with no channel
 * is a configuration gap its owner must fix, and the reason below is what lets
 * the outbox say which of the two situations it hit instead of one vague message.
 */

export type MerchantChannelState = 'configured' | 'not_configured';
export type CustomerChannel = 'merchant' | 'central';

export const MERCHANT_PLAN_CODES: readonly string[] = ['basic_490', 'pro_990'];

export type CustomerChannelReason =
  /** Paid shop with its own channel: the customer is reached through the shop's OA. */
  | 'paid_with_merchant_channel'
  /** A trial (or free) shop: the central OA is the designed path, per `mode: 'trial'`. */
  | 'trial_or_free_shop'
  /** Paid shop with no channel configured yet -- a real gap the shop must close. */
  | 'paid_without_merchant_channel';

export interface CustomerChannelDecision {
  channel: CustomerChannel;
  reason: CustomerChannelReason;
}

export function resolveCustomerNotificationChannel(input: {
  subscriptionPlan: string | null | undefined;
  merchantChannelState: MerchantChannelState;
}): CustomerChannelDecision {
  const plan = input.subscriptionPlan ?? null;
  const isPaidPlanCode = plan !== null && MERCHANT_PLAN_CODES.includes(plan);

  if (!isPaidPlanCode) return { channel: 'central', reason: 'trial_or_free_shop' };
  if (input.merchantChannelState === 'configured') {
    return { channel: 'merchant', reason: 'paid_with_merchant_channel' };
  }
  // Still central: a customer of a shop that has not set up its own OA is far
  // better served by the central channel than by silence. The reason is carried
  // separately so the operator can see it was a fallback, not a normal send.
  return { channel: 'central', reason: 'paid_without_merchant_channel' };
}

/**
 * Whether a merchant channel is present for this shop. `resolveMerchantLineChannel`
 * throws when the shop has no record in `LINE_MERCHANT_CHANNELS_JSON` or the
 * record is incomplete; that throw is the answer "not configured", not a failure
 * to be swallowed into a generic message.
 *
 * Async-safe on purpose: the resolver may be an `async` function that rejects, or
 * a plain function that throws before returning. Both must read as
 * `not_configured`. A `try/catch` around a non-awaited call is not enough -- a
 * synchronous throw escapes it and would surface as a delivery failure, which is
 * exactly the B9(a) symptom this helper exists to remove.
 */
export async function probeMerchantChannelState(
  resolve: (shopId: string) => unknown,
  shopId: string,
): Promise<MerchantChannelState> {
  try {
    const resolved = await resolve(shopId);
    if (!resolved || typeof resolved !== 'object') return 'not_configured';
    const token = (resolved as { accessToken?: unknown }).accessToken;
    return typeof token === 'string' && token.length > 0 ? 'configured' : 'not_configured';
  } catch {
    return 'not_configured';
  }
}
