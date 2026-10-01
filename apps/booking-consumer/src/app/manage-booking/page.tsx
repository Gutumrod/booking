'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { LanguageToggle } from '@/components/language-toggle';
import { supabase } from '@/lib/supabase';
import { uploadDepositSlip, submitDepositSlip } from '@/lib/booking-service';
import {
  getCustomerBookingStatus,
  toResubmitInput,
  type CustomerBookingStatus,
} from '@/lib/customer-booking';
import {
  MAX_SLIP_SUBMISSIONS,
  resolveCustomerBookingScreen,
  type CustomerBookingScreen,
} from '@/lib/deposit-resubmit';

type StatusLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; booking: CustomerBookingStatus; screen: CustomerBookingScreen }
  | { kind: 'failed' }
  | { kind: 'unavailable' };

function ManageBookingForm() {
  const t = useTranslations('manageBooking');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const bookingId = params.get('bookingId') ?? '';
  const token = params.get('token') ?? '';
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // B4: the customer now sees the real booking state, and a rejected customer gets
  // a way back in. The read is server-side (get_booking_status, a SPEC in this
  // unit); when it is absent the screen says so instead of showing a dead form.
  const [status, setStatus] = useState<StatusLoad>({ kind: 'loading' });
  const [slipFile, setSlipFile] = useState<File | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!bookingId || !token) return;
    setStatus({ kind: 'loading' });
    try {
      const booking = await getCustomerBookingStatus(bookingId, token);
      setStatus({
        kind: 'ready',
        booking,
        screen: resolveCustomerBookingScreen(toResubmitInput(booking, new Date())),
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : '';
      // A missing RPC is an honest "this deployment cannot do it yet"; anything
      // else is a real load failure. Neither is ever reported as a success.
      setStatus(/function|schema cache|does not exist|not found/i.test(text)
        ? { kind: 'unavailable' }
        : { kind: 'failed' });
    }
  }, [bookingId, token]);

  useEffect(() => {
    // Microtask, matching the dashboard's own initial-load pattern: the effect
    // subscribes, the load resolves outside the effect body, and no setState runs
    // synchronously during commit.
    let isCurrent = true;
    queueMicrotask(() => {
      if (isCurrent) void refreshStatus();
    });
    return () => {
      isCurrent = false;
    };
  }, [refreshStatus]);

  async function cancel() {
    setBusy(true); setMessage('');
    const { data, error } = await supabase.rpc('customer_cancel_booking', { p_booking_id: bookingId, p_recovery_token: token, p_reason: reason });
    const result = data as { ok?: boolean; error?: string } | null;
    setMessage(error?.message || (result?.ok === false ? result.error || t('invalidLink') : t('cancelled')));
    setBusy(false);
    await refreshStatus();
  }

  async function reschedule() {
    setBusy(true); setMessage('');
    const { data, error } = await supabase.rpc('customer_reschedule_booking', { p_booking_id: bookingId, p_recovery_token: token, p_booking_date: date, p_start_time: time, p_reason: reason });
    const result = data as { ok?: boolean; error?: string } | null;
    setMessage(error?.message || (result?.ok === false ? result.error || t('invalidLink') : t('rescheduled')));
    setBusy(false);
    await refreshStatus();
  }

  async function resubmit() {
    if (!slipFile) return;
    setBusy(true); setMessage('');
    try {
      const objectPath = await uploadDepositSlip(bookingId, token, slipFile, {
        unsupportedType: t('invalidLink'),
        tooLarge: t('invalidLink'),
        urlFailed: t('invalidLink'),
      });
      await submitDepositSlip(bookingId, token, objectPath);
      setMessage(t('resubmitSubmitted'));
      setSlipFile(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('resubmitWindowClosed'));
    } finally {
      setBusy(false);
      await refreshStatus();
    }
  }

  if (!bookingId || !token) return <p className="text-rose-300">{t('invalidLink')}</p>;

  const screenCopy = (screen: CustomerBookingScreen): string => {
    switch (screen) {
      case 'awaiting_review': return t('screenAwaitingReview');
      case 'rejected_resubmit': return t('screenRejectedResubmit');
      case 'rejected_queue_taken': return t('screenRejectedQueueTaken');
      case 'rejected_attempts_exhausted': return t('screenRejectedAttemptsExhausted');
      case 'cancelled': return t('screenCancelled');
      case 'confirmed': return t('screenConfirmed');
      default: return t('screenOther');
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-5 bg-slate-950 px-4 py-16 text-slate-100">
      <LanguageToggle variant="booking" />
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-sm text-slate-400">{t('policy')}</p>

      <section className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-2">
        <h2 className="text-sm font-bold">{t('statusTitle')}</h2>
        {status.kind === 'loading' && <p className="text-xs text-slate-400">{t('statusLoading')}</p>}
        {status.kind === 'failed' && <p className="text-xs text-rose-300">{t('statusFailed')}</p>}
        {status.kind === 'unavailable' && (
          <p data-testid="booking-status-unavailable" className="text-xs text-amber-300">{t('statusUnavailable')}</p>
        )}
        {status.kind === 'ready' && (
          <>
            <p className="text-xs text-slate-300">{t('code')} <span className="font-mono text-emerald-400">{status.booking.bookingCode}</span></p>
            <p className="text-xs text-slate-300">{t('shop')} <span className="text-white">{status.booking.shopName}</span></p>
            <p className="text-xs text-slate-300">{t('appointment')} <span className="text-white">{status.booking.bookingDate} @ {status.booking.startTime}</span></p>
            <p className="text-xs text-slate-300">{t('statusLabel')} <span className="text-white">{t(`status.${status.booking.status}` as never)}</span></p>
            <p className="text-xs text-slate-300">{t('depositLabel')} <span className="text-white">{t(`deposit.${status.booking.depositStatus}` as never)}</span></p>
            <p className="text-xs text-slate-300">{t('attemptsLabel', { count: status.booking.slipSubmitCount, max: MAX_SLIP_SUBMISSIONS })}</p>
            <p data-testid="booking-status-screen" data-screen={status.screen} className="pt-1 text-sm font-semibold text-amber-200">
              {screenCopy(status.screen)}
            </p>
          </>
        )}
      </section>

      {status.kind === 'ready' && status.screen === 'rejected_resubmit' && (
        <section className="rounded-xl border border-emerald-500/40 bg-slate-900 p-4 space-y-3">
          <h2 className="text-sm font-bold">{t('resubmitTitle')}</h2>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={t('resubmitFile')}
            onChange={(event) => setSlipFile(event.target.files?.[0] ?? null)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs"
          />
          <button
            type="button"
            disabled={busy || !slipFile}
            onClick={resubmit}
            className="w-full rounded-xl bg-emerald-500 p-3 font-semibold text-slate-950 disabled:opacity-40"
          >
            {t('resubmitSubmit')}
          </button>
        </section>
      )}

      <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('reason')} className="min-h-24 w-full rounded-xl border border-slate-700 bg-slate-900 p-3" />
      <div className="grid grid-cols-2 gap-3">
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 p-3" />
        <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 p-3" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button disabled={busy || !reason.trim()} onClick={cancel} className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 font-semibold text-rose-200 disabled:opacity-40">{t('cancel')}</button>
        <button disabled={busy || !reason.trim() || !date || !time} onClick={reschedule} className="rounded-xl bg-emerald-500 p-3 font-semibold text-slate-950 disabled:opacity-40">{t('reschedule')}</button>
      </div>
      {message && <p className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm">{message}</p>}
      <Link href="/support" data-testid="support-entry-link" className="inline-block text-xs text-slate-400 underline hover:text-emerald-400">
        {tc('supportLink')}
      </Link>
    </main>
  );
}

export default function ManageBookingPage() {
  return <Suspense fallback={<main className="min-h-screen bg-slate-950" />}><ManageBookingForm /></Suspense>;
}
