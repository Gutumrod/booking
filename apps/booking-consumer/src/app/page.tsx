'use client';

import Link from 'next/link';
import { CalendarCheck, ShieldCheck, QrCode, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LanguageToggle } from '@/components/language-toggle';
import { LegalLinks } from '@/components/legal-document';

export default function Home() {
  const t = useTranslations('landing');

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-6 font-sans">
      <LanguageToggle variant="landing" />
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto border border-emerald-500/40 shadow-xl shadow-emerald-950/50">
          <CalendarCheck className="w-8 h-8" />
        </div>

        <div>
          <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full font-semibold">
            {t('badge')}
          </span>
          <h1 className="text-2xl font-bold text-white mt-3">{t('title')}</h1>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            {t('subtitle')}
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-left space-y-3 text-xs text-slate-300">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{t('featureTime')}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <QrCode className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{t('featureQr')}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{t('featureLine')}</span>
          </div>
        </div>

        <Link
          href="/book/good-cuts-barber"
          className="block w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 py-3.5 rounded-xl font-bold text-sm shadow-lg shadow-emerald-950/50 transition-all"
        >
          {t('demoCta')}
        </Link>

        <LegalLinks className="pt-2 text-[11px]" />
      </div>
    </div>
  );
}
