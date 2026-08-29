'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { LanguageToggle } from '@/components/language-toggle';
import { supabase } from '@/lib/supabase';

function ManageBookingForm() {
  const t = useTranslations('manageBooking');
  const params = useSearchParams();
  const bookingId = params.get('bookingId') ?? '';
  const token = params.get('token') ?? '';
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true); setMessage('');
    const { data, error } = await supabase.rpc('customer_cancel_booking', { p_booking_id: bookingId, p_recovery_token: token, p_reason: reason });
    const result = data as { ok?: boolean; error?: string } | null;
    setMessage(error?.message || (result?.ok === false ? result.error || t('invalidLink') : t('cancelled')));
    setBusy(false);
  }

  async function reschedule() {
    setBusy(true); setMessage('');
    const { data, error } = await supabase.rpc('customer_reschedule_booking', { p_booking_id: bookingId, p_recovery_token: token, p_booking_date: date, p_start_time: time, p_reason: reason });
    const result = data as { ok?: boolean; error?: string } | null;
    setMessage(error?.message || (result?.ok === false ? result.error || t('invalidLink') : t('rescheduled')));
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
    </main>
  );
}

export default function ManageBookingPage() {
  return <Suspense fallback={<main className="min-h-screen bg-slate-950" />}><ManageBookingForm /></Suspense>;
}
