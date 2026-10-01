// Shop deposit / cancellation policy — customer-facing read contract (brief 26).
//
// A shop may publish its own deposit and cancellation terms in two languages.
// The text is the SHOP's own content: WSTERA does not review it, and the system
// only carries it to the customer. Two rules follow from that and are the whole
// reason this module exists as a pure function:
//
//   1. The published text is rendered as PLAIN TEXT. It must never be treated as
//      HTML, markdown or a runnable link. Rendering lives in
//      components/shop-deposit-policy.tsx, which passes the string as a React
//      child and never uses dangerouslySetInnerHTML. This module keeps the value
//      a plain string and never builds markup from it.
//   2. The language shown is the customer's own, and a shop that published only
//      one language still gets its terms shown: the other language is used as a
//      fallback before the neutral "the shop has not set terms" message. That
//      message is the ONLY thing this module is allowed to invent, and it is
//      never a substitute for text the shop actually published.
//
// Pure and framework-free for unit testing from `tests/`.

/** Hard limit per language, in characters (PostgreSQL char_length counts code points). */
export const SHOP_DEPOSIT_POLICY_MAX_CHARS = 1500;

export type ShopDepositPolicyLocale = 'th' | 'en';

export type ShopDepositPolicy = {
  th: string | null;
  en: string | null;
};

export type ResolvedShopDepositPolicy =
  /** The shop published terms; `text` is exactly what it published (trimmed). */
  | { kind: 'published'; text: string; locale: ShopDepositPolicyLocale }
  /** The shop published terms in the other language only. */
  | { kind: 'fallback'; text: string; locale: ShopDepositPolicyLocale }
  /** The shop published nothing in either language. */
  | { kind: 'missing' };

const normalize = (value: string | null | undefined): string => (
  typeof value === 'string' ? value.trim() : ''
);

/**
 * Resolve the policy text to show, for one viewer locale.
 *
 * Precedence: the viewer's own language, then the other published language, then
 * `missing`. A blank/whitespace-only value counts as not published — an empty
 * column must never render as an empty policy box.
 */
export function resolveShopDepositPolicy(
  policy: ShopDepositPolicy | null | undefined,
  locale: ShopDepositPolicyLocale,
): ResolvedShopDepositPolicy {
  const own = normalize(policy?.[locale]);
  if (own) return { kind: 'published', text: own, locale };

  const otherLocale: ShopDepositPolicyLocale = locale === 'th' ? 'en' : 'th';
  const other = normalize(policy?.[otherLocale]);
  if (other) return { kind: 'fallback', text: other, locale: otherLocale };

  return { kind: 'missing' };
}
