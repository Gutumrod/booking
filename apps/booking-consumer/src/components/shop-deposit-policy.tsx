'use client';

// The shop's own deposit / cancellation policy, shown to the customer BEFORE the
// slip upload and the deposit confirmation (brief 26, section 2).
//
// SECURITY CONTRACT — three properties, all of them structural, not stylistic:
//
//   1. PLAIN TEXT ONLY. The merchant's string is passed to React as a child
//      (`{text}`), which React escapes. There is no `dangerouslySetInnerHTML`,
//      no markdown renderer and no HTML sanitizer to misconfigure anywhere in
//      this file, so a `<script>`, `<img onerror>` or `javascript:` payload in
//      the column can only ever appear as visible characters.
//   2. NO EXECUTABLE LINK IS BUILT FROM SHOP TEXT. The only navigation elements
//      this block can render are the ones the app itself owns (the legal links
//      in the footer); no href is ever derived from the policy value.
//   3. NARROW SCREENS: the text wraps inside its own column (`min-w-0` on the
//      flex/grid ancestors, `break-words` + `overflow-wrap: anywhere` on the
//      text), so a single 1500-character unbroken token cannot push the booking
//      page wider than the 375px viewport.

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FileText, AlertTriangle } from 'lucide-react';
import { LegalLinks } from '@/components/legal-document';
import {
  resolveShopDepositPolicy,
  type ShopDepositPolicy,
  type ShopDepositPolicyLocale,
} from '@/lib/shop-deposit-policy';

/** Map the app locale onto the two policy columns; anything unknown reads Thai first. */
export function toShopDepositPolicyLocale(locale: string): ShopDepositPolicyLocale {
  return locale === 'en' ? 'en' : 'th';
}

export function ShopDepositPolicyNotice({ policy }: { policy: ShopDepositPolicy | null }) {
  const t = useTranslations('booking');
  const locale = toShopDepositPolicyLocale(useLocale());
  const resolved = resolveShopDepositPolicy(policy, locale);

  if (resolved.kind === 'missing') {
    return (
      <div
        data-testid="shop-deposit-policy"
        data-policy-state="missing"
        role="note"
        className="flex min-w-0 items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
        <p
          data-testid="shop-deposit-policy-text"
          className="min-w-0 text-xs leading-relaxed text-amber-200 [overflow-wrap:anywhere] break-words"
        >
          {t('policy.notSet')}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="shop-deposit-policy"
      data-policy-state={resolved.kind}
      data-policy-locale={resolved.locale}
      className="min-w-0 space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3"
    >
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 flex-shrink-0 text-emerald-400" />
        <h3 className="min-w-0 text-xs font-bold text-white">{t('policy.shopTitle')}</h3>
      </div>

      {resolved.kind === 'fallback' && (
        <p
          data-testid="shop-deposit-policy-fallback"
          className="min-w-0 text-[11px] text-slate-400 [overflow-wrap:anywhere] break-words"
        >
          {t('policy.fallbackNote', {
            language: resolved.locale === 'th' ? t('policy.languageNameTh') : t('policy.languageNameEn'),
          })}
        </p>
      )}

      {/* Plain text. `whitespace-pre-wrap` keeps the merchant's own line breaks
          without ever treating the content as markup. */}
      <p
        data-testid="shop-deposit-policy-text"
        className="min-w-0 whitespace-pre-wrap text-xs leading-relaxed text-slate-300 [overflow-wrap:anywhere] break-words"
      >
        {resolved.text}
      </p>

      <p className="min-w-0 text-[11px] text-slate-500 [overflow-wrap:anywhere] break-words">
        {t('policy.shopOwnedNote')}
      </p>

      {/* Link to WSTERA's own legal text — the app's existing documents. This is
          a link only: no policy wording of WSTERA's is written here (brief 26
          section 4 excludes putting the central legal text into the app). */}
      <div className="min-w-0 border-t border-slate-800 pt-2 text-[11px] text-slate-500">
        <span className="[overflow-wrap:anywhere] break-words">{t('policy.legalLinkNote')} </span>
        <LegalLinks className="inline" />
      </div>
    </div>
  );
}
