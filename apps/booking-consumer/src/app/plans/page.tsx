'use client';

import { Check, Minus, CircleDashed, ShieldCheck, MessageCircle, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LanguageToggle } from '@/components/language-toggle';

type Mark = 'included' | 'notIncluded' | 'pending';

function MarkCell({ mark, yes, no, pending }: { mark: Mark; yes: string; no: string; pending: string }) {
  if (mark === 'included') {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-400">
        <Check className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <span className="text-xs font-semibold">{yes}</span>
      </span>
    );
  }
  if (mark === 'notIncluded') {
    return (
      <span className="inline-flex items-center gap-1.5 text-slate-500">
        <Minus className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <span className="text-xs font-semibold">{no}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-amber-400/80">
      <CircleDashed className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <span className="text-xs font-semibold">{pending}</span>
    </span>
  );
}

export default function PlansPage() {
  const t = useTranslations('plans');

  const rows: { label: string; free: Mark; basic: Mark }[] = [
    { label: t('table.rows.bookings'), free: 'included', basic: 'pending' },
    { label: t('table.rows.shops'), free: 'included', basic: 'pending' },
    { label: t('table.rows.services'), free: 'included', basic: 'pending' },
    { label: t('table.rows.onlineBooking'), free: 'included', basic: 'included' },
    { label: t('table.rows.promptpay'), free: 'included', basic: 'included' },
    { label: t('table.rows.customerSelfService'), free: 'included', basic: 'included' },
    { label: t('table.rows.lineNotifications'), free: 'pending', basic: 'pending' },
    { label: t('table.rows.autoSlip'), free: 'notIncluded', basic: 'notIncluded' },
  ];

  const markText = { yes: t('table.yes'), no: t('table.no'), pending: t('table.pending') };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 font-sans px-4 py-16 sm:px-6">
      <LanguageToggle variant="landing" />

      <div className="mx-auto w-full max-w-3xl space-y-10">
        <header className="text-center space-y-3">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{t('title')}</h1>
          <p className="text-sm text-slate-400">{t('subtitle')}</p>
          <p className="text-[11px] text-slate-500">{t('currencyNote')}</p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          <article className="bg-slate-900 border border-emerald-500/40 rounded-2xl p-5 space-y-4">
            <div className="space-y-1">
              <span className="inline-block text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2.5 py-0.5 rounded-full font-semibold">
                {t('free.badge')}
              </span>
              <h2 className="text-lg font-bold text-white">{t('free.name')}</h2>
              <p className="text-2xl font-bold text-white">{t('free.price')}</p>
              <p className="text-[11px] text-slate-400">{t('free.priceNote')}</p>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                {t('card.includedHeading')}
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-200">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden="true" />
                  <span>{t('free.limitBookings')}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden="true" />
                  <span>{t('free.limitShops')}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden="true" />
                  <span>{t('free.limitServices')}</span>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                {t('card.notIncludedHeading')}
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-500">
                <li className="flex items-center gap-2">
                  <Minus className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  <span>{t('card.notIncludedAutoSlip')}</span>
                </li>
              </ul>
            </div>

            <p className="text-[11px] text-slate-400 border-t border-slate-800 pt-3">
              {t('card.availabilityLabel')}: {t('card.availabilityAvailable')}
            </p>
          </article>

          <article className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="space-y-1">
              <span className="inline-block text-[11px] bg-slate-800 text-slate-300 border border-slate-700 px-2.5 py-0.5 rounded-full font-semibold">
                {t('basic.badge')}
              </span>
              <h2 className="text-lg font-bold text-white">{t('basic.name')}</h2>
              <p className="text-2xl font-bold text-white">{t('basic.price')}</p>
              <p className="text-[11px] text-slate-400">{t('basic.priceNote')}</p>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                {t('card.includedHeading')}
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-200">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden="true" />
                  <span>{t('basic.includesFree')}</span>
                </li>
                <li className="flex items-start gap-2 text-amber-400/80">
                  <CircleDashed className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t('basic.limitsPending')}</span>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                {t('card.notIncludedHeading')}
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-500">
                <li className="flex items-center gap-2">
                  <Minus className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  <span>{t('card.notIncludedAutoSlip')}</span>
                </li>
              </ul>
            </div>

            <p className="text-[11px] text-slate-400 border-t border-slate-800 pt-3">
              {t('card.availabilityLabel')}: {t('card.availabilityAvailable')}
            </p>
          </article>
        </section>

        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex items-start gap-3">
          <Lock className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-slate-300">
              {t('pro.name')} — {t('pro.price')}
            </p>
            <p className="text-[11px] text-slate-400">{t('pro.note')}</p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-bold text-white">{t('table.heading')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800">
                  <th scope="col" className="py-2 pr-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    {t('table.featureHeading')}
                  </th>
                  <th scope="col" className="py-2 px-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    {t('table.freeHeading')}
                  </th>
                  <th scope="col" className="py-2 px-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    {t('table.basicHeading')}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-800/60">
                  <th scope="row" className="py-2.5 pr-3 text-xs font-normal text-slate-300">
                    {t('table.rows.bookings')}
                  </th>
                  <td className="py-2.5 px-3 text-xs font-semibold text-slate-100">{t('table.values.bookingsFree')}</td>
                  <td className="py-2.5 px-3">
                    <MarkCell mark="pending" {...markText} />
                  </td>
                </tr>
                <tr className="border-b border-slate-800/60">
                  <th scope="row" className="py-2.5 pr-3 text-xs font-normal text-slate-300">
                    {t('table.rows.shops')}
                  </th>
                  <td className="py-2.5 px-3 text-xs font-semibold text-slate-100">{t('table.values.shopsFree')}</td>
                  <td className="py-2.5 px-3">
                    <MarkCell mark="pending" {...markText} />
                  </td>
                </tr>
                <tr className="border-b border-slate-800/60">
                  <th scope="row" className="py-2.5 pr-3 text-xs font-normal text-slate-300">
                    {t('table.rows.services')}
                  </th>
                  <td className="py-2.5 px-3 text-xs font-semibold text-slate-100">{t('table.values.servicesFree')}</td>
                  <td className="py-2.5 px-3">
                    <MarkCell mark="pending" {...markText} />
                  </td>
                </tr>
                {rows.slice(3).map((row) => (
                  <tr key={row.label} className="border-b border-slate-800/60 last:border-0">
                    <th scope="row" className="py-2.5 pr-3 text-xs font-normal text-slate-300">
                      {row.label}
                    </th>
                    <td className="py-2.5 px-3">
                      <MarkCell mark={row.free} {...markText} />
                    </td>
                    <td className="py-2.5 px-3">
                      <MarkCell mark={row.basic} {...markText} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">{t('footnote')}</p>
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden="true" />
            {t('lineCost.heading')}
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">{t('lineCost.body')}</p>
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden="true" />
            {t('enforcement.heading')}
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">{t('enforcement.body')}</p>
        </section>
      </div>
    </div>
  );
}
