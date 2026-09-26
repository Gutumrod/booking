/**
 * BK01 plan contract.
 *
 * Single source of truth for plan identity, approved prices and approved
 * limits. The numbers below are the Owner's decision of 2026-09-26 recorded in
 * `docs/04_PRICING_ENTITLEMENTS.md` (source brief: Addendum A, item 1 — "A-2"):
 *
 *   Free  = forever, 50 bookings per month, 1 shop, 3 services
 *   Basic = 390 THB / month or 11 USD / month (purchasable)
 *   Pro   = exists in the product, NOT purchasable and never presented as
 *           saleable until the Owner approves a price and the auto-slip
 *           capability is real
 *
 * The database still stores the legacy plan identifiers (`free_trial`,
 * `basic_490`, `pro_990`) in `local_service.subscriptions.plan` and in
 * `local_service.shops.requested_plan`; renaming them needs a SQL migration,
 * which this work unit does not apply. The identifier is therefore kept stable
 * and is deliberately NOT used as a price display anywhere.
 *
 * Unknowns are left as `null` on purpose. Nothing here may invent a price, an
 * allowance or an entitlement the Owner has not approved (LOCKED rule L-07).
 */

/** Plan identifiers as stored by the database. Fixed by a CHECK constraint. */
export type SubscriptionPlanId = 'free_trial' | 'basic_490' | 'pro_990';

/** Plans a customer can actually start through Stripe Checkout. */
export type PurchasablePlanId = 'basic_490';

export type PlanLimitMetric = 'bookings_per_month' | 'shops' | 'services';

/** Stable error codes. These mirror the codes raised by the server-side SQL. */
export type PlanLimitCode = 'BOOKING_QUOTA_EXCEEDED' | 'SHOP_LIMIT_EXCEEDED' | 'SERVICE_LIMIT_EXCEEDED';

export interface PlanLimits {
  /** `null` = no customer-facing booking wall (fair-use protected server-side). */
  bookingsPerMonth: number | null;
  shops: number | null;
  services: number | null;
}

export interface PlanDefinition {
  planId: SubscriptionPlanId;
  /** Owner-approved monthly price in THB, or null when no price is approved. */
  priceThb: number | null;
  /** Owner-approved monthly price in USD, or null when no price is approved. */
  priceUsd: number | null;
  /** Whether the plan may be offered for purchase at all. */
  isPurchasable: boolean;
  limits: PlanLimits;
  /** Stripe price env var, only for purchasable plans. */
  priceEnvName: 'STRIPE_PRICE_BASIC' | null;
}

/** Approved numeric values, exported so tests and UI read the same constants. */
export const FREE_PLAN_BOOKINGS_PER_MONTH = 50;
export const FREE_PLAN_SHOPS = 1;
export const FREE_PLAN_SERVICES = 3;
export const BASIC_PLAN_PRICE_THB = 390;
export const BASIC_PLAN_PRICE_USD = 11;

/** Reference for every approved number: Owner decision recorded 2026-09-26. */
export const PLAN_PRICE_STATUS = 'owner-approved-2026-09-26' as const;

const PLAN_DEFINITIONS: Readonly<Record<SubscriptionPlanId, PlanDefinition>> = {
  free_trial: {
    planId: 'free_trial',
    priceThb: 0,
    priceUsd: 0,
    isPurchasable: false,
    limits: {
      bookingsPerMonth: FREE_PLAN_BOOKINGS_PER_MONTH,
      shops: FREE_PLAN_SHOPS,
      services: FREE_PLAN_SERVICES,
    },
    priceEnvName: null,
  },
  basic_490: {
    planId: 'basic_490',
    priceThb: BASIC_PLAN_PRICE_THB,
    priceUsd: BASIC_PLAN_PRICE_USD,
    isPurchasable: true,
    limits: {
      // Paid booking capacity is not a customer-facing wall (PD-002).
      bookingsPerMonth: null,
      shops: null,
      services: null,
    },
    priceEnvName: 'STRIPE_PRICE_BASIC',
  },
  pro_990: {
    planId: 'pro_990',
    // The Owner has approved no Pro price. Do not infer ฿990 from the legacy
    // identifier: it is not a saleable price and must never be displayed.
    priceThb: null,
    priceUsd: null,
    isPurchasable: false,
    limits: {
      bookingsPerMonth: null,
      shops: null,
      services: null,
    },
    priceEnvName: null,
  },
};

