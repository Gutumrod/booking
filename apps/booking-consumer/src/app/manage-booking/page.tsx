'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { LanguageToggle } from '@/components/language-toggle';
import { supabase } from '@/lib/supabase';
import { manageBookingErrorMessage, type ManageBookingErrorMessages } from '@/lib/manage-booking-error';

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

  // B6b: the customer never sees raw database text. Every failure is mapped to
  // one of these plain-language strings, and anything unrecognised falls back to
  // outcomeFailed instead of echoing the server message.
  const errorMessages: ManageBookingErrorMessages = {
    slotTaken: t('slotTaken'),
    outsideAvailability: t('outsideAvailability'),
    dateClosed: t('dateClosed'),
    staffInactive: t('staffInactive'),
    policyClosed: t('policyClosed'),
    invalidLink: t('invalidLink'),
    outcomeFailed: t('outcomeFailed'),
  };

  async function cancel() {
    setBusy(true); setMessage('');
    const { data, error } = await supabase.rpc('customer_cancel_booking', { p_booking_id: bookingId, p_recovery_token: token, p_reason: reason });
    const result = data as { ok?: boolean; error?: string } | null;
    if (error) {
      setMessage(manageBookingErrorMessage({ code: error.code, message: error.message }, errorMessages));
    } else if (result?.ok === false) {
      setMessage(manageBookingErrorMessage({ message: result.error }, errorMessages));
    } else {
      setMessage(t('cancelled'));
    }
    setBusy(false);
  }

  async function reschedule() {
    setBusy(true); setMessage('');
    const { data, error } = await supabase.rpc('customer_reschedule_booking', { p_booking_id: bookingId, p_recovery_token: token, p_booking_date: date, p_start_time: time, p_reason: reason });
    const result = data as { ok?: boolean; error?: string } | null;
    if (error) {
      setMessage(manageBookingErrorMessage({ code: error.code, message: error.message }, errorMessages));
    } else if (result?.ok === false) {
      setMessage(manageBookingErrorMessage({ message: result.error }, errorMessages));
    } else {
      setMessage(t('rescheduled'));
    }
    setBusy(false);
  }

  if (!bookingId || !token) return <p className="text-rose-300">{t('invalidLink')}</p>;
  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-5 bg-slate-950 px-4 py-16 text-slate-100">
      <LanguageToggle variant="booking" />
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-sm text-slate-400">{t('policy')}</p>
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
