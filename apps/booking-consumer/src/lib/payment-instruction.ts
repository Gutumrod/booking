// Post-hold payment instruction for the customer booking page
// (KMO-X3 / brief section 9 / Amendment B1, and Codex R4 review F1-F2, R2-1).
//
// A deposit payment instruction may be shown ONLY when the full tuple is
// verified:
//   - a configured PromptPay recipient that passes the PromptPay format
//     contract (10-digit mobile starting with 0, or 13-digit national/tax ID) --
//     a non-empty string is NOT enough,
//   - a configured non-empty account-holder name -- NEVER derived from the shop
//     name or any fallback,
//   - a server-authoritative deposit amount that is finite and strictly positive
//     (the `holdResult.deposit_amount`; pre-hold values are never authoritative),
//   - a PromptPay QR payload that actually encodes from the above.
//
// If any part is missing or invalid the caller must render the
// payment-not-configured state and render NONE of: QR, amount, account
// identity, recipient copy, QR download, slip picker or submit button. There is
// no `?? 0` anywhere on this path.
//
// The PromptPay EMVCo encoder lives in this file (not a sibling module) so the
// recipient format contract has exactly one owner shared by the gate and the QR.
//
// Pure and framework-free for unit testing from `tests/`.

// --- PromptPay EMVCo payload ---

type PromptPayPayloadInput = {
  recipient: string;
  amount: number;
};

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function normalizeRecipient(recipient: string): { tag: '01' | '02'; value: string } | null {
  const digits = recipient.replace(/\D/g, '');
  if (/^0\d{9}$/.test(digits)) {
    return { tag: '01', value: `0066${digits.slice(1)}` };
  }
  if (/^\d{13}$/.test(digits)) {
    return { tag: '02', value: digits };
  }
  return null;
}

/** The PromptPay recipient format contract (mobile or 13-digit ID). */
export function isValidPromptPayRecipient(recipient: string | null | undefined): boolean {
  return typeof recipient === 'string' && normalizeRecipient(recipient) !== null;
}

export function crc16CcittFalse(value: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function createPromptPayPayload({ recipient, amount }: PromptPayPayloadInput): string {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999.99) {
    throw new Error('Invalid PromptPay amount');
  }

  const target = normalizeRecipient(recipient);
  if (!target) throw new Error('Invalid PromptPay recipient');
  const merchantAccount = tlv('00', 'A000000677010111') + tlv(target.tag, target.value);
  const body = [
    tlv('00', '01'),
    tlv('01', '12'),
    tlv('29', merchantAccount),
    tlv('53', '764'),
    tlv('54', amount.toFixed(2)),
    tlv('58', 'TH'),
  ].join('');
  const withCrcTag = `${body}6304`;
  return `${withCrcTag}${crc16CcittFalse(withCrcTag)}`;
}

// --- post-hold instruction gate ---

export interface PaymentInstructionInput {
  promptpayNumber: string | null | undefined;
  /** shop.promptpay_name only -- do not pass a derived name. */
  promptpayName: string | null | undefined;
  /** holdResult.deposit_amount -- the server-authoritative amount, not a pre-hold value. */
  holdDepositAmount: number | null | undefined;
}

// Discriminated union: `ok: true` narrows number/name/amount/payload to
// non-null, so callers cannot render a payment control without a complete,
// valid tuple and an encodable QR.
export type PaymentInstruction =
  | { ok: true; number: string; name: string; amount: number; payload: string }
  | { ok: false; number: string | null; name: string | null; amount: number | null; payload: null };

function cleanString(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Configured recipient passes the format contract AND a configured account name exists. */
export function isPromptPayIdentityComplete(
  promptpayNumber: string | null | undefined,
  promptpayName: string | null | undefined,
): boolean {
  const number = cleanString(promptpayNumber);
  return number !== null && isValidPromptPayRecipient(number) && cleanString(promptpayName) !== null;
}

export function resolvePaymentInstruction(input: PaymentInstructionInput): PaymentInstruction {
  const rawNumber = cleanString(input.promptpayNumber);
  const number = rawNumber !== null && isValidPromptPayRecipient(rawNumber) ? rawNumber : null;
  const name = cleanString(input.promptpayName);
  const amount =
    typeof input.holdDepositAmount === 'number'
    && Number.isFinite(input.holdDepositAmount)
    && input.holdDepositAmount > 0
      ? input.holdDepositAmount
      : null;
  if (number !== null && name !== null && amount !== null) {
    try {
      return { ok: true, number, name, amount, payload: createPromptPayPayload({ recipient: number, amount }) };
    } catch {
      // e.g. amount above the EMVCo field limit: not a payable instruction.
    }
  }
  return { ok: false, number, name, amount, payload: null };
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

// --- pre-hold gate for the selected service (Codex F6 / R2-4) ---
//
// A deposit-required shop blocks a specific service before any hold is created
// when that service carries an explicit positive deposit and the PromptPay
// identity is incomplete or invalid.
//   - require_deposit=false        -> never blocked (no deposit step at all).
//   - explicit 0 on the service    -> never blocked (explicit no deposit).
//   - unset (null) on the service  -> not blocked here: the server resolves it
//     from the shop default, which the consumer must not read or guess. That
//     runtime boundary is BLOCKED_R7 (server PAYMENT_NOT_CONFIGURED); the
//     post-hold `resolvePaymentInstruction` gate stays authoritative meanwhile.

export interface ServicePaymentGateInput {
  /** shop.require_deposit (public contract field). */
  requireDeposit: boolean;
  /** the service's own deposit_amount; null = unset. */
  serviceDepositAmount: number | null | undefined;
  promptpayNumber: string | null | undefined;
  promptpayName: string | null | undefined;
}

export function isServicePaymentBlocked(input: ServicePaymentGateInput): boolean {
  if (!input.requireDeposit) return false;
  const deposit = preHoldServiceDeposit(input.serviceDepositAmount);
  if (deposit === null || deposit <= 0) return false;
  return !isPromptPayIdentityComplete(input.promptpayNumber, input.promptpayName);
}
