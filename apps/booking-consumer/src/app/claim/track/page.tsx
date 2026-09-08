'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PackageSearch, Loader2, AlertTriangle } from 'lucide-react';

import {
  isPlausibleReferenceToken,
  productionClaimAdapter,
  type ClaimUnavailable,
  type PublicClaimTracking,
} from '../../../lib/public-claim';
import { LanguageToggle } from '@/components/language-toggle';

type TrackState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'found'; data: PublicClaimTracking }
  | { phase: 'error'; code: ClaimUnavailable['code'] };

function TrackForm() {
  const t = useTranslations('claim');
  const tc = useTranslations('common');
  const search = useSearchParams();
  const [token, setToken] = useState(search.get('token') ?? '');
  const [state, setState] = useState<TrackState>({ phase: 'idle' });

  async function check(event: FormEvent) {
    event.preventDefault();
    if (!isPlausibleReferenceToken(token)) {
      setState({ phase: 'error', code: 'INVALID_REFERENCE' });
      return;
    }
    setState({ phase: 'checking' });
    const res = await productionClaimAdapter.getPublicClaimTracking({ token: token.trim() });
    if (res.ok) {
      setState({ phase: 'found', data: res });
    } else {
      setState({ phase: 'error', code: res.code });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">{t('track.title')}</h2>
        <p className="text-xs text-slate-400">{t('track.subtitle')}</p>
      </div>

      <form onSubmit={check} className="space-y-3">
        <label className="text-xs text-slate-300 block">{t('track.tokenLabel')}</label>
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t('track.tokenPlaceholder')}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={state.phase === 'checking'}
          className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
        >
          {state.phase === 'checking' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('track.checking')}
            </>
          ) : (
            <>
              <PackageSearch className="w-4 h-4" />
              {t('track.submit')}
            </>
          )}
        </button>
      </form>

      {state.phase === 'error' && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            {state.code === 'INVALID_REFERENCE'
              ? t('track.invalidToken')
              : state.code === 'CLAIM_RUNTIME_NOT_ENABLED'
                ? t('track.unavailableBody')
                : t('track.notFound')}
          </span>
        </div>
      )}

      {state.phase === 'found' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-xs space-y-1.5 text-slate-300">
          <p>
            {t('track.refLabel')}{' '}
            <span className="font-mono text-white font-bold">{state.data.publicRef}</span>
          </p>
          <p>
            {t('track.statusLabel')}{' '}
            <span className="font-semibold text-emerald-400">
              {t(`track.status.${state.data.status}`)}
            </span>
          </p>
          <p>
            {t('track.submittedLabel')}{' '}
            <span className="text-white">{state.data.submittedAt}</span>
          </p>
          <p>
            {t('track.updatedLabel')}{' '}
            <span className="text-white">{state.data.updatedAt}</span>
          </p>
          {state.data.merchantMessage && (
            <p className="pt-1 text-slate-400">{state.data.merchantMessage}</p>
          )}
        </div>
      )}

      <p className="text-center text-[11px] text-slate-600">
        {t('footer', { brand: tc('brandName') })}
      </p>
    </div>
  );
}

export default function ClaimTrackPage() {
  const t = useTranslations('claim');
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <LanguageToggle variant="booking" />
      <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-900/80 border-b border-slate-800 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <PackageSearch className="w-4 h-4" />
          </div>
          <p className="text-sm font-semibold tracking-wide text-white">{t('track.title')}</p>
        </div>
      </header>
      <main className="max-w-md mx-auto w-full px-4 py-6">
        <Suspense
          fallback={
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
            </div>
          }
        >
          <TrackForm />
        </Suspense>
      </main>
    </div>
  );
}
