// Shop deposit / cancellation policy — merchant-side contract (brief 26).
//
// The shop writes its own deposit and cancellation terms, in Thai and English.
// Two facts shape every rule here:
//
//   1. The text is the shop's own content. WSTERA does not review it, and the
//      screen must say so next to the fields, so a merchant never reads the
//      platform's silence as approval.
//   2. The text is published to any visitor who opens the shop's public booking
//      page. It is therefore PUBLIC BY DESIGN: the database column carries no
//      customer or shop-private data, and the same column is never shared with
//      anything personal. That is a database-shape rule (see the SQL spec), but
//      the app-side length/blank contract is fixed here.
//
// The length limit matches what the customer page and the SQL RPC enforce:
// 1500 characters per language, counted the way PostgreSQL `char_length` counts
// (Unicode code points), so a merchant cannot save something the RPC will later
// reject, and the two ends cannot disagree.
//
// Pure and framework-free for unit testing from `tests/`.

/** Hard limit per language, in characters (code points). Mirrors the SQL spec. */
export const SHOP_DEPOSIT_POLICY_MAX_CHARS = 1500;

export type ShopDepositPolicyLocale = 'th' | 'en';

export type ShopDepositPolicyDraft = {
  th: string;
  en: string;
};

export type ShopDepositPolicyFieldError =
  | { kind: 'too_long'; locale: ShopDepositPolicyLocale; length: number };

/**
 * Count characters the way PostgreSQL `char_length` does: code points, so a Thai
 * combining mark or an emoji is one character, not its UTF-16 length.
 */
export function policyCharLength(value: string): number {
  return [...value].length;
}

/** The saved value: surrounding whitespace removed, blank saved as an empty string. */
export function normalizePolicyText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** First field error, or null when the draft may be saved. */
export function validateShopDepositPolicy(
  draft: ShopDepositPolicyDraft,
): ShopDepositPolicyFieldError | null {
  for (const locale of ['th', 'en'] as const) {
    const length = policyCharLength(normalizePolicyText(draft[locale]));
    if (length > SHOP_DEPOSIT_POLICY_MAX_CHARS) return { kind: 'too_long', locale, length };
  }
  return null;
}

/** True when the merchant has published nothing at all in either language. */
export function isShopDepositPolicyEmpty(draft: ShopDepositPolicyDraft): boolean {
  return normalizePolicyText(draft.th) === '' && normalizePolicyText(draft.en) === '';
}

/**
 * What the customer will see, for one viewing language, given the saved values.
 * This is the preview's own resolver: it must agree with the customer page's
 * `resolveShopDepositPolicy` (apps/booking-consumer/src/lib/shop-deposit-policy.ts)
 * — the two apps are isolated, so the rule is stated twice and pinned by a test
 * that reads both files.
 */
export type ShopDepositPolicyPreview =
  | { kind: 'published'; text: string; locale: ShopDepositPolicyLocale }
  | { kind: 'fallback'; text: string; locale: ShopDepositPolicyLocale }
  | { kind: 'empty' };

export function resolveShopDepositPolicyPreview(
  draft: ShopDepositPolicyDraft,
  viewerLocale: ShopDepositPolicyLocale,
): ShopDepositPolicyPreview {
  const own = normalizePolicyText(draft[viewerLocale]);
  if (own) return { kind: 'published', text: own, locale: viewerLocale };

  const otherLocale: ShopDepositPolicyLocale = viewerLocale === 'th' ? 'en' : 'th';
  const other = normalizePolicyText(draft[otherLocale]);
  if (other) return { kind: 'fallback', text: other, locale: otherLocale };

  return { kind: 'empty' };
}
