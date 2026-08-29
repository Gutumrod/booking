export type MonthlyPlanId = 'basic_490' | 'pro_990';

type MonthlyPlan = {
  priceEnvName: 'STRIPE_PRICE_BASIC' | 'STRIPE_PRICE_PRO';
};

const MONTHLY_PLANS: Readonly<Record<MonthlyPlanId, MonthlyPlan>> = {
  basic_490: { priceEnvName: 'STRIPE_PRICE_BASIC' },
  pro_990: { priceEnvName: 'STRIPE_PRICE_PRO' },
};

export function resolveMonthlyPlan(value: unknown): MonthlyPlan | null {
  return typeof value === 'string' && value in MONTHLY_PLANS
    ? MONTHLY_PLANS[value as MonthlyPlanId]
    : null;
}

export function getPublicPlanPresentation(plan: MonthlyPlanId) {
  return plan === 'basic_490'
    ? { referencePriceThb: 490, priceStatus: 'pilot-reference-not-final' as const, paidBookingLimit: null, staffLimit: 5 }
    : { referencePriceThb: 990, priceStatus: 'pilot-reference-not-final' as const, paidBookingLimit: null, staffLimit: 10 };
}

