// Merchant readiness as independent capabilities
// (KMO-03 / brief section 11 / Amendment B1 / Codex R4 review F3).
//
// Derived from data the dashboard already loads; never stored, never blocks the
// "Preview customer page" action.
//
// Payment readiness is policy-aware:
//   - a shop that collects no deposit (require_deposit=false, or no service/shop
//     amount is configured) needs no PromptPay onboarding -> ready;
//   - a shop that can collect a deposit is ready only with a complete PromptPay
//     number AND account-holder name AND a resolvable amount (shop default or a
//     per-service amount).
// `null` is never treated as `0`.
//
// The public-booking-enabled capability is server-owned and not available from
// the current admin source; it is reported as BLOCKED_R7, not guessed.
//
// Pure and framework-free for unit testing from `tests/`.

export type ReadinessKey = 'profile' | 'services' | 'staff' | 'schedule' | 'payment';

export type ReadinessStatus = 'ready' | 'attention' | 'blocked_r7';

export interface ReadinessRow {
  key: ReadinessKey;
  status: ReadinessStatus;
  /** convenience: true only when status === 'ready'. */
  ok: boolean;
}

export interface ReadinessInput {
  shopName: string;
  shopPhone: string;
  promptpayNumber: string;
  promptpayName: string;
  requireDeposit: boolean;
  /** shop-level default; null = not configured. */
  defaultDepositAmount: number | null;
  services: ReadonlyArray<{ isActive: boolean; deposit: number | null }>;
  staff: ReadonlyArray<{ isActive: boolean }>;
  schedules: ReadonlyArray<{ days: ReadonlyArray<{ isWorkingDay: boolean }> }>;
}

/** Whether the shop can actually collect a deposit from any bookable service. */
export function depositIsCollectable(input: ReadinessInput): boolean {
  if (!input.requireDeposit) return false;
  if (input.defaultDepositAmount != null && input.defaultDepositAmount > 0) return true;
  return input.services.some((s) => s.isActive && s.deposit != null && s.deposit > 0);
}

function paymentStatus(input: ReadinessInput): ReadinessStatus {
  if (!depositIsCollectable(input)) return 'ready';
  const hasIdentity = input.promptpayNumber.trim() !== '' && input.promptpayName.trim() !== '';
  return hasIdentity ? 'ready' : 'attention';
}

export function computeReadiness(input: ReadinessInput): ReadinessRow[] {
  const rows: Array<{ key: ReadinessKey; status: ReadinessStatus }> = [
    {
      key: 'profile',
      status: input.shopName.trim() !== '' && input.shopPhone.trim() !== '' ? 'ready' : 'attention',
    },
    { key: 'services', status: input.services.some((s) => s.isActive) ? 'ready' : 'attention' },
    { key: 'staff', status: input.staff.some((s) => s.isActive) ? 'ready' : 'attention' },
    {
      key: 'schedule',
      status: input.schedules.some((sch) => sch.days.some((d) => d.isWorkingDay)) ? 'ready' : 'attention',
    },
    { key: 'payment', status: paymentStatus(input) },
  ];
  return rows.map((r) => ({ ...r, ok: r.status === 'ready' }));
}

/** A no-deposit shop with everything else set is fully ready. */
export function isShopReady(rows: ReadinessRow[]): boolean {
  return rows.every((r) => r.status === 'ready');
}