export function getPlanDefinition(plan: SubscriptionPlanId): PlanDefinition {
  return PLAN_DEFINITIONS[plan];
}

/**
 * Internal lookup that tolerates a plan identifier missing from the map. The
 * database CHECK constraint keeps `plan` inside `SubscriptionPlanId`, but if a
 * value ever slips through, read-only callers must fail closed (treated as a
 * blocked limit) instead of throwing a property-of-undefined error.
 */
function definitionFor(plan: SubscriptionPlanId): PlanDefinition {
  return PLAN_DEFINITIONS[plan] ?? PLAN_DEFINITIONS.pro_990;
}

export function isSubscriptionPlanId(value: unknown): value is SubscriptionPlanId {
  return typeof value === 'string' && value in PLAN_DEFINITIONS;
}

/**
 * Resolve a plan that a checkout request may buy. Returns null for free, for
 * Pro (not saleable) and for anything unknown, so the checkout route cannot be
 * used to buy a plan the Owner has not put on sale.
 */
export function resolveMonthlyPlan(value: unknown): { planId: PurchasablePlanId; priceEnvName: 'STRIPE_PRICE_BASIC' } | null {
  if (!isSubscriptionPlanId(value)) return null;
  const definition = PLAN_DEFINITIONS[value];
  if (!definition.isPurchasable || definition.priceEnvName === null) return null;
  return { planId: 'basic_490', priceEnvName: 'STRIPE_PRICE_BASIC' };
}

/** Customer-facing facts for a plan. `null` values mean "no approved value". */
export function getPlanPresentation(plan: SubscriptionPlanId) {
  const definition = definitionFor(plan);
  return {
    planId: definition.planId,
    priceThb: definition.priceThb,
    priceUsd: definition.priceUsd,
    priceStatus: PLAN_PRICE_STATUS,
    isPurchasable: definition.isPurchasable,
    bookingsPerMonth: definition.limits.bookingsPerMonth,
    shops: definition.limits.shops,
    services: definition.limits.services,
  };
}

export interface PlanLimitDecision {
  planId: SubscriptionPlanId;
  metric: PlanLimitMetric;
  /** Approved limit, or null when the metric is not a customer-facing wall. */
  limit: number | null;
  /** Count already in use before the attempted addition. */
  usage: number;
  allowed: boolean;
  /** Populated only when `allowed` is false. */
  code: PlanLimitCode | null;
}

const LIMIT_CODES: Record<PlanLimitMetric, PlanLimitCode> = {
  bookings_per_month: 'BOOKING_QUOTA_EXCEEDED',
  shops: 'SHOP_LIMIT_EXCEEDED',
  services: 'SERVICE_LIMIT_EXCEEDED',
};

/**
 * The public metric names stay snake_case because they mirror the SQL error
 * payloads; the `PlanLimits` object uses camelCase property names. This is the
 * only place that translates between the two.
 */
const LIMIT_KEYS: Record<PlanLimitMetric, keyof PlanLimits> = {
  bookings_per_month: 'bookingsPerMonth',
  shops: 'shops',
  services: 'services',
};

/**
 * Pure mirror of the entitlement gate: `usage` is the count already in use, so
 * an addition is allowed only while `usage < limit`. A free shop at 50 bookings
 * is blocked on the 51st; at 3 services it is blocked on the 4th. A `null`
 * limit is never a wall.
 *
 * This is NOT enforcement on its own (LOCKED rule L-11): the authoritative gate
 * stays server-side. It exists so the boundary is reviewable and testable
 * without a database, and it must stay in sync with the SQL described in
 * `docs/house-swarm-1/WUA1-PLAN-CODE.md`.
 */
export function evaluatePlanLimit(
  plan: SubscriptionPlanId,
  metric: PlanLimitMetric,
  usage: number,
): PlanLimitDecision {
  const limit = definitionFor(plan).limits[LIMIT_KEYS[metric]];
  const safeUsage = Number.isFinite(usage) && usage > 0 ? Math.floor(usage) : 0;
  const allowed = limit === null || safeUsage < limit;
  return {
    planId: plan,
    metric,
    limit,
    usage: safeUsage,
    allowed,
    code: allowed ? null : LIMIT_CODES[metric],
  };
}
