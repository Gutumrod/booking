/**
 * Per-plan notification entitlements (BK01 brief 25, unit 7 — HOUSE-BK01-PACK-ENTITLE).
 *
 * Owner decision (STATUS-HOUSE A-21, 2026-10-01) fixes what each pack may send:
 *
 *   Free        reminder push, 50 pushes/shop/month, no slip-decision push
 *   Basic/ทดลอง  + customer slip-decision push, shop e-mail on slip,
 *               600 pushes/shop/month
 *   Pro (on hold) + shop e-mail on every new booking, 1,500 pushes/shop/month
 *
 * The 14-day trial carries the BASIC entitlements, through the existing
 * `local_service.bk01_effective_plan` mechanism: a trial resolves to the
 * `basic_490` plan row, it never gets a row of its own. `resolveEffectivePlan`
 * below is a TypeScript mirror of that SQL function, so the app and the database
 * cannot disagree about what a trial is. The mirror is checked against the same
 * boundary cases the SQL is checked against in
 * `tests/bk01-entitlement-boundary.test.ts`.
 *
 * `monthly_push_cap` is a VALUE, not a code constant to be inlined: A-21 says it
 * may be retuned, so nothing else in the app may hard-code 50/600/1500. The
 * column of the same name carries the authoritative number once the unit-7
 * migration lands; this table is the app-side mirror of it.
 *
 * FAIL CLOSED. An unknown plan, or an unknown event, yields `null` and the
 * caller suppresses the send with that reason recorded — a push is never sent on
 * a guess about which pack paid for it.
 *
 * Pure and framework-free so `tests/` can pin it without a database.
 */

/** The plan identities `local_service.bk01_effective_plan` can resolve to. */
export type EffectivePlan = 'free' | 'basic_490' | 'pro_990';

/**
 * The entitlement columns of `local_service.entitlement_plans`, named exactly as
 * the Owner's table names them so the app mirror and the SQL column list cannot
 * drift apart.
 */
export interface PlanNotificationEntitlements {
  customer_reminder_push: boolean;
  customer_slip_decision_push: boolean;
  shop_email_slip: boolean;
  shop_email_booking: boolean;
  monthly_push_cap: number;
}

/** The locked table. Only `services_limit` and the new columns change in unit 7. */
export const PLAN_NOTIFICATION_ENTITLEMENTS: Readonly<Record<EffectivePlan, PlanNotificationEntitlements>> = {
  free: {
    customer_reminder_push: true,
    customer_slip_decision_push: false,
    shop_email_slip: false,
    shop_email_booking: false,
    monthly_push_cap: 50,
  },
  basic_490: {
    customer_reminder_push: true,
    customer_slip_decision_push: true,
    shop_email_slip: true,
    shop_email_booking: false,
    monthly_push_cap: 600,
  },
  pro_990: {
    customer_reminder_push: true,
    customer_slip_decision_push: true,
    shop_email_slip: true,
    shop_email_booking: true,
    monthly_push_cap: 1500,
  },
};

/**
 * The plan a running trial is entitled as. A trial is not a plan of its own:
 * `bk01_effective_plan` resolves ('basic_490','trialing') to 'basic_490' while
 * the period is unexpired, which is what makes this the correct constant.
 */
export const TRIAL_ENTITLEMENT_PLAN: EffectivePlan = 'basic_490';

export const EFFECTIVE_PLANS: readonly EffectivePlan[] = ['free', 'basic_490', 'pro_990'];

export function isEffectivePlan(value: unknown): value is EffectivePlan {
  return typeof value === 'string' && (EFFECTIVE_PLANS as readonly string[]).includes(value);
}

/**
 * The subscription facts the decision needs, as `bk01_effective_plan` reads them.
 * Every field is nullable on purpose: a delivery context that does not carry one
 * is not an error to swallow, it is a fact the caller does not have.
 */
export interface EffectivePlanInput {
  plan: string | null | undefined;
  status: string | null | undefined;
  currentPeriodEnd: string | null | undefined;
  trialEndsAt: string | null | undefined;
  now: Date;
}

/**
 * Mirror of `local_service.bk01_effective_plan(plan, status, current_period_end,
 * trial_ends_at, now)` — the branch order is the SQL's branch order, and the
 * default is `free`, which is the entitlement-minimal plan.
 */
export function resolveEffectivePlan(input: EffectivePlanInput): EffectivePlan {
  const { plan, status } = input;
  if (plan == null || status == null) return 'free';
  if (plan === 'pro_990' && status === 'active') return 'pro_990';
  if (plan === 'basic_490' && (status === 'active' || status === 'past_due')) return 'basic_490';
  if (plan === 'basic_490' && status === 'trialing') {
    const end = input.currentPeriodEnd ?? input.trialEndsAt;
    if (end != null && Date.parse(end) > input.now.getTime()) return 'basic_490';
    return 'free';
  }
  return 'free';
}

/**
 * Entitlements for a plan the caller has identified, or `null` for anything it
 * has not. `null` is the fail-closed answer: the send is suppressed with a
 * recorded reason instead of being allowed on an assumption.
 */
export function entitlementsForPlan(plan: unknown): PlanNotificationEntitlements | null {
  return isEffectivePlan(plan) ? PLAN_NOTIFICATION_ENTITLEMENTS[plan] : null;
}

/** The entitlement column that governs a customer push event, or null if unknown. */
export function pushEntitlementColumn(eventType: string): keyof PlanNotificationEntitlements | null {
  switch (eventType) {
    case 'reminder_3h':
    // A legacy row created before the move to 3 hours. It is still a reminder the
    // shop's pack paid for, so it uses the same entitlement column. Its text is the
    // same reminder text (it names no lead time), so nothing in the message claims a
    // timing the row was not created under.
    case 'reminder_24h':
      return 'customer_reminder_push';
    case 'deposit_rejected':
    case 'deposit_slip_decision':
      return 'customer_slip_decision_push';
    default:
      return null;
  }
}
