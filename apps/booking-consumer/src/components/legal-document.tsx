'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Scale } from 'lucide-react';
import { useMessages, useTranslations } from 'next-intl';
import { LanguageToggle } from '@/components/language-toggle';

export type LegalDocumentKey = 'terms' | 'privacy';

// Section order is declared here rather than taken from object iteration order,
// so a section can never silently disappear from a rendered page.
export const LEGAL_SECTION_ORDER: Record<LegalDocumentKey, readonly string[]> = {
  terms: [
    'whoWeAre',
    'acceptance',
    'theService',
    'merchantRelationship',
    'accounts',
    'bookingAndDeposits',
    'subscriptionAndBilling',
    'cancellationPolicy',
    'availability',
    'acceptableUse',
    'intellectualProperty',
    'liability',
    'governingLaw',
    'contact',
  ],
  privacy: [
    'controllerAndRoles',
    'whatWeHold',
    'purposes',
    'lawfulBasis',
    'cookies',
    'subprocessors',
    'crossBorder',
    'retention',
    'dataSubjectRights',
    'security',
    'breach',
    'age',
    'changes',
    'contact',
  ],
};

type LegalSection = { h: string; b: string };

type LegalMessages = {
  legal: {
    meta: Record<string, string>;
    terms: { title: string; subtitle: string; intro: string; sections: Record<string, LegalSection> };
    privacy: { title: string; subtitle: string; intro: string; sections: Record<string, LegalSection> };
  };
};

function SectionBody({ body }: { body: string }) {
  const blocks: { kind: 'p' | 'li'; text: string }[] = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => (line.startsWith('- ') ? { kind: 'li' as const, text: line.slice(2) } : { kind: 'p' as const, text: line }));

  return (
    <div className="space-y-2">
      {blocks.map((block, index) =>
        block.kind === 'li' ? (
          <div key={index} className="flex gap-2 text-xs leading-relaxed text-slate-300">
            <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-500" />
            <span>{block.text}</span>
          </div>
        ) : (
          <p key={index} className="text-xs leading-relaxed text-slate-300">
            {block.text}
          </p>
        ),
      )}
    </div>
  );
}

export function LegalDraftNotice({ documentTitle }: { documentTitle?: string }) {
  const t = useTranslations('legal.meta');
  return (
    <section
      role="note"
      aria-label={t('draftBadge')}
      className="rounded-2xl border-2 border-amber-500/70 bg-amber-500/10 p-4 text-left"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-400" />
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-amber-300">{t('draftBadge')}</span>
      </div>
      <h2 className="mt-2 text-sm font-bold text-amber-100">
        {documentTitle ? t('draftTitle', { document: documentTitle }) : t('draftBadge')}
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed text-amber-100/90">{t('draftBody')}</p>
      <p className="mt-2 border-t border-amber-500/40 pt-2 text-[11px] font-semibold text-amber-200">{t('draftFooter')}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-amber-100/80">{t('ownerInputLegend')}</p>
      <p className="mt-1.5 text-[11px] font-mono text-amber-200/90">
        {t('lastUpdatedLabel')} {t('lastUpdatedValue')}
      </p>
    </section>
  );
}

export function LegalDocument({ documentKey }: { documentKey: LegalDocumentKey }) {
  const t = useTranslations('legal');
  const messages = useMessages() as unknown as LegalMessages;
  const doc = messages.legal[documentKey];
  const sectionKeys = LEGAL_SECTION_ORDER[documentKey];

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100">
      <LanguageToggle variant="booking" />
      <main className="mx-auto max-w-2xl space-y-5 px-4 py-16">
        <div className="flex items-center gap-2 text-emerald-400">
          <Scale className="h-5 w-5" />
          <span className="text-[11px] font-bold uppercase tracking-wide">{t('meta.navLabel')}</span>
        </div>

        <header>
          <h1 className="text-2xl font-bold text-white">{doc.title}</h1>
          <p className="text-xs font-semibold text-amber-300">{doc.subtitle}</p>
        </header>

        <LegalDraftNotice documentTitle={doc.title} />

        <p className="text-xs leading-relaxed text-slate-300">{doc.intro}</p>

        <div className="space-y-4">
          {sectionKeys.map((key) => {
            const section = doc.sections[key];
            if (!section) return null;
            return (
              <section key={key} className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <h2 className="text-sm font-bold text-white">{section.h}</h2>
                <SectionBody body={section.b} />
              </section>
            );
          })}
        </div>

        <LegalDraftNotice documentTitle={doc.title} />

        <nav className="flex flex-col gap-2 border-t border-slate-800 pt-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <Link href={t('meta.termsRoute')} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-semibold text-slate-200 hover:border-emerald-500/60">
              {t('meta.termsNavLabel')}
            </Link>
            <Link href={t('meta.privacyRoute')} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-semibold text-slate-200 hover:border-emerald-500/60">
              {t('meta.privacyNavLabel')}
            </Link>
          </div>
          <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-400 hover:text-emerald-300">
            <ArrowLeft className="h-4 w-4" />
            {t('meta.back')}
          </Link>
        </nav>
      </main>
    </div>
  );
}

export function LegalLinks({ className }: { className?: string }) {
  const t = useTranslations('legal.meta');
  return (
    <nav aria-label={t('navLabel')} className={className}>
      <Link href={t('termsRoute')} className="font-semibold text-slate-300 underline underline-offset-2 hover:text-emerald-300">
        {t('termsNavLabel')}
      </Link>
      <span className="mx-2 text-slate-600">•</span>
      <Link href={t('privacyRoute')} className="font-semibold text-slate-300 underline underline-offset-2 hover:text-emerald-300">
        {t('privacyNavLabel')}
      </Link>
    </nav>
  );
}
