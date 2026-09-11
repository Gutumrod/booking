'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  createTicket,
  fetchTicketsByPhone,
  getCurrentShopMembership,
} from '@/lib/ticket-service';
import {
  isValidPhone,
  validateDeadline,
  type Attachment,
  type NewTicketInput,
  type Priority,
  type Ticket,
  type TicketType,
} from '@/lib/ticket-domain';
import { useTicketLabels } from '@/i18n/ticket-i18n';
import { LanguageToggle } from '@/components/language-toggle';
import { PreviewCustomerPageLink } from '@/components/preview-customer-page';
import {
  ArrowLeft,
  Calendar,
  Clock,
  User,
  Phone,
  AlertTriangle,
  Plus,
  Trash2,
  FileText,
  Paperclip,
  CheckCircle2,
  ExternalLink,
  History,
} from 'lucide-react';

const TICKET_TYPES: TicketType[] = [
  'ProductClaim',
  'ServiceIssue',
  'RecheckRequest',
  'RefundRequest',
  'Other',
];

const PRIORITIES: Priority[] = ['Low', 'Medium', 'High'];

function toLocalDatetimeString(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function NewTicketIntakePage() {
  const t = useTranslations('tickets');
  const { STATUS_LABELS, PRIORITY_LABELS, TICKET_TYPE_LABELS } = useTicketLabels();
  const router = useRouter();
  const [shopId, setShopId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>('');

  // Form Fields
  const [receivedAt, setReceivedAt] = useState(() => toLocalDatetimeString(new Date()));
  const [dueAt, setDueAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return toLocalDatetimeString(d);
  });
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [contactChannel, setContactChannel] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TicketType>('ServiceIssue');
  const [priority, setPriority] = useState<Priority>('Medium');
  const [issueCategory, setIssueCategory] = useState('');
  const [relatedProductService, setRelatedProductService] = useState('');
  const [description, setDescription] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [assignedTo, setAssignedTo] = useState('');

  // Attachments Metadata Only
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attName, setAttName] = useState('');
  const [attMime, setAttMime] = useState('image/jpeg');
  const [attSize, setAttSize] = useState('');

  // Duplicate Phone History State (Surfaces past tickets without autofill)
  const [phoneHistoryTickets, setPhoneHistoryTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    async function initShop() {
      try {
        const mem = await getCurrentShopMembership();
        setShopId(mem.shopId);
      } catch (err) {
        setFormError(err instanceof Error ? err.message : t('loadFailed'));
      }
    }
    initShop();
  }, [t]);

  // When phone changes and is valid, search for duplicate customer tickets
  useEffect(() => {
    if (!shopId || !isValidPhone(customerPhone)) {
      // Reset stale lookup results when the current key is invalid.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhoneHistoryTickets([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const history = await fetchTicketsByPhone(shopId, customerPhone);
        setPhoneHistoryTickets(history);
      } catch (err) {
        console.error('Error fetching phone history:', err);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [customerPhone, shopId]);

  const handleAddAttachment = () => {
    if (!attName.trim() || !attMime.trim() || !attSize.trim()) {
      return;
    }
    const sizeNum = Number(attSize);
    if (Number.isNaN(sizeNum) || sizeNum < 0) {
      return;
    }

    const newAtt: Attachment = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: attName.trim(),
      mimeType: attMime.trim(),
      sizeBytes: sizeNum,
    };

    setAttachments((prev) => [...prev, newAtt]);
    setAttName('');
    setAttMime('image/jpeg');
    setAttSize('');
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!shopId) {
      setFormError(t('loadFailed'));
      return;
    }

    if (!customerPhone.trim() || !customerName.trim() || !title.trim() || !description.trim()) {
      setFormError(t('requiredFieldsError'));
      return;
    }

    if (!isValidPhone(customerPhone)) {
      setFormError(t('invalidPhoneError'));
      return;
    }

    const deadlineValidation = validateDeadline(receivedAt, dueAt);
    if (!deadlineValidation.valid) {
      if (deadlineValidation.error === 'DUE_BEFORE_RECEIVED') {
        setFormError(t('dueBeforeReceivedError'));
      } else {
        setFormError(t('invalidDateTimeError'));
      }
      return;
    }

    setIsSubmitting(true);

    try {
      const input: NewTicketInput = {
        receivedAt: new Date(receivedAt).toISOString(),
        dueAt: new Date(dueAt).toISOString(),
        customerPhone: customerPhone.trim(),
        customerName: customerName.trim(),
        contactChannel: contactChannel.trim() || undefined,
        title: title.trim(),
        type,
        priority,
        issueCategory: issueCategory.trim() || undefined,
        relatedProductService: relatedProductService.trim() || undefined,
        description: description.trim(),
        bookingId: bookingId.trim() || null,
        serviceId: null,
        occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null,
        assignedTo: assignedTo.trim() || null,
        attachments,
      };

      const result = await createTicket(shopId, input);

      if (!result.ok || !result.ticket) {
        setFormError(result.error || t('saveFailedError'));
        setIsSubmitting(false);
        return;
      }

      router.push(`/dashboard/tickets/${result.ticket.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('saveErrorGeneric'));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-slate-900/80 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/tickets"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title={t('backToList')}
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-bold text-lg text-white">{t('newIntakeTitle')}</h1>
              <p className="text-xs text-slate-400">
                {t('newIntakeSubtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PreviewCustomerPageLink />
            <LanguageToggle />
          </div>
        </div>
      </header>

      {/* Main Form */}
      <main className="max-w-4xl mx-auto w-full px-6 py-8 flex-1">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {formError && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Section 1: Timing */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-2 text-emerald-400 border-b border-slate-800 pb-3">
              <Clock className="w-4 h-4" />
              <h2 className="text-sm font-bold text-white">{t('timingSection')}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('receivedAtLabel')}
                </label>
                <input
                  type="datetime-local"
                  required
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('dueAtLabel')}
                </label>
                <input
                  type="datetime-local"
                  required
                  min={receivedAt}
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Customer Info */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-2 text-emerald-400 border-b border-slate-800 pb-3">
              <User className="w-4 h-4" />
              <h2 className="text-sm font-bold text-white">{t('customerSection')}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('customerPhoneLabel')}
                </label>
                <input
                  type="tel"
                  required
                  placeholder={t('customerPhonePlaceholder')}
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  {t('customerPhoneHint')}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('customerNameLabel')}
                </label>
                <input
                  type="text"
                  required
                  placeholder={t('customerNamePlaceholder')}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('contactChannelLabel')}
                </label>
                <input
                  type="text"
                  placeholder={t('contactChannelPlaceholder')}
                  value={contactChannel}
                  onChange={(e) => setContactChannel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Duplicate Customer Phone Notice (No Autofill Rule) */}
            {phoneHistoryTickets.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex flex-col gap-2">
                <div className="flex items-center gap-2 font-bold text-xs text-amber-400">
                  <History className="w-4 h-4" />
                  <span>
                    {t('historyFound', { count: phoneHistoryTickets.length })}
                  </span>
                </div>
                <p className="text-[11px] text-amber-200/80">
                  {t('historyBody')}
                </p>
                <ul className="divide-y divide-amber-500/20 text-xs mt-1">
                  {phoneHistoryTickets.map((ht) => (
                    <li key={ht.id} className="py-1.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-semibold text-white">{ht.title}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900/80 text-slate-300 border border-slate-700">
                          {STATUS_LABELS[ht.status]}
                        </span>
                      </div>
                      <Link
                        href={`/dashboard/tickets/${ht.id}`}
                        target="_blank"
                        className="text-[11px] text-amber-400 hover:underline flex items-center gap-1 shrink-0"
                      >
                        {t('viewOldCase')} <ExternalLink className="w-3 h-3" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Section 3: Case Details */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-2 text-emerald-400 border-b border-slate-800 pb-3">
              <FileText className="w-4 h-4" />
              <h2 className="text-sm font-bold text-white">{t('caseDetailsSection')}</h2>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                {t('titleLabel')}
              </label>
              <input
                type="text"
                required
                placeholder={t('titlePlaceholder')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('caseTypeLabel')}
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as TicketType)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  {TICKET_TYPES.map((tp) => (
                    <option key={tp} value={tp}>
                      {TICKET_TYPE_LABELS[tp]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('priorityLabel')}
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  {PRIORITIES.map((pr) => (
                    <option key={pr} value={pr}>
                      {PRIORITY_LABELS[pr]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('issueCategoryLabel')}
                </label>
                <input
                  type="text"
                  placeholder={t('issueCategoryPlaceholder')}
                  value={issueCategory}
                  onChange={(e) => setIssueCategory(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('relatedProductLabel')}
                </label>
                <input
                  type="text"
                  placeholder={t('relatedProductPlaceholder')}
                  value={relatedProductService}
                  onChange={(e) => setRelatedProductService(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                {t('descriptionLabel')}
              </label>
              <textarea
                required
                rows={5}
                placeholder={t('descriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-emerald-500 leading-relaxed"
              />
            </div>
          </div>

          {/* Section 4: Optional References */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-2 text-emerald-400 border-b border-slate-800 pb-3">
              <Calendar className="w-4 h-4" />
              <h2 className="text-sm font-bold text-white">
                {t('referencesSection')}
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('bookingIdLabel')}
                </label>
                <input
                  type="text"
                  placeholder={t('bookingIdPlaceholder')}
                  value={bookingId}
                  onChange={(e) => setBookingId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('assigneeLabel')}
                </label>
                <input
                  type="text"
                  placeholder={t('assigneePlaceholder')}
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('occurredAtLabel')}
                </label>
                <input
                  type="datetime-local"
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Section 5: Attachment Metadata Only (Zero Binary Storage) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-2 text-emerald-400 border-b border-slate-800 pb-3">
              <Paperclip className="w-4 h-4" />
              <h2 className="text-sm font-bold text-white">
                {t('attachmentsSection')}
              </h2>
            </div>

            <p className="text-[11px] text-slate-400">
              {t('attachmentsNote')}
            </p>

            <div className="flex flex-wrap items-center gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <input
                type="text"
                placeholder={t('attFileNamePlaceholder')}
                value={attName}
                onChange={(e) => setAttName(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white min-w-[200px] flex-1 focus:outline-none focus:border-emerald-500"
              />
              <input
                type="text"
                placeholder={t('attMimePlaceholder')}
                value={attMime}
                onChange={(e) => setAttMime(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white w-32 focus:outline-none focus:border-emerald-500"
              />
              <input
                type="number"
                min="0"
                placeholder={t('attSizePlaceholder')}
                value={attSize}
                onChange={(e) => setAttSize(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white w-28 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={handleAddAttachment}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('addFile')}
              </button>
            </div>

            {attachments.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-slate-300">
                  {t('savedFilesLabel', { count: attachments.length })}
                </span>
                <div className="flex flex-col gap-1.5">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Paperclip className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="font-medium text-white">{att.name}</span>
                        <span className="text-slate-500 text-[11px]">
                          ({att.mimeType} · {(att.sizeBytes / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(att.id)}
                        className="text-slate-400 hover:text-rose-400 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Submit Action */}
          <div className="flex items-center justify-end gap-3 pt-4">
            <Link
              href="/dashboard/tickets"
              className="px-5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors"
            >
              {t('backToListBtn')}
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-bold transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2"
            >
              {isSubmitting ? (
                <>{t('creatingTicket')}</>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {t('createTicketBtn')}
                </>
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
