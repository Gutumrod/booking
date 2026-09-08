'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CalendarCheck,
  Package,
  ShieldAlert,
  ChevronRight,
  Phone,
  Loader2,
  Store,
  AlertTriangle,
} from 'lucide-react';

import { getShopBySlug, Shop } from '../../../lib/booking-service';
import {
  resolveShopCapabilities,
  selectPortalCards,
  disabledCapabilities,
  hasAnyCapability,
  type PortalCapability,
} from '../../../lib/public-portal';
import { LanguageToggle } from '@/components/language-toggle';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

const CARD_ICON: Record<PortalCapability, typeof CalendarCheck> = {
  booking: CalendarCheck,
  order: Package,
  claim: ShieldAlert,
};

export default function ShopPortalPage() {
  const t = useTranslations('portal');
  const tc = useTranslations('common');
  const params = useParams();
  const slug = (params?.slug as string) || '';

  const [shop, setShop] = useState<Shop | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setState('loading');
      try {
        const data = await getShopBySlug(slug);
        if (cancelled) return;
        if (!data) {
          setState('not-found');
          return;
        }
        setShop(data);
        setState('ready');
      } catch (error) {
        console.error('Error loading shop portal:', error);
        if (!cancelled) setState('error');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Order and Claim have no live public capability source yet: production
  // resolves them fail-closed. Booking derives from the truthful public signal.
  const capabilities = useMemo(
    () =>
      resolveShopCapabilities({
        isAcceptingOnlineBookings: shop?.is_accepting_online_bookings ?? null,
      }),
    [shop],
  );

  const cards = useMemo(
    () => selectPortalCards(slug, capabilities),
    [slug, capabilities],
  );
  const disabled = useMemo(
    () => disabledCapabilities(capabilities),
    [capabilities],
  );

  const shopPhone = shop?.phone?.trim();
  const shopPhoneHref = shopPhone ? `tel:${shopPhone.replace(/-/g, '')}` : undefined;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between font-sans">
      <LanguageToggle variant="booking" />

      <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-900/80 border-b border-slate-800 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Store className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-white capitalize">
              {shop?.name || slug.replace(/-/g, ' ')}
            </h1>
            <p className="text-[10px] text-emerald-400 font-medium">{t('headerSubtitle')}</p>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto w-full px-4 py-6 flex-1">
        {state === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
            <p className="text-xs text-slate-400">{t('loading')}</p>
          </div>
        )}

        {state === 'not-found' && (
          <StatusCard
            tone="amber"
            icon={<AlertTriangle className="w-7 h-7" />}
            title={t('notFoundTitle')}
            body={t('notFoundBody')}
          />
        )}

        {state === 'error' && (
          <StatusCard
            tone="rose"
            icon={<AlertTriangle className="w-7 h-7" />}
            title={t('errorTitle')}
            body={t('errorBody')}
          />
        )}

        {state === 'ready' && (
          <div className="space-y-5">
            {hasAnyCapability(capabilities) ? (
              <>
                <div>
                  <h2 className="text-lg font-bold text-white">{t('title')}</h2>
                  <p className="text-xs text-slate-400">
                    {t('subtitle', { shopName: shop?.name || slug.replace(/-/g, ' ') })}
                  </p>
                </div>

                <div className="space-y-3">
                  {cards.map((card) => {
                    const Icon = CARD_ICON[card.capability];
                    return (
                      <a
                        key={card.capability}
                        href={card.href}
                        className="flex items-center gap-3 p-4 rounded-2xl border border-slate-800 bg-slate-900/60 hover:border-emerald-500/60 transition-all"
                      >
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white">
                            {t(`card.${card.capability}Title`)}
                          </p>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            {t(`card.${card.capability}Desc`)}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      </a>
                    );
                  })}
                </div>
              </>
            ) : (
              <StatusCard
                tone="amber"
                icon={<Store className="w-7 h-7" />}
                title={t('allDisabledTitle')}
                body={t('allDisabledBody')}
              />
            )}

            {hasAnyCapability(capabilities) && disabled.length > 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
                <p className="text-[11px] font-semibold text-slate-300">
                  {t('unavailableHeading')}
                </p>
                <ul className="text-[11px] text-slate-500 space-y-1">
                  {disabled.map((cap) => (
                    <li key={cap}>
                      •{' '}
                      {cap === 'booking'
                        ? t('unavailableBooking')
                        : cap === 'order'
                          ? t('unavailableOrder')
                          : t('unavailableClaim')}
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-slate-500">{t('unavailableNote')}</p>
              </div>
            )}

            {shopPhoneHref && (
              <a
                href={shopPhoneHref}
                className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 py-3 px-4 rounded-xl font-bold text-xs border border-slate-700 transition-all"
              >
                <Phone className="w-4 h-4 text-emerald-400" />
                {t('callShop')}
                {shopPhone ? ` · ${shopPhone}` : ''}
              </a>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-slate-900 py-3 px-4 text-center text-[11px] text-slate-600">
        {t('footer', { brand: tc('brandName') })}
      </footer>
    </div>
  );
}

function StatusCard({
  tone,
  icon,
  title,
  body,
}: {
  tone: 'amber' | 'rose';
  icon: ReactNode;
  title: string;
  body: string;
}) {
  const border = tone === 'amber' ? 'border-amber-500/40' : 'border-rose-500/40';
  const iconWrap =
    tone === 'amber'
      ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
      : 'bg-rose-500/10 border-rose-500/30 text-rose-400';
  return (
    <div className={`bg-slate-900/90 border ${border} rounded-2xl p-6 text-center space-y-3`}>
      <div
        className={`w-14 h-14 rounded-full border flex items-center justify-center mx-auto ${iconWrap}`}
      >
        {icon}
      </div>
      <h2 className="text-lg font-bold text-white">{title}</h2>
      <p className="text-xs text-slate-400">{body}</p>
    </div>
  );
}
