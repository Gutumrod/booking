'use client';

// "Preview customer page" action shared by every /dashboard route header
// (R4-5 / Codex NEW-F9). The dashboard layout resolves the canonical selected
// shop (lib/shop-selection, NEW-F12) once and provides its id + slug here, so
// the action exists on every dashboard tab and ticket page at every breakpoint
// (icon-only with an accessible label on small screens). Each page passes the
// shop id of the data it loaded; on any mismatch the action is hidden rather
// than pointing at another tenant. Never gated on readiness, public_booking,
// payment or R7 truth.

import { createContext, useContext } from 'react';
import { useTranslations } from 'next-intl';
import { Eye } from 'lucide-react';
import { tenantPreviewUrl, type SelectedShopIdentity } from '@/lib/customer-page-url';

const SelectedShopContext = createContext<SelectedShopIdentity>({ shopId: null, slug: null });

export function ShopSlugProvider({ shopId, slug, children }: SelectedShopIdentity & { children: React.ReactNode }) {
  return <SelectedShopContext.Provider value={{ shopId, slug }}>{children}</SelectedShopContext.Provider>;
}

/** activeShopId: shop id of the data this page loaded ('' / undefined while loading). */
export function PreviewCustomerPageLink({ activeShopId }: { activeShopId?: string | null }) {
  const t = useTranslations('dashboard');
  const href = tenantPreviewUrl(useContext(SelectedShopContext), activeShopId);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={t('previewCustomerPage')}
      title={t('previewCustomerPage')}
      className="flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-slate-700 sm:px-3"
    >
      <Eye className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{t('previewCustomerPage')}</span>
    </a>
  );
}
