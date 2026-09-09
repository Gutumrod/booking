// Deposit amount + QR gate for the customer booking page (KMO-X3 / brief section 9).
//
// The page must never invent a PromptPay recipient or a deposit amount. The
// amount comes from the server hold response once one exists, otherwise from
// real merchant config (service deposit, then shop default). A QR is shown only
// when there is a real recipient AND a real positive amount.
//
// Pure and framework-free for unit testing from `tests/`.

export interface DepositDisplayInput {
  /** Authoritative once a hold exists. */
  holdDepositAmount?: number | null;
  serviceDepositAmount?: number | null;
  shopDefaultDepositAmount?: number | null;
  /** null when the shop has no verified PromptPay recipient. */
  promptpayNumber: string | null;
}

export interface DepositDisplay {
  /** null => amount not configured; render a placeholder, never a literal. */
  amount: number | null;
  /** false => do not render a QR (fail closed). */
  showQr: boolean;
}

export function resolveDepositDisplay(input: DepositDisplayInput): DepositDisplay {
  const amount =
    input.holdDepositAmount
    ?? input.serviceDepositAmount
    ?? input.shopDefaultDepositAmount
    ?? null;
  const showQr = Boolean(input.promptpayNumber) && amount != null && amount > 0;
  return { amount, showQr };
}
