// Post-hold payment instruction for the customer booking page
// (KMO-X3 / brief section 9 / Amendment B1, and Codex R4 review F1-F2).
//
// A deposit payment instruction may be shown ONLY when the full tuple is
// verified:
//   - a configured PromptPay recipient number,
//   - a configured non-empty account-holder name -- NEVER derived from the shop
//     name or any fallback,
//   - a server-authoritative deposit amount that is finite and strictly positive
//     (the `holdResult.deposit_amount`; pre-hold values are never authoritative).
//
// If any part is missing the caller must render the payment-not-configured
// state and render NONE of: QR, amount, account identity, recipient copy, QR
// download, slip picker or submit button. There is no `?? 0` anywhere on this
// path.
//
// Pure and framework-free for unit testing from `tests/`.

export interface PaymentInstructionInput {
  promptpayNumber: string | null | undefined;
  /** shop.promptpay_name only -- do not pass a derived name. */
  promptpayName: string | null | undefined;
  /** holdResult.deposit_amount -- the server-authoritative amount, not a pre-hold value. */
  holdDepositAmount: number | null | undefined;
}

// Discriminated union: `ok: true` narrows number/name/amount to non-null, so
// callers cannot render a payment control without a complete tuple.
export type PaymentInstruction =
  | { ok: true; number: string; name: string; amount: number }
  | { ok: false; number: string | null; name: string | null; amount: number | null };

function cleanString(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function resolvePaymentInstruction(input: PaymentInstructionInput): PaymentInstruction {
  const number = cleanString(input.promptpayNumber);
  const name = cleanString(input.promptpayName);
  const amount =
    typeof input.holdDepositAmount === 'number'
    && Number.isFinite(input.holdDepositAmount)
    && input.holdDepositAmount > 0
      ? input.holdDepositAmount
      : null;
  if (number !== null && name !== null && amount !== null) {
    return { ok: true, number, name, amount };
  }
  return { ok: false, number, name, amount };
}

// --- pre-hold display (step 1 service card) ---
//
// Before a hold exists the only amount the consumer may show is the explicit
// per-service deposit. `null` (unset) and `0` (explicit no deposit) are
// distinct and neither is derived from a shop default.

export function preHoldServiceDeposit(serviceDepositAmount: number | null | undefined): number | null {
  return typeof serviceDepositAmount === 'number' && Number.isFinite(serviceDepositAmount)
    ? serviceDepositAmount
    : null;
}
