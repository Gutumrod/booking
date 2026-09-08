'use client';

import { ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { isPlausibleReferenceToken } from '@/lib/public-claim';

/**
 * Additive Booking -> Claim entry point for the manage-booking surface.
 *
 * Fail-closed: renders nothing unless Claim is explicitly enabled for the shop
 * AND we hold a usable manage token + slug. Today no live capability source
 * exists, so callers pass `claimEnabled={false}` and this renders null. When the
 * shared-runtime gate opens, manage-booking resolves the real capability + slug
 * and passes them here. Only the customer-held manage token is forwarded to the
 * Claim adapter — never a raw booking id.
 */
export function ClaimEntryPoint({
  claimEnabled,
  shopSlug,
  manageToken,
}: {
  claimEnabled: boolean;
  shopSlug?: string | null;
  manageToken?: string | null;
}) {
  const t = useTranslations('claim');

  if (!claimEnabled) return null;
  if (!shopSlug || !manageToken) return null;
  if (!isPlausibleReferenceToken(manageToken)) return null;

  const href = `/shop/${encodeURIComponent(shopSlug)}/claim?booking=${encodeURIComponent(manageToken)}`;

  return (
    <a
      href={href}
      className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs font-semibold text-slate-200 hover:border-emerald-500/60"
    >
      <ShieldAlert className="h-4 w-4 text-emerald-400" />
      {t('entryPointLabel')}
    </a>
  );
}
