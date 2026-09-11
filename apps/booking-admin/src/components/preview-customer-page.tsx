'use client';

// "Preview customer page" action shared by every /dashboard route header
// (R4-5 / Codex NEW-F9). The shop slug is loaded once by the dashboard layout
// and provided here, so the action exists on every dashboard tab and ticket
// page at every breakpoint (icon-only with an accessible label on small
// screens). Never gated on readiness, public_booking, payment or R7 truth.

import { createContext, useContext } from 'react';
import { useTranslations } from 'next-intl';
import { Eye } from 'lucide-react';
import { customerPageUrl } from '@/lib/customer-page-url';

const ShopSlugContext = createContext<string | null>(null);

export function ShopSlugProvider({ slug, children }: { slug: string | null; children: React.ReactNode }) {
  return <ShopSlugContext.Provider value={slug}>{children}</ShopSlugContext.Provider>;
}

export function PreviewCustomerPageLink() {
  const t = useTranslations('dashboard');
  const href = customerPageUrl(useContext(ShopSlugContext));
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
