'use client';

import { Suspense, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ShieldAlert,
  ChevronLeft,
  Phone,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react';

import { getShopBySlug, Shop } from '../../../../lib/booking-service';
import {
  CLAIM_CATEGORIES,
  isPlausibleReferenceToken,
  productionClaimAdapter,
  type ClaimCategory,
  type ClaimOrigin,
  type ClaimSubmitOk,
  type ClaimUnavailable,
  type PublicClaimInput,
} from '../../../../lib/public-claim';
import { LanguageToggle } from '@/components/language-toggle';

function resolveOrigin(
  bookingToken: string | null,
  orderToken: string | null,
): { origin: ClaimOrigin; invalidReference: boolean } {
  if (bookingToken !== null) {
    return isPlausibleReferenceToken(bookingToken)
      ? { origin: { kind: 'booking', manageToken: bookingToken }, invalidReference: false }
      : { origin: { kind: 'standalone' }, invalidReference: true };
  }
  if (orderToken !== null) {
    return isPlausibleReferenceToken(orderToken)
      ? { origin: { kind: 'order', trackingToken: orderToken }, invalidReference: false }
      : { origin: { kind: 'standalone' }, invalidReference: true };
  }
  return { origin: { kind: 'standalone' }, invalidReference: false };
}

function ClaimForm() {
  const t = useTranslations('claim');
  const tc = useTranslations('common');
  const params = useParams();
  const search = useSearchParams();
  const slug = (params?.slug as string) || '';

  const { origin, invalidReference } = useMemo(
    () => resolveOrigin(search.get('booking'), search.get('order')),
    [search],
  );

  const [shop, setShop] = useState<Shop | null>(null);
  const [shopLoading, setShopLoading] = useState(true);
  const [idempotencyKey] = useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `clm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [contactChannel, setContactChannel] = useState('');
  const [category, setCategory] = useState<ClaimCategory>('product');
  const [related, setRelated] = useState('');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimUnavailable | ClaimSubmitOk | null>(null);

  useEffect(() => {
    let cancelled = false;
    getShopBySlug(slug)
      .then((data) => {
        if (!cancelled) setShop(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setShopLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const shopPhone = shop?.phone?.trim();
  const shopPhoneHref = shopPhone ? `tel:${shopPhone.replace(/-/g, '')}` : undefined;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !phone.trim() || !description.trim()) {
      setValidationError(t('validationRequired'));
      return;
    }
    setValidationError(null);
    setSubmitting(true);
    const input: PublicClaimInput = {
      shopSlug: slug,
      origin,
      customerName: name.trim(),
      customerPhone: phone.trim(),
      contactChannel: contactChannel.trim() || undefined,
      category,
      relatedProductService: related.trim() || undefined,
      description: description.trim(),
      occurredAt: occurredAt || null,
      idempotencyKey,
    };
    try {
      const res = await productionClaimAdapter.submitPublicClaim(input);
      setResult(res);
    } finally {
      setSubmitting(false);
    }
  }

  if (shopLoading) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
        <p className="text-xs text-slate-400">{t('loading')}</p>
      </div>
    );
  }

  // Truthful terminal states — persistence is fail-closed until runtime auth.
  if (result && result.ok === false) {
    const unavailable =
      result.code === 'CLAIM_NOT_ENABLED_FOR_SHOP'
        ? { title: t('notEnabledTitle'), body: t('notEnabledBody') }
        : result.code === 'INVALID_REFERENCE'
          ? { title: t('invalidReferenceTitle'), body: t('invalidReferenceBody') }
          : { title: t('unavailableTitle'), body: t('unavailableBody') };
    return (
      <div className="space-y-4">
        <div className="bg-slate-900/90 border border-amber-500/40 rounded-2xl p-6 text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-white">{unavailable.title}</h2>
          <p className="text-xs text-slate-400">{unavailable.body}</p>
          {shopPhoneHref && (
            <a
              href={shopPhoneHref}
              className="inline-flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 py-3 px-4 rounded-xl font-bold text-xs border border-slate-700"
            >
              <Phone className="w-4 h-4 text-emerald-400" />
              {t('callShop')}
              {shopPhone ? ` · ${shopPhone}` : ''}
            </a>
          )}
        </div>
        <a
          href={`/shop/${slug}`}
          className="flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
        >
          <ChevronLeft className="w-4 h-4" />
          {t('backToPortal')}
        </a>
      </div>
    );
  }

  // result.ok === true is unreachable in production today, but render truthfully
  // if a future authorized adapter returns a real reference.
  if (result && result.ok === true) {
    return (
      <div className="bg-slate-900/90 border border-emerald-500/40 rounded-2xl p-6 text-center space-y-3">
        <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-bold text-white">{t('track.refLabel')}</h2>
        <p className="font-mono text-emerald-400 font-bold">{result.publicRef}</p>
      </div>
    );
  }

  const originKey =
    origin.kind === 'booking'
      ? 'booking'
      : origin.kind === 'order'
        ? 'order'
        : 'standalone';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">{t('title')}</h2>
        <p className="text-xs text-slate-400">{t('subtitle')}</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <p className="text-xs font-semibold text-white">{t(`origin.${originKey}Title`)}</p>
        <p className="text-[11px] text-slate-400">{t(`origin.${originKey}Body`)}</p>
      </div>

      {invalidReference && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{t('invalidReferenceBody')}</span>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-900 p-3 text-[11px] text-slate-300">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
        <span>{t('unavailableBody')}</span>
      </div>

      {validationError && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      <div className="space-y-3 bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
        <Field label={t('form.nameLabel')}>
          <input
            required
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('form.namePlaceholder')}
            className={inputClass}
          />
        </Field>
        <Field label={t('form.phoneLabel')}>
          <input
            required
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('form.phonePlaceholder')}
            className={inputClass}
          />
        </Field>
        <Field label={t('form.contactChannelLabel')}>
          <input
            type="text"
            value={contactChannel}
            onChange={(e) => setContactChannel(e.target.value)}
            placeholder={t('form.contactChannelPlaceholder')}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label={t('form.categoryLabel')}>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ClaimCategory)}
          className={inputClass}
        >
          {CLAIM_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('form.relatedLabel')}>
        <input
          type="text"
          value={related}
          onChange={(e) => setRelated(e.target.value)}
          placeholder={t('form.relatedPlaceholder')}
          className={inputClass}
        />
      </Field>

      <Field label={t('form.descriptionLabel')}>
        <textarea
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('form.descriptionPlaceholder')}
          className={`${inputClass} min-h-28`}
        />
      </Field>

      <Field label={t('form.occurredAtLabel')}>
        <input
          type="date"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          className={inputClass}
        />
      </Field>

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('submitting')}
          </>
        ) : (
          <>
            <ShieldAlert className="w-4 h-4" />
            {t('submit')}
          </>
        )}
      </button>

      <a
        href={`/shop/${slug}`}
        className="flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
      >
        <ChevronLeft className="w-4 h-4" />
        {t('backToPortal')}
      </a>
      <p className="text-center text-[11px] text-slate-600">
        {t('footer', { brand: tc('brandName') })}
      </p>
    </form>
  );
}

const inputClass =
  'w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs text-slate-300 mb-1 block">{label}</label>
      {children}
    </div>
  );
}

export default function ClaimIntakePage() {
  const t = useTranslations('claim');
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <LanguageToggle variant="booking" />
      <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-900/80 border-b border-slate-800 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <p className="text-sm font-semibold tracking-wide text-white">
            {t('headerSubtitle')}
          </p>
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
          <ClaimForm />
        </Suspense>
      </main>
    </div>
  );
}
