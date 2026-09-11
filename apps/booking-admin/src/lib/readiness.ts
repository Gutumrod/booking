// Merchant readiness as independent capabilities
// (KMO-03 / brief section 11 / Amendment B1 / Codex R4 review F3).
//
// Derived from data the dashboard already loads; never stored, never blocks the
// "Preview customer page" action.
//
// Payment readiness is policy-aware (Amendment B1, R4 spec R4-5, Codex R2-2):
//   - require_deposit=false -> ready; no PromptPay onboarding needed;
//   - require_deposit=true -> every active service (or, with none, the shop
//     default) must resolve to a configured amount using the server rule
//     "explicit service amount, else shop default". Any unresolvable (NULL)
//     amount -> attention: NULL is "not set", never 0 and never a pass;
//   - all resolved amounts explicitly 0 -> ready (explicit no deposit);
//   - any positive resolved amount -> ready only with a format-valid PromptPay
//     number AND a configured account-holder name.
//
// The public_booking capability (booking enabled and not billing-blocked, R3 §5)
// is server-owned and not available from the current admin source. It is always
// returned as an explicit `blocked_r7` row -- never inferred as ready and never
// omitted -- so isShopReady() cannot claim full readiness until the R7
// get_shop_readiness RPC supplies that truth (Codex R2-3 / NEW-F7).
//
// Pure and framework-free for unit testing from `tests/`.

export type ReadinessKey = 'profile' | 'services' | 'staff' | 'schedule' | 'payment' | 'public_booking';

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

/**
 * PromptPay recipient format contract: 10-digit mobile starting with 0, or a
 * 13-digit ID. Mirrors isValidPromptPayRecipient in
 * apps/booking-consumer/src/lib/payment-instruction.ts (apps are isolated, so
 * the rule is repeated here; keep the two in sync).
 */
export function isValidPromptPayRecipient(recipient: string): boolean {
  const digits = recipient.replace(/\D/g, '');
  return /^0\d{9}$/.test(digits) || /^\d{13}$/.test(digits);
}

function configuredAmount(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function paymentStatus(input: ReadinessInput): ReadinessStatus {
  if (!input.requireDeposit) return 'ready';
  const shopDefault = configuredAmount(input.defaultDepositAmount);
  const active = input.services.filter((s) => s.isActive);
  const amounts = active.length > 0
    ? active.map((s) => (s.deposit != null ? configuredAmount(s.deposit) : shopDefault))
    : [shopDefault];
  if (amounts.some((a) => a === null)) return 'attention';
  if (amounts.every((a) => a === 0)) return 'ready';
  const hasIdentity = isValidPromptPayRecipient(input.promptpayNumber) && input.promptpayName.trim() !== '';
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
    { key: 'public_booking', status: 'blocked_r7' },
  ];
  return rows.map((r) => ({ ...r, ok: r.status === 'ready' }));
}

/** True only when every row is ready -- never while a row is blocked_r7. */
export function isShopReady(rows: ReadinessRow[]): boolean {
  return rows.every((r) => r.status === 'ready');
}

/** True when some row needs merchant action (blocked_r7 is not merchant-fixable). */
export function needsMerchantAttention(rows: ReadinessRow[]): boolean {
  return rows.some((r) => r.status === 'attention');
}
