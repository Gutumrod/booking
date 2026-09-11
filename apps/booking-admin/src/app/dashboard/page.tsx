'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  approveBookingDeposit,
  cancelBooking,
  createShopHoliday,
  createSignedDepositSlipUrl,
  createService,
  createStaff,
  deleteShopHoliday,
  fetchAdminDashboardData,
  linkStaffUser,
  exportCoreBusinessData,
  rejectBookingDeposit,
  requestAccountClosure,
  saveStaffWeeklySchedule,
  setServiceActive,
  setBookingOutcome,
  setStaffActive,
  startBillingCheckout,
  startBillingPortal,
  updateService,
  updateShopSettings,
  type DashboardBooking,
  type DashboardService,
  type DashboardStaff,
  type DashboardStaffSchedule,
  type DashboardHoliday,
  type DashboardSubscription,
} from '@/lib/admin-service';
import { LanguageToggle } from '@/components/language-toggle';
import { commitNumericField } from '@/lib/numeric-field';
import { computeReadiness, isShopReady, needsMerchantAttention, type ReadinessKey } from '@/lib/readiness';
import { TimeField } from '@/components/time-field';
import { mergeServerSchedules } from '@/lib/schedule-merge';
import { 
  Calendar, Users, DollarSign, Eye, Clock,
  Settings, AlertCircle, Plus, ShieldCheck,
  QrCode, ExternalLink, CalendarOff, Coffee, Save,
  Copy, MessageCircle, Check, Trash2, Edit3,
  Scissors, Store, Globe, Phone, X
} from 'lucide-react';

type Booking = DashboardBooking;

type StaffMember = DashboardStaff;
type ServiceItem = DashboardService;

const BOOKING_SITE_URL = (process.env.NEXT_PUBLIC_BOOKING_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

function getBangkokDateString() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatSubscriptionDate(value: string | null, locale: string, notSetLabel: string) {
  if (!value) return notSetLabel;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return notSetLabel;

  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-US', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getSubscriptionPlanLabel(plan: DashboardSubscription['plan'], t: ReturnType<typeof useTranslations<'dashboard'>>) {
  switch (plan) {
    case 'basic_490':
      return t('planLabelBasic');
    case 'pro_990':
      return t('planLabelPro');
    default:
      return t('planLabelTrial');
  }
}

function getSubscriptionStatusDetails(status: DashboardSubscription['status'], t: ReturnType<typeof useTranslations<'dashboard'>>) {
  switch (status) {
    case 'active':
      return { label: t('subStatusActive'), className: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' };
    case 'trialing':
      return { label: t('subStatusTrialing'), className: 'text-sky-300 border-sky-500/30 bg-sky-500/10' };
    case 'past_due':
      return { label: t('subStatusPastDue'), className: 'text-amber-300 border-amber-500/30 bg-amber-500/10' };
    case 'canceled':
      return { label: t('subStatusCanceled'), className: 'text-slate-300 border-slate-600 bg-slate-800' };
    case 'incomplete':
      return { label: t('subStatusIncomplete'), className: 'text-amber-300 border-amber-500/30 bg-amber-500/10' };
    case 'incomplete_expired':
      return { label: t('subStatusIncompleteExpired'), className: 'text-rose-300 border-rose-500/30 bg-rose-500/10' };
    case 'unpaid':
      return { label: t('subStatusUnpaid'), className: 'text-rose-300 border-rose-500/30 bg-rose-500/10' };
  }
}

export default function AdminDashboard() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const DAY_NAMES = t.raw('dayNames') as string[];

  const [activeTab, setActiveTab] = useState<'bookings' | 'schedules' | 'services' | 'staff' | 'settings' | 'billing'>('bookings');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [schedules, setSchedules] = useState<DashboardStaffSchedule[]>([]);
  const [selectedScheduleDays, setSelectedScheduleDays] = useState<Record<string, number>>({});
  // Staff whose schedule has unsaved edits (KMO-05). A ref mirror lets a
  // background refetch keep their local edits instead of overwriting them.
  const [dirtyStaffIds, setDirtyStaffIds] = useState<ReadonlySet<string>>(new Set());
  const dirtyStaffIdsRef = useRef<ReadonlySet<string>>(new Set());
  const setDirty = (next: ReadonlySet<string>) => {
    dirtyStaffIdsRef.current = next;
    setDirtyStaffIds(next);
  };
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [selectedSlipBooking, setSelectedSlipBooking] = useState<Booking | null>(null);
  const [signedSlipUrl, setSignedSlipUrl] = useState<string | null>(null);
  const [cancelBookingTarget, setCancelBookingTarget] = useState<Booking | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isBookingsLoading, setIsBookingsLoading] = useState(true);
  const [bookingError, setBookingError] = useState('');
  const [mutatingBookingId, setMutatingBookingId] = useState<string | null>(null);
  const [shopId, setShopId] = useState('');
  const [shopRole, setShopRole] = useState<'owner' | 'admin' | 'staff'>('staff');
  const [managementError, setManagementError] = useState('');
  const [mutatingResourceId, setMutatingResourceId] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<DashboardSubscription | null>(null);
  const [billingLoadError, setBillingLoadError] = useState('');
  const isManagedSubscriptionPlan = (plan: DashboardSubscription['plan']) =>
    subscription?.plan === plan && ['active', 'past_due'].includes(subscription.status);

  // Shop Profile State
  const [shopName, setShopName] = useState(tCommon('loading'));
  const [shopPhone, setShopPhone] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [shopSlug, setShopSlug] = useState('');
  const [shopSettingsSaved, setShopSettingsSaved] = useState(false);
  const [copiedLinkNotice, setCopiedLinkNotice] = useState(false);

  // Service Form State
  const [editingService, setEditingService] = useState<ServiceItem | null>(null);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [serviceName, setServiceName] = useState('');
  const [serviceDesc, setServiceDesc] = useState('');
  // Held as strings while editing so a field can be cleared to empty (KMO-08);
  // parsed and validated at save via commitNumericField. Deposit starts empty --
  // the merchant must set it explicitly, never an invented seed (Codex F4).
  const [serviceDuration, setServiceDuration] = useState('45');
  const [servicePrice, setServicePrice] = useState('350');
  const [serviceDeposit, setServiceDeposit] = useState('');

  // Filter Bookings by Date View
  const [bookingFilter, setBookingFilter] = useState<'today' | 'upcoming' | 'all'>('all');

  // Shop Settings State
  const [promptpayNumber, setPromptpayNumber] = useState('');
  const [promptpayName, setPromptpayName] = useState('');
  const [lineOaId, setLineOaId] = useState('');
  const [requireDeposit, setRequireDeposit] = useState(true);
  const [defaultDepositAmount, setDefaultDepositAmount] = useState<number | null>(null);

  // Special Holidays
  const [specialHolidayDate, setSpecialHolidayDate] = useState('');
  const [specialHolidayReason, setSpecialHolidayReason] = useState('');
  const [holidaysList, setHolidaysList] = useState<DashboardHoliday[]>([]);

  // Modals & Notices
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffPhone, setNewStaffPhone] = useState('');

  // Stats
  const todayStr = getBangkokDateString();
  const totalToday = bookings.filter(b => b.date === todayStr).length;
  const totalUpcoming = bookings.filter(b => b.date > todayStr).length;
  const pendingDeposit = bookings.filter(b => b.status === 'pending_review').length;
  const depositCollected = bookings.reduce((sum, b) => sum + (b.status === 'confirmed' ? b.depositPrice : 0), 0);

  const filteredBookings = bookings.filter(b => {
    if (bookingFilter === 'today') return b.date === todayStr;
    if (bookingFilter === 'upcoming') return b.date > todayStr;
    return true;
  });

  // Readiness is derived from data already loaded; it never blocks Preview.
  const readinessRows = computeReadiness({
    shopName: shopName === tCommon('loading') ? '' : shopName,
    shopPhone,
    promptpayNumber,
    promptpayName,
    requireDeposit,
    defaultDepositAmount,
    services,
    staff: staffList,
    schedules,
  });
  // public_booking has no merchant tab: it is blocked_r7 (server-owned truth).
  const readinessTabFor: Partial<Record<ReadinessKey, typeof activeTab>> = {
    profile: 'services',
    services: 'services',
    staff: 'staff',
    schedule: 'schedules',
    payment: 'settings',
  };
  const readinessLabel: Record<ReadinessKey, string> = {
    profile: t('readiness_profile'),
    services: t('readiness_services'),
    staff: t('readiness_staff'),
    schedule: t('readiness_schedule'),
    payment: t('readiness_payment'),
    public_booking: t('readiness_public_booking'),
  };

  // Stable callback is required by the initial-load effect below.
  const loadDashboardBookings = useCallback(async (showLoading = true) => {
    if (showLoading) setIsBookingsLoading(true);
    setBookingError('');
    setManagementError('');

    try {
      const data = await fetchAdminDashboardData();
      setBookings(data.bookings);
      setShopName(data.shop.name);
      setShopSlug(data.shop.slug);
      setShopId(data.shop.id);
      setShopRole(data.shop.role);
      setShopPhone(data.shop.phone);
      setShopAddress(data.shop.address);
      setPromptpayNumber(data.shop.promptpayNumber);
      setPromptpayName(data.shop.promptpayName);
      setRequireDeposit(data.shop.requireDeposit);
      setDefaultDepositAmount(data.shop.defaultDepositAmount);
      setLineOaId(data.shop.lineOaId);
      setServices(data.services);
      setStaffList(data.staff);
      setSchedules((prev) => mergeServerSchedules(prev, data.schedules, dirtyStaffIdsRef.current));
      setHolidaysList(data.holidays);
      setSubscription(data.subscription);
      setBillingLoadError(data.subscriptionError ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('loadFailed');
      setBookingError(message);
      setManagementError(message);
    } finally {
      if (showLoading) setIsBookingsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let isCurrent = true;

    fetchAdminDashboardData()
      .then((data) => {
        if (!isCurrent) return;
        setBookings(data.bookings);
        setShopName(data.shop.name);
        setShopSlug(data.shop.slug);
        setShopId(data.shop.id);
        setShopRole(data.shop.role);
        setShopPhone(data.shop.phone);
        setShopAddress(data.shop.address);
        setPromptpayNumber(data.shop.promptpayNumber);
        setPromptpayName(data.shop.promptpayName);
        setRequireDeposit(data.shop.requireDeposit);
        setDefaultDepositAmount(data.shop.defaultDepositAmount);
        setLineOaId(data.shop.lineOaId);
        setServices(data.services);
        setStaffList(data.staff);
        setSchedules((prev) => mergeServerSchedules(prev, data.schedules, dirtyStaffIdsRef.current));
        setHolidaysList(data.holidays);
        setSubscription(data.subscription);
        setBillingLoadError(data.subscriptionError ?? '');
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        const message = error instanceof Error ? error.message : t('loadFailed');
        setBookingError(message);
        setManagementError(message);
      })
      .finally(() => {
        if (isCurrent) setIsBookingsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [t]);

  // Warn before leaving with unsaved staff schedule edits (KMO-05).
  useEffect(() => {
    if (dirtyStaffIds.size === 0) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirtyStaffIds]);

  const handleApproveSlip = async (bookingId: string) => {
    setMutatingBookingId(bookingId);
    setBookingError('');
    try {
      await approveBookingDeposit(bookingId);
      setSelectedSlipBooking(null);
      await loadDashboardBookings(false);
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : t('approveFailed'));
    } finally {
      setMutatingBookingId(null);
    }
  };

  const handleRejectSlip = async (bookingId: string) => {
    setMutatingBookingId(bookingId);
    setBookingError('');
    try {
      await rejectBookingDeposit(bookingId, t('rejectDefaultReason'));
      setSelectedSlipBooking(null);
      await loadDashboardBookings(false);
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : t('rejectFailed'));
    } finally {
      setMutatingBookingId(null);
    }
  };

  const handleConfirmCancellation = async () => {
    if (!cancelBookingTarget || !cancelReason.trim()) return;

    setMutatingBookingId(cancelBookingTarget.id);
    setBookingError('');
    try {
      await cancelBooking(cancelBookingTarget.id, cancelReason.trim());
      setCancelBookingTarget(null);
      setCancelReason('');
      await loadDashboardBookings(false);
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : t('cancelQueueFailed'));
    } finally {
      setMutatingBookingId(null);
    }
  };

  const handleBookingOutcome = async (bookingId: string, outcome: 'completed' | 'no_show') => {
    if (shopRole === 'staff') return;
    setMutatingBookingId(bookingId);
    setBookingError('');
    try {
      await setBookingOutcome(bookingId, outcome);
      await loadDashboardBookings(false);
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : t('outcomeFailed'));
    } finally {
      setMutatingBookingId(null);
    }
  };

  const handleDataExport = async () => {
    if (!shopId || shopRole !== 'owner') return;
    setMutatingResourceId('data-export');
    setManagementError('');
    try {
      const data = await exportCoreBusinessData(shopId);
      const rows: string[][] = [['dataset', 'record_json']];
      for (const [dataset, value] of Object.entries(data)) {
        const records = Array.isArray(value) ? value : [value];
        for (const record of records) rows.push([dataset, JSON.stringify(record ?? {})]);
      }
      const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `booking-data-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : t('dataExportFailed'));
    } finally {
      setMutatingResourceId(null);
    }
  };

  const handleAccountClosure = async () => {
    if (!shopId || shopRole !== 'owner') return;
    const reason = window.prompt(t('closureReasonPrompt'))?.trim();
    if (!reason) return;
    setMutatingResourceId('account-closure');
    setManagementError('');
    try {
      await requestAccountClosure(shopId, reason);
      window.alert(t('closureRequested'));
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : t('closureRequestFailed'));
    } finally {
      setMutatingResourceId(null);
    }
  };

  const handleUpgrade = async (plan: 'basic_490' | 'pro_990') => {
    if (shopRole !== 'owner') return;

    setMutatingResourceId(`checkout-${plan}`);
    setManagementError('');
    try {
      const url = await startBillingCheckout(plan);
      window.location.href = url;
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : t('upgradeFailed'));
      setMutatingResourceId(null);
    }
  };

  const handleManageBilling = async () => {
    if (shopRole !== 'owner') return;

    setMutatingResourceId('billing-portal');
    setManagementError('');
    try {
      const url = await startBillingPortal();
      window.location.href = url;
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : t('portalFailed'));
      setMutatingResourceId(null);
    }
  };

  const handleSaveShopSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || shopRole !== 'owner') return;

    setMutatingResourceId('shop-settings');
    setManagementError('');
    try {
      await updateShopSettings(shopId, {
        name: shopName,
        phone: shopPhone,
        address: shopAddress,
        promptpayNumber,
        promptpayName,
        lineOaId,
      });
      await loadDashboardBookings(false);
      setShopSettingsSaved(true);
      setTimeout(() => setShopSettingsSaved(false), 2000);
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : t('saveShopFailed'));
    } finally {
      setMutatingResourceId(null);
    }
  };

  const handleCopyShopLink = () => {
    const fullUrl = `${BOOKING_SITE_URL}/book/${shopSlug}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedLinkNotice(true);
    setTimeout(() => setCopiedLinkNotice(false), 2000);
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !newStaffName.trim()) return;

    setMutatingResourceId('staff-new');
    setManagementError('');
    try {
      await createStaff(shopId, newStaffName.trim(), newStaffPhone.trim());
      setNewStaffName('');
      setNewStaffPhone('');
      await loadDashboardBookings(false);
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : t('addStaffFailed'));
    } finally {
      setMutatingResourceId(null);
    }
  };

  const toggleStaffActive = async (staffMember: StaffMember) => {
    setMutatingResourceId(staffMember.id);
    setManagementError('');
    try {
      await setStaffActive(staffMember.id, !staffMember.isActive);
      await loadDashboardBookings(false);
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : t('toggleStaffFailed'));
    } finally {
      setMutatingResourceId(null);
    }
  };

  const handleLinkStaffUser = async (staffMember: StaffMember) => {
    if (shopRole !== 'owner') return;
    const email = window.prompt(t('staffEmailPrompt'))?.trim();
    if (!email) return;
    setMutatingResourceId(`link-${staffMember.id}`);
    setManagementError('');
    try {
      await linkStaffUser(staffMember.id, email);
      window.alert(t('staffLinked'));
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : t('staffLinkFailed'));
    } finally {
      setMutatingResourceId(null);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !specialHolidayDate) return;
    setMutatingResourceId('holiday-new');
    setManagementError('');
    try {
      await createShopHoliday(shopId, specialHolidayDate, specialHolidayReason.trim());
      setSpecialHolidayDate('');
      setSpecialHolidayReason('');
      await loadDashboardBookings(false);
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : t('addHolidayFailed'));
    } finally {
      setMutatingResourceId(null);
    }
  };

  const handleDeleteHoliday = async (holidayId: string) => {
    setMutatingResourceId(holidayId);
    setManagementError('');
    try {
      await deleteShopHoliday(holidayId);
      await loadDashboardBookings(false);
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : t('deleteHolidayFailed'));
    } finally {
      setMutatingResourceId(null);
    }
  };

  const updateScheduleDay = (
    staffId: string,
    dayOfWeek: number,
    changes: Partial<DashboardStaffSchedule['days'][number]>,
  ) => {
    setSchedules((previous) => previous.map((schedule) => schedule.staffId === staffId
      ? { ...schedule, days: schedule.days.map((day) => day.dayOfWeek === dayOfWeek ? { ...day, ...changes } : day) }
      : schedule));
    setDirty(new Set(dirtyStaffIdsRef.current).add(staffId));
  };

  const clearDirty = (staffId: string) => {
    const next = new Set(dirtyStaffIdsRef.current);
    next.delete(staffId);
    setDirty(next);
  };

  // Save one staff schedule. Does NOT refetch all schedules (that was the KMO-05
  // bug -- it overwrote other cards' unsaved edits). The in-memory `days` is
  // exactly what was saved.
  const handleSaveSchedule = async (schedule: DashboardStaffSchedule) => {
    setMutatingResourceId(schedule.staffId);
    setManagementError('');
    try {
      await saveStaffWeeklySchedule(schedule.staffId, schedule.days);
      clearDirty(schedule.staffId);
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : t('saveScheduleFailed'));
    } finally {
      setMutatingResourceId(null);
    }
  };

  const handleSaveAllSchedules = async () => {
    const targets = schedules.filter((s) => dirtyStaffIdsRef.current.has(s.staffId));
    if (targets.length === 0) return;
    setMutatingResourceId('schedules-all');
    setManagementError('');
    let failed: string | null = null;
    for (const schedule of targets) {
      try {
        await saveStaffWeeklySchedule(schedule.staffId, schedule.days);
        clearDirty(schedule.staffId);
      } catch (error) {
        failed = error instanceof Error ? error.message : t('saveScheduleFailed');
        break;
      }
    }
    if (failed) setManagementError(failed);
    setMutatingResourceId(null);
  };

  const handleOpenAddService = () => {
    setEditingService(null);
    setServiceName('');
    setServiceDesc('');
    setServiceDuration('45');
    setServicePrice('350');
    setServiceDeposit(''); // no invented seed -- the merchant sets this (Codex F4)
    setShowServiceForm(true);
  };

  const handleOpenEditService = (sv: ServiceItem) => {
    setEditingService(sv);
    setServiceName(sv.name);
    setServiceDesc(sv.description);
    setServiceDuration(String(sv.duration));
    setServicePrice(String(sv.price));
    setServiceDeposit(sv.deposit == null ? '' : String(sv.deposit)); // preserve null vs explicit 0
    setShowServiceForm(true);
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !serviceName.trim()) return;

    const durationParsed = commitNumericField(serviceDuration, { min: 1, integer: true });
    const priceParsed = commitNumericField(servicePrice, { min: 0 });
    const depositParsed = commitNumericField(serviceDeposit, { min: 0 });
    if (depositParsed.error === 'required') {
      // The merchant must choose a deposit. The pre-R7 create_service /
      // update_service RPC (p_deposit_amount NUMERIC) rejects NULL, so a truly
      // "unset" deposit cannot be persisted yet -- that is BLOCKED_R7. Do not
      // substitute 0 or a seed value.
      setManagementError(t('depositMustBeSet'));
      return;
    }
    if (durationParsed.error || priceParsed.error || depositParsed.error) {
      setManagementError(t('numericFieldInvalid'));
      return;
    }
    const duration = durationParsed.value as number;
    const price = priceParsed.value as number;
    const deposit = depositParsed.value as number;

    if (deposit > price) {
      setManagementError(t('depositExceedsPrice'));
      return;
    }

    // Duration is any positive integer minute on the client (Amendment A1). The
    // pre-R7 create_service / update_service RPC still rejects non-multiples of
    // 15; that server compatibility limitation is surfaced transparently in the
    // catch below. Removing the RPC rule and proving arbitrary minutes is
    // BLOCKED_R7.

    const input = {
      name: serviceName.trim(),
      description: serviceDesc.trim(),
      duration,
      price,
      deposit,
    };

    setMutatingResourceId(editingService?.id ?? 'service-new');
    setManagementError('');
    try {
      if (editingService) {
        await updateService(editingService.id, input);
      } else {
        await createService(shopId, input);
      }

      setShowServiceForm(false);
      setEditingService(null);
      await loadDashboardBookings(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('saveServiceFailed');
      // Translate only the exact known pre-R7 server limitation into a
      // transparent compatibility message; surface everything else raw.
      setManagementError(
        message.includes('multiple of 15 minutes') ? t('durationServerLimit') : message,
      );
    } finally {
      setMutatingResourceId(null);
    }
  };

  const handleToggleService = async (service: ServiceItem) => {
    setMutatingResourceId(service.id);
    setManagementError('');
    try {
      await setServiceActive(service.id, !service.isActive);
      await loadDashboardBookings(false);
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : t('toggleServiceFailed'));
    } finally {
      setMutatingResourceId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      {/* Main Header Nav */}
      <header className="bg-slate-900/80 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md px-6 py-3.5">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-lg">
              Q
            </div>
            <div>
              <h1 className="font-bold text-base text-white">{t('shopNameDashboard', { shopName })}</h1>
              <p className="text-[11px] text-slate-400">{t('phonePrefix')}{shopPhone || '-'}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <nav className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs overflow-x-auto">
              <button
                onClick={() => setActiveTab('bookings')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${activeTab === 'bookings' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'}`}
              >
                {t('tabAllBookings')}
              </button>
              {shopRole !== 'staff' && <button
                onClick={() => setActiveTab('schedules')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${activeTab === 'schedules' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'}`}
              >
                {t('tabSchedules')}
              </button>}
              {shopRole !== 'staff' && <button
                onClick={() => setActiveTab('staff')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${activeTab === 'staff' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'}`}
              >
                {t('tabStaff')}
              </button>}
              {shopRole !== 'staff' && <button
                onClick={() => setActiveTab('services')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${activeTab === 'services' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'}`}
              >
                {t('tabServices')}
              </button>}
              {shopRole !== 'staff' && <button
                onClick={() => setActiveTab('settings')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${activeTab === 'settings' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'}`}
              >
                {t('tabSettings')}
              </button>}
              {shopRole === 'owner' && <button
                onClick={() => setActiveTab('billing')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${activeTab === 'billing' ? 'bg-amber-400 text-slate-950 font-bold' : 'text-amber-400 hover:text-amber-300'}`}
              >
                {t('tabBilling')}
              </button>}
              {shopRole !== 'staff' && <Link
                href="/dashboard/tickets"
                className="px-3 py-1.5 rounded-lg font-medium transition-all text-slate-400 hover:text-white"
              >
                {t('tabTickets')}
              </Link>}
            </nav>
            {shopSlug && (
              <a
                href={`${BOOKING_SITE_URL}/book/${shopSlug}`}
                target="_blank"
                rel="noreferrer"
                className="hidden sm:flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-slate-700"
                title={t('previewCustomerPage')}
              >
                <Eye className="w-3.5 h-3.5" />
                {t('previewCustomerPage')}
              </a>
            )}
            <LanguageToggle />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto w-full px-6 py-8 flex-1">
        {/* KPI Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">{t('statToday', { date: todayStr })}</span>
              <Calendar className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-bold text-white">{t('countItems', { count: totalToday })}</p>
          </div>

          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-4">
            <div className="flex items-center justify-between text-emerald-400 mb-2">
              <span className="text-xs font-medium">{t('statUpcoming')}</span>
              <Clock className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-bold text-emerald-400">{t('countItems', { count: totalUpcoming })}</p>
          </div>

          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-4">
            <div className="flex items-center justify-between text-amber-400 mb-2">
              <span className="text-xs font-medium">{t('statPendingSlip')}</span>
              <AlertCircle className="w-4 h-4" />
            </div>
            <p className="text-2xl font-bold text-amber-400">{t('countItems', { count: pendingDeposit })}</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">{t('statDepositCollected')}</span>
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-bold text-white font-mono">฿{depositCollected}.00</p>
          </div>
        </div>

        {/* Readiness checklist (KMO-03) — derived, non-blocking */}
        {activeTab === 'bookings' && shopRole !== 'staff' && !isBookingsLoading && (
          <div className="mb-6 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  {t('readinessTitle')}
                </h2>
                <p className="text-[11px] text-slate-400">
                  {isShopReady(readinessRows)
                    ? t('readinessAllSet')
                    : needsMerchantAttention(readinessRows)
                      ? t('readinessSubtitle')
                      : t('readinessMerchantDoneBlockedR7')}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {readinessRows.map((row) => row.status === 'blocked_r7' ? (
                <div
                  key={row.key}
                  role="status"
                  title={t('readinessBlockedR7Hint')}
                  className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-slate-600 bg-slate-800/60 px-3 py-2 text-xs font-medium text-slate-300"
                >
                  <span>{readinessLabel[row.key]}</span>
                  <span className="flex-shrink-0 rounded-md border border-slate-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-400">
                    {t('readinessBlockedR7')}
                  </span>
                </div>
              ) : (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => {
                    const tab = readinessTabFor[row.key];
                    if (tab) setActiveTab(tab);
                  }}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
                    row.ok
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                  }`}
                >
                  <span>{readinessLabel[row.key]}</span>
                  {row.ok ? <Check className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* TAB 1: BOOKINGS & SLIP APPROVAL WITH DATE FILTER */}
        {activeTab === 'bookings' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            {bookingError && (
              <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
                <span>{bookingError}</span>
                <button onClick={() => void loadDashboardBookings()} className="rounded-lg border border-rose-500/40 px-3 py-1 font-bold hover:bg-rose-500/10">
                  {t('retry')}
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-base font-bold text-white">{t('bookingsTitle')}</h2>
                <p className="text-xs text-slate-400">{t('bookingsSubtitle')}</p>
              </div>

              {/* Date View Filters */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                  <button
                    onClick={() => setBookingFilter('all')}
                    className={`px-2.5 py-1 rounded-lg font-medium ${bookingFilter === 'all' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400'}`}
                  >
                    {t('filterAll', { count: bookings.length })}
                  </button>
                  <button
                    onClick={() => setBookingFilter('today')}
                    className={`px-2.5 py-1 rounded-lg font-medium ${bookingFilter === 'today' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400'}`}
                  >
                    {t('filterToday', { count: totalToday })}
                  </button>
                  <button
                    onClick={() => setBookingFilter('upcoming')}
                    className={`px-2.5 py-1 rounded-lg font-medium ${bookingFilter === 'upcoming' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400'}`}
                  >
                    {t('filterUpcoming', { count: totalUpcoming })}
                  </button>
                </div>

                <a
                  href={shopSlug ? `${BOOKING_SITE_URL}/book/${shopSlug}` : '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-slate-800 hover:bg-slate-700 text-xs text-emerald-400 px-3 py-2 rounded-xl flex items-center gap-1.5 border border-slate-700 font-medium"
                >
                  {t('customerBookingPage')}
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-300 uppercase text-xs tracking-wider font-bold">
                    <th className="py-3.5 px-4">{t('thBookingCode')}</th>
                    <th className="py-3.5 px-4">{t('thService')}</th>
                    <th className="py-3.5 px-4">{t('thStaff')}</th>
                    <th className="py-3.5 px-4">{t('thDate')}</th>
                    <th className="py-3.5 px-4">{t('thTime')}</th>
                    <th className="py-3.5 px-4">{t('thDeposit')}</th>
                    <th className="py-3.5 px-4">{t('thStatus')}</th>
                    <th className="py-3.5 px-4 text-right">{t('thActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-sm">
                  {isBookingsLoading && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">{t('loadingBookings')}</td>
                    </tr>
                  )}

                  {!isBookingsLoading && !bookingError && filteredBookings.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">{t('noBookings')}</td>
                    </tr>
                  )}

                  {filteredBookings.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-800/40 transition-all">
                      <td className="py-4 px-4">
                        <p className="font-mono font-bold text-emerald-400 text-sm">{b.bookingCode}</p>
                        <p className="font-bold text-white text-base">{b.customerName}</p>
                        <p className="text-xs text-slate-400">{b.phone}</p>
                      </td>
                      <td className="py-4 px-4 font-semibold text-slate-200 text-sm">{b.serviceName}</td>
                      <td className="py-4 px-4 text-slate-300 font-medium text-sm">{b.staffName}</td>
                      <td className="py-4 px-4 font-mono font-semibold text-slate-200 text-sm whitespace-nowrap">
                        {b.date} {b.date === todayStr ? <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-sans ml-1">{t('todayLabel')}</span> : ''}
                      </td>
                      <td className="py-4 px-4 font-mono text-emerald-300 font-bold text-sm whitespace-nowrap">{b.time}{t('timeSuffix')}</td>
                      <td className="py-4 px-4 font-mono font-extrabold text-amber-400 text-base whitespace-nowrap">฿{b.depositPrice}</td>
                      <td className="py-4 px-4 whitespace-nowrap">
                        {b.status === 'hold' && (
                          <span className="bg-sky-500/10 text-sky-300 border border-sky-500/30 px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap inline-block shadow-sm">
                            {t('statusHold')}
                          </span>
                        )}
                        {b.status === 'pending_review' && (
                          <span className="bg-amber-500/10 text-amber-300 border border-amber-500/30 px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap inline-block shadow-sm">
                            {t('statusPendingReview')}
                          </span>
                        )}
                        {b.status === 'confirmed' && (
                          <span className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap inline-block shadow-sm">
                            {t('statusConfirmed')}
                          </span>
                        )}
                        {b.status === 'completed' && (
                          <span className="bg-blue-500/10 text-blue-300 border border-blue-500/30 px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap inline-block shadow-sm">
                            {t('statusCompleted')}
                          </span>
                        )}
                        {b.status === 'cancelled' && (
                          <span className="bg-rose-500/10 text-rose-300 border border-rose-500/30 px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap inline-block shadow-sm">
                            {t('statusCancelled')}
                          </span>
                        )}
                        {b.status === 'no_show' && (
                          <span className="bg-purple-500/10 text-purple-300 border border-purple-500/30 px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap inline-block shadow-sm">
                            {t('statusNoShow')}
                          </span>
                        )}
                        {b.status === 'expired' && (
                          <span className="bg-slate-500/10 text-slate-400 border border-slate-500/30 px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap inline-block shadow-sm">
                            {t('statusExpired')}
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {b.status === 'pending_review' && (
                            <button
                              onClick={async () => {
                                setSelectedSlipBooking(b);
                                setSignedSlipUrl(null);
                                if (b.slipObjectPath) {
                                  try {
                                    setSignedSlipUrl(await createSignedDepositSlipUrl(b.slipObjectPath));
                                  } catch (error) {
                                    setBookingError(error instanceof Error ? error.message : t('slipNoUrl'));
                                  }
                                }
                              }}
                              disabled={mutatingBookingId === b.id}
                              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1 shadow-md"
                            >
                              <Eye className="w-4 h-4" />
                              {t('viewSlip')}
                            </button>
                          )}
                          {b.status !== 'cancelled' && b.status !== 'completed' && b.status !== 'expired' && (
                            <button
                              onClick={() => {
                                setCancelBookingTarget(b);
                                setCancelReason('');
                              }}
                              disabled={mutatingBookingId === b.id}
                              className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 px-3 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1 transition-all"
                              title={t('cancelQueue')}
                            >
                              <X className="w-3.5 h-3.5" />
                              {t('cancelQueue')}
                            </button>
                          )}
                          {b.status === 'confirmed' && shopRole !== 'staff' && (
                            <>
                              <button type="button" onClick={() => handleBookingOutcome(b.id, 'completed')}
                                disabled={mutatingBookingId === b.id}
                                className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/30 px-3 py-1.5 rounded-lg font-semibold text-xs">
                                {t('markCompleted')}
                              </button>
                              <button type="button" onClick={() => handleBookingOutcome(b.id, 'no_show')}
                                disabled={mutatingBookingId === b.id}
                                className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-lg font-semibold text-xs">
                                {t('markNoShow')}
                              </button>
                            </>
                          )}
                          {b.status === 'cancelled' && (
                            <span className="text-slate-500 text-xs italic">{t('cancelledNote')}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: SCHEDULES & SHOP HOLIDAYS */}
        {activeTab === 'schedules' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Clock className="w-5 h-5 text-emerald-400" />
                  {t('schedulesTitle')}
                </h2>
                {dirtyStaffIds.size > 0 && (shopRole === 'owner' || shopRole === 'admin') && (
                  <button
                    type="button"
                    onClick={handleSaveAllSchedules}
                    disabled={mutatingResourceId === 'schedules-all'}
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {mutatingResourceId === 'schedules-all'
                      ? tCommon('saving')
                      : t('saveAllSchedules', { count: dirtyStaffIds.size })}
                  </button>
                )}
              </div>
              {dirtyStaffIds.size > 0 && (
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                  {t('unsavedSchedulesNote')}
                </p>
              )}

              {managementError && (
                <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">{managementError}</p>
              )}
              {shopRole === 'staff' && (
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  {t('scheduleStaffNote')}
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {schedules.map((sch) => {
                  const selectedDayNumber = selectedScheduleDays[sch.staffId] ?? 0;
                  const selectedDay = sch.days.find((day) => day.dayOfWeek === selectedDayNumber) ?? sch.days[0];
                  if (!selectedDay) return null;
                  const canManageSchedules = shopRole === 'owner' || shopRole === 'admin';
                  const isDirty = dirtyStaffIds.has(sch.staffId);
                  return (
                  <div key={sch.staffId} className={`bg-slate-950 border rounded-2xl p-4 text-xs space-y-3 shadow-md transition-all ${isDirty ? 'border-amber-500/50' : 'border-slate-800 hover:border-slate-700'}`}>
                    <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
                      <span className="font-bold text-sm text-emerald-400">{sch.staffName}</span>
                      {isDirty
                        ? <span className="text-[10px] font-bold text-amber-400">{t('unsavedBadge')}</span>
                        : <span className="text-[10px] text-slate-500">{t('workingDays', { count: sch.days.filter((day) => day.isWorkingDay).length })}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {DAY_NAMES.map((dayName, dayOfWeek) => {
                        const day = sch.days.find((item) => item.dayOfWeek === dayOfWeek);
                        return (
                          <button key={dayName} type="button" onClick={() => setSelectedScheduleDays((previous) => ({ ...previous, [sch.staffId]: dayOfWeek }))}
                            className={`rounded-md border px-1.5 py-1 text-[10px] ${selectedDayNumber === dayOfWeek ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300' : day?.isWorkingDay ? 'border-slate-700 text-slate-300' : 'border-rose-500/30 text-rose-300'}`}>
                            {dayName.slice(0, 2)}
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-3">
                      <label className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300">
                        <span>{t('isWorkingDay', { day: DAY_NAMES[selectedDay.dayOfWeek] })}</span>
                        <input type="checkbox" checked={selectedDay.isWorkingDay} disabled={!canManageSchedules}
                          onChange={(event) => updateScheduleDay(sch.staffId, selectedDay.dayOfWeek, { isWorkingDay: event.target.checked })} />
                      </label>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">{t('workTimeLabel')}</label>
                        <div className="flex items-center gap-1.5">
                          <TimeField value={selectedDay.workStart} disabled={!canManageSchedules || !selectedDay.isWorkingDay}
                            ariaLabel={t('workTimeLabel')}
                            onChange={(v) => updateScheduleDay(sch.staffId, selectedDay.dayOfWeek, { workStart: v })}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white font-mono text-center focus:outline-none focus:border-emerald-500 font-bold"
                          />
                          <span className="text-slate-500 text-[10px]">{t('to')}</span>
                          <TimeField value={selectedDay.workEnd} disabled={!canManageSchedules || !selectedDay.isWorkingDay}
                            ariaLabel={t('workTimeLabel')}
                            onChange={(v) => updateScheduleDay(sch.staffId, selectedDay.dayOfWeek, { workEnd: v })}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white font-mono text-center focus:outline-none focus:border-emerald-500 font-bold"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-amber-400 block mb-1 flex items-center gap-1">
                          <Coffee className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" /> {t('breakLabel')}
                        </label>
                        <div className="flex items-center gap-1.5">
                          <TimeField value={selectedDay.breakStart} disabled={!canManageSchedules || !selectedDay.isWorkingDay}
                            ariaLabel={t('breakLabel')}
                            onChange={(v) => updateScheduleDay(sch.staffId, selectedDay.dayOfWeek, { breakStart: v })}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white font-mono text-center focus:outline-none focus:border-amber-500 font-bold"
                          />
                          <span className="text-slate-500 text-[10px]">{t('to')}</span>
                          <TimeField value={selectedDay.breakEnd} disabled={!canManageSchedules || !selectedDay.isWorkingDay}
                            ariaLabel={t('breakLabel')}
                            onChange={(v) => updateScheduleDay(sch.staffId, selectedDay.dayOfWeek, { breakEnd: v })}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white font-mono text-center focus:outline-none focus:border-amber-500 font-bold"
                          />
                        </div>
                      </div>
                    </div>
                    {canManageSchedules && (
                      <button type="button" onClick={() => handleSaveSchedule(sch)} disabled={mutatingResourceId === sch.staffId}
                        className="w-full rounded-xl bg-emerald-500 py-2 font-bold text-slate-950 disabled:opacity-50">
                        {mutatingResourceId === sch.staffId ? tCommon('saving') : t('saveWeek')}
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <CalendarOff className="w-5 h-5 text-rose-400" />
                  {t('holidaysTitle')}
                </h2>
                <p className="text-xs text-slate-400">{t('holidaysSubtitle')}</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
                {/* LEFT COLUMN: ADD HOLIDAY FORM */}
                <div className="lg:col-span-5 bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-md">
                  <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                    <Plus className="w-4 h-4 text-rose-400" /> {t('addHoliday')}
                  </span>

                  <form onSubmit={handleAddHoliday} className="space-y-4">
                    <div>
                      <label className="text-xs text-slate-300 block mb-1 font-semibold">
                        {t('holidayDateLabel')}
                      </label>
                      <input
                        required
                        type="date"
                        disabled={shopRole === 'staff'}
                        value={specialHolidayDate}
                        onChange={(e) => setSpecialHolidayDate(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-rose-400 font-bold focus:outline-none focus:border-rose-500"
                      />
                      <p className="text-[10px] text-rose-400/80 font-mono mt-1">{t('holidayDateHint')}</p>
                    </div>

                    <div>
                      <label className="text-xs text-slate-300 block mb-1 font-semibold">{t('holidayReasonLabel')}</label>
                      <input
                        type="text"
                        disabled={shopRole === 'staff'}
                        placeholder={t('holidayReasonPlaceholder')}
                        value={specialHolidayReason}
                        onChange={(e) => setSpecialHolidayReason(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500 font-medium"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={shopRole === 'staff' || mutatingResourceId === 'holiday-new'}
                      className="w-full bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus className="w-4 h-4" />
                      {t('addHolidayBtn')}
                    </button>
                  </form>
                </div>

                {/* RIGHT COLUMN: HOLIDAYS LIST */}
                <div className="lg:col-span-7 bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-md flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                      <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <CalendarOff className="w-4 h-4 text-rose-400" /> {t('holidayList', { count: holidaysList.length })}
                      </span>
                    </div>

                    {holidaysList.length === 0 ? (
                      <div className="text-center py-8 text-slate-500 text-xs">
                        <CalendarOff className="w-8 h-8 mx-auto mb-2 opacity-30 text-rose-400" />
                        <p>{t('noHolidays')}</p>
                      </div>
                    ) : (
                      <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                        {holidaysList.map((h) => (
                          <div key={h.id} className="flex justify-between items-center bg-slate-900 border border-rose-500/30 rounded-xl p-3 text-xs hover:border-rose-500/60 transition-all shadow-sm">
                            <div className="flex items-center gap-3">
                              <span className="bg-rose-500/10 text-rose-400 border border-rose-500/30 font-mono font-bold px-2.5 py-1 rounded-lg text-xs">
                                📅 {h.date}
                              </span>
                              <span className="text-slate-200 font-semibold">{h.reason || t('annualCloseDefault')}</span>
                            </div>
                            <button
                              onClick={() => handleDeleteHoliday(h.id)}
                              disabled={shopRole === 'staff' || mutatingResourceId === h.id}
                              className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-slate-800 transition-all disabled:cursor-not-allowed disabled:opacity-40"
                              title={t('deleteHolidayTitle')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <p className="text-[10px] text-slate-500 border-t border-slate-800/80 pt-2">
                    {t('holidayAutoClose')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: STAFF MANAGEMENT */}
        {activeTab === 'staff' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            {managementError && (
              <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">{managementError}</p>
            )}
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-xs text-emerald-300 space-y-1">
              <div className="flex items-center gap-2 font-bold text-sm">
                <Users className="w-4 h-4 text-emerald-400" />
                {t('staffSectionTitle')}
              </div>
              <p className="text-slate-300">
                {t('staffSectionSubtitle')}
              </p>
            </div>

            {shopRole === 'owner' ? (
            <form onSubmit={handleAddStaff} className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[180px]">
                <label className="text-xs text-slate-300 block mb-1">{t('staffNameLabel')}</label>
                <input
                  required
                  type="text"
                  placeholder={t('staffNamePlaceholder')}
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="flex-1 min-w-[150px]">
                <label className="text-xs text-slate-300 block mb-1">{t('staffPhoneLabel')}</label>
                <input
                  type="tel"
                  placeholder="08X-XXX-XXXX"
                  value={newStaffPhone}
                  onChange={(e) => setNewStaffPhone(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                type="submit"
                disabled={mutatingResourceId === 'staff-new'}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1 shadow-md"
              >
                <Plus className="w-4 h-4" />
                {mutatingResourceId === 'staff-new' ? t('adding') : t('addStaff')}
              </button>
            </form>
            ) : (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">{t('ownerOnlyStaff')}</p>
            )}

            <div className="space-y-3">
              {staffList.length === 0 && <p className="py-8 text-center text-xs text-slate-500">{t('noStaff')}</p>}
              {staffList.map((st) => (
                <div key={st.id} className="flex justify-between items-center bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs">
                  <div>
                    <p className="font-bold text-sm text-white">{st.name}</p>
                    <p className="text-slate-400 text-[11px]">{st.role} {t('contactPrefix')}{st.phone}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {shopRole === 'owner' && (
                      <button type="button" onClick={() => handleLinkStaffUser(st)}
                        disabled={mutatingResourceId === `link-${st.id}`}
                        className="px-3 py-1 rounded-lg font-semibold text-[11px] border border-sky-500/30 text-sky-300 disabled:opacity-50">
                        {t('linkStaffLogin')}
                      </button>
                    )}
                    <button
                      onClick={() => void toggleStaffActive(st)}
                      disabled={shopRole !== 'owner' || mutatingResourceId === st.id}
                      className={`px-3 py-1 rounded-lg font-semibold text-[11px] border ${
                        st.isActive ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >
                      {mutatingResourceId === st.id ? tCommon('saving') : st.isActive ? t('staffReady') : t('staffOff')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: SHOP PROFILE & SERVICES MANAGER */}
        {activeTab === 'services' && (
          <div className="space-y-6">
            {managementError && (
              <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">{managementError}</p>
            )}
            {/* SECTION 1: SHOP PROFILE EDITING */}
            <form onSubmit={handleSaveShopSettings} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Store className="w-5 h-5 text-emerald-400" />
                    {t('servicesTitle')}
                  </h2>
                  <p className="text-xs text-slate-400">{t('servicesSubtitle')}</p>
                </div>
                <button
                  type="submit"
                  disabled={shopRole !== 'owner' || mutatingResourceId === 'shop-settings'}
                  className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-md"
                >
                  <Save className="w-4 h-4" />
                  {shopRole !== 'owner'
                    ? t('ownerOnlyEdit')
                    : mutatingResourceId === 'shop-settings'
                      ? tCommon('saving')
                      : shopSettingsSaved ? tCommon('saved') : t('saveShop')}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">{t('shopNameLabel')}</label>
                  <input
                    required
                    type="text"
                    disabled={shopRole !== 'owner'}
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">{t('shopAddressLabel')}</label>
                  <input
                    type="text"
                    disabled={shopRole !== 'owner'}
                    value={shopAddress}
                    onChange={(e) => setShopAddress(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="text-slate-300 block mb-1 font-semibold text-emerald-400">{t('shopPhoneLabel')}</label>
                  <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-emerald-400 font-mono font-bold">
                    <Phone className="w-3.5 h-3.5 text-emerald-400 mr-1.5 flex-shrink-0" />
                    <input
                      required
                      type="tel"
                      disabled={shopRole !== 'owner'}
                      value={shopPhone}
                      onChange={(e) => setShopPhone(e.target.value)}
                      className="w-full bg-transparent border-none text-emerald-400 font-mono font-bold focus:outline-none ml-0.5 disabled:opacity-60"
                    />
                  </div>
                </div>
              </div>

              {/* READ-ONLY SHOP URL LINK BAR WITH COPY BUTTON */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span className="text-slate-400">{t('shopLinkLabel')}</span>
                  <span className="font-mono text-emerald-400 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    {BOOKING_SITE_URL}/book/{shopSlug}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyShopLink}
                  className="bg-slate-800 hover:bg-slate-700 text-emerald-400 font-bold px-3 py-1.5 rounded-lg border border-slate-700 text-xs flex items-center gap-1.5 shadow-sm"
                >
                  {copiedLinkNotice ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedLinkNotice ? t('copiedLink') : t('copyLink')}
                </button>
              </div>
            </form>

            {/* SECTION 2: SERVICES MANAGER */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
              <div className="flex flex-wrap justify-between items-center gap-4 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Scissors className="w-5 h-5 text-emerald-400" />
                    {t('servicesOfferingTitle')}
                  </h2>
                  <p className="text-xs text-slate-400">{t('servicesOfferingSubtitle')}</p>
                </div>
                <button
                  onClick={handleOpenAddService}
                  disabled={shopRole === 'staff'}
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-md"
                >
                  <Plus className="w-4 h-4" />
                  {shopRole === 'staff' ? t('noPermissionServices') : t('addService')}
                </button>
              </div>

              {/* Service Form Modal / Dropdown */}
              {showServiceForm && (
                <form onSubmit={handleSaveService} className="bg-slate-950 border border-emerald-500/40 rounded-2xl p-5 space-y-4 shadow-2xl animate-fade-in">
                  <h3 className="font-bold text-sm text-emerald-400 flex items-center gap-2 border-b border-slate-800 pb-2">
                    {editingService ? <Edit3 className="w-4 h-4 text-emerald-400" /> : <Plus className="w-4 h-4 text-emerald-400" />}
                    {editingService ? t('editServiceTitle') : t('addServiceTitle')}
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="text-slate-300 block mb-1 font-semibold">{t('serviceNameLabel')}</label>
                      <input
                        required
                        type="text"
                        placeholder={t('serviceNamePlaceholder')}
                        value={serviceName}
                        onChange={(e) => setServiceName(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="text-slate-300 block mb-1 font-semibold">{t('serviceDescLabel')}</label>
                      <input
                        type="text"
                        placeholder={t('serviceDescPlaceholder')}
                        value={serviceDesc}
                        onChange={(e) => setServiceDesc(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="text-slate-300 block mb-1 font-semibold">{t('serviceDurationLabel')}</label>
                      <input
                        required
                        type="number"
                        min={1}
                        step={5}
                        value={serviceDuration}
                        onChange={(e) => setServiceDuration(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="text-slate-300 block mb-1 font-semibold">{t('servicePriceLabel')}</label>
                      <input
                        required
                        type="number"
                        min={0}
                        value={servicePrice}
                        onChange={(e) => setServicePrice(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 font-mono text-emerald-400 font-bold focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="text-slate-300 block mb-1 font-semibold text-amber-400">{t('serviceDepositLabel')}</label>
                      <input
                        required
                        type="number"
                        min={0}
                        value={serviceDeposit}
                        onChange={(e) => setServiceDeposit(e.target.value)}
                        className="w-full bg-slate-900 border border-amber-500/40 rounded-xl px-3 py-2 font-mono text-amber-400 font-bold focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setShowServiceForm(false)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-4 py-2 rounded-xl text-xs"
                    >
                      {tCommon('cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={mutatingResourceId === (editingService?.id ?? 'service-new')}
                      className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs shadow-md"
                    >
                      {mutatingResourceId === (editingService?.id ?? 'service-new') ? tCommon('saving') : editingService ? t('saveChanges') : t('saveService')}
                    </button>
                  </div>
                </form>
              )}

              {/* Service Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {services.length === 0 && <p className="py-8 text-center text-xs text-slate-500 md:col-span-2">{t('noServices')}</p>}
                {services.map((sv) => (
                  <div key={sv.id} className={`bg-slate-950 border rounded-xl p-5 space-y-3 transition-all ${sv.isActive ? 'border-slate-800 hover:border-slate-700' : 'border-slate-800 opacity-60'}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-sm text-white">{sv.name}</h3>
                        {!sv.isActive && <span className="mt-1 inline-block rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">{t('serviceClosed')}</span>}
                        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{sv.description}</p>
                      </div>
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20 font-mono">
                        ฿{sv.price}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs border-t border-slate-800/80 pt-3">
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-slate-500" /> {t('durationMinutes', { minutes: sv.duration })}</span>
                        <span className="text-amber-400 font-semibold">{t('depositPrefix')}{sv.deposit == null ? t('depositNotSet') : `฿${sv.deposit}`}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenEditService(sv)}
                          disabled={shopRole === 'staff' || mutatingResourceId === sv.id}
                          className="text-slate-400 hover:text-emerald-400 p-1 rounded transition-all"
                          title={t('editServiceTitleBtn')}
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => void handleToggleService(sv)}
                          disabled={shopRole === 'staff' || mutatingResourceId === sv.id}
                          className={`p-1 rounded transition-all ${sv.isActive ? 'text-slate-500 hover:text-rose-400' : 'text-slate-500 hover:text-emerald-400'}`}
                          title={sv.isActive ? t('serviceOff') : t('serviceOn')}
                        >
                          {sv.isActive ? <Trash2 className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: PROMPTPAY & LINE OA SETTINGS */}
        {activeTab === 'settings' && (
          <form
            onSubmit={handleSaveShopSettings}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6"
          >
            <div className="flex flex-wrap justify-between items-center gap-4 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-emerald-400" />
                  {t('settingsTitle')}
                </h2>
                <p className="text-xs text-slate-400">{t('settingsSubtitle')}</p>
              </div>
              <button
                type="submit"
                disabled={shopRole !== 'owner' || mutatingResourceId === 'shop-settings'}
                className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-md"
              >
                <Save className="w-4 h-4" />
                {shopRole !== 'owner'
                  ? t('ownerOnlyEdit')
                  : mutatingResourceId === 'shop-settings'
                    ? tCommon('saving')
                    : shopSettingsSaved ? tCommon('saved') : t('saveSettings')}
              </button>
            </div>

            {managementError && (
              <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">{managementError}</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-950 border border-emerald-500/30 rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <QrCode className="w-5 h-5 text-emerald-400" />
                  <h3 className="font-bold text-sm text-white">{t('settingsPromptpayTitle')}</h3>
                </div>

                <div>
                  <label className="text-xs text-slate-300 block mb-1 font-semibold">{t('promptpayNumberLabel')}</label>
                  <input
                    required
                    type="text"
                    disabled={shopRole !== 'owner'}
                    value={promptpayNumber}
                    onChange={(e) => setPromptpayNumber(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-emerald-400 font-bold focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-300 block mb-1 font-semibold">{t('promptpayNameLabel')}</label>
                  <input
                    required
                    type="text"
                    disabled={shopRole !== 'owner'}
                    value={promptpayName}
                    onChange={(e) => setPromptpayName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="bg-slate-950 border border-[#06C755]/30 rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <MessageCircle className="w-5 h-5 text-[#06C755]" />
                  <h3 className="font-bold text-sm text-white">{t('lineOaTitle')}</h3>
                </div>

                <div>
                  <label className="text-xs text-slate-300 block mb-1 font-semibold">
                    {t('lineOaIdLabel')}
                  </label>
                  <input
                    type="text"
                    placeholder={t('lineOaPlaceholder')}
                    disabled={shopRole !== 'owner'}
                    value={lineOaId}
                    onChange={(e) => setLineOaId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-[#06C755] font-bold focus:outline-none focus:border-[#06C755] disabled:opacity-60"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    {t('lineOaNote')}
                  </p>
                </div>

                <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-3.5 text-xs text-slate-300 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-400 text-[11px]">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    {t('lineCentralNotice')}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {t('lineCentralBody')}
                  </p>
                </div>
              </div>
            </div>
            {shopRole === 'owner' && (
              <section className="border-t border-slate-800 pt-5 space-y-3">
                <h3 className="font-bold text-sm text-white">{t('dataRightsTitle')}</h3>
                <p className="text-xs text-slate-400">{t('dataRightsBody')}</p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={handleDataExport} disabled={mutatingResourceId === 'data-export'}
                    className="border border-emerald-500/40 text-emerald-300 px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-50">
                    {t('exportCsv')}
                  </button>
                  <button type="button" onClick={handleAccountClosure} disabled={mutatingResourceId === 'account-closure'}
                    className="border border-rose-500/40 text-rose-300 px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-50">
                    {t('requestClosure')}
                  </button>
                </div>
              </section>
            )}
          </form>
        )}

        {/* TAB 6: Stripe billing data comes from the subscription record. */}
        {activeTab === 'billing' && (
          <div className="space-y-8 max-w-5xl mx-auto">
            <div className="text-center space-y-2">
              <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 px-3 py-1 rounded-full text-xs font-semibold">
                {t('billingBadge')}
              </span>
              <h2 className="text-2xl font-extrabold text-white">{t('billingTitle')}</h2>
              <p className="text-xs text-slate-400 max-w-xl mx-auto">
                {t('billingSubtitle')}
              </p>

              {shopRole === 'owner' && subscription && (
                <button
                  type="button"
                  onClick={handleManageBilling}
                  disabled={mutatingResourceId === 'billing-portal'}
                  className="mt-4 text-xs font-semibold text-emerald-400 hover:text-emerald-300 underline underline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {mutatingResourceId === 'billing-portal' ? t('openingBilling') : t('manageBilling')}
                </button>
              )}
            </div>

            {managementError && (
              <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300 max-w-xl mx-auto text-center">{managementError}</p>
            )}
            {billingLoadError && (
              <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300 max-w-xl mx-auto text-center">
                {t('billingLoadError')}
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-6 relative">
                <div className="space-y-4">
                  <div>
                    <h3 className="font-extrabold text-lg text-white">{t('subscriptionCurrent')}</h3>
                    <p className="mt-1 text-[11px] text-slate-400">{t('subscriptionOnlyOwner')}</p>
                  </div>

                  {isBookingsLoading ? (
                    <p className="text-xs text-slate-400">{t('loadingSubscription')}</p>
                  ) : shopRole !== 'owner' ? (
                    <p className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-400">{t('subscriptionOwnerOnlyNote')}</p>
                  ) : subscription ? (
                    <div className="space-y-3 text-xs text-slate-300">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400">{t('subscriptionPlan')}</span>
                        <span className="font-bold text-white">{getSubscriptionPlanLabel(subscription.plan, t)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400">{t('subscriptionStatus')}</span>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getSubscriptionStatusDetails(subscription.status, t).className}`}>
                          {getSubscriptionStatusDetails(subscription.status, t).label}
                        </span>
                      </div>
                      <div className="border-t border-slate-800 pt-3">
                        <p className="text-slate-400">{t('subscriptionPeriodEnd')}</p>
                        <p className="mt-1 font-semibold text-white">{formatSubscriptionDate(subscription.currentPeriodEnd, locale, t('subNoDate'))}</p>
                      </div>
                      {subscription.cancelAtPeriodEnd && (
                        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
                          {t('subscriptionCancelAtEnd')}
                        </p>
                      )}
                      {subscription.status === 'past_due' && (
                        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
                          {t('subscriptionPastDue')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                      {t('subscriptionNotFound')}
                    </p>
                  )}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 flex flex-col justify-between space-y-6 relative hover:border-slate-600 transition-all">
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-extrabold text-lg text-white">{t('planBasicHeader')}</h3>
                      <p className="text-[11px] text-slate-400">{t('planBasicMonthly')}</p>
                    </div>
                  </div>

                  <div className="text-3xl font-extrabold text-white font-mono">
                    ฿490 <span className="text-xs font-normal text-slate-400">{locale === 'th' ? '/เดือน' : '/month'}</span>
                  </div>

                  <p className="border-t border-slate-800 pt-4 text-xs leading-relaxed text-slate-400">
                    {t('planBasicDesc')}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => handleUpgrade('basic_490')}
                    disabled={shopRole !== 'owner' || isManagedSubscriptionPlan('basic_490') || mutatingResourceId === 'checkout-basic_490'}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl text-xs border border-slate-700 transition-all block text-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {mutatingResourceId === 'checkout-basic_490'
                      ? t('gotoBilling')
                      : isManagedSubscriptionPlan('basic_490')
                        ? t('currentPlan')
                        : t('chooseBasic')}
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border-2 border-emerald-500 rounded-2xl p-6 flex flex-col justify-between space-y-6 relative shadow-xl shadow-emerald-950/40">
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-extrabold text-lg text-white">{t('planProHeader')}</h3>
                      <p className="text-[11px] text-emerald-400 font-medium">{t('planProMonthly')}</p>
                    </div>
                  </div>

                  <div className="text-3xl font-extrabold text-emerald-400 font-mono">
                    ฿990 <span className="text-xs font-normal text-slate-400">{locale === 'th' ? '/เดือน' : '/month'}</span>
                  </div>

                  <p className="border-t border-slate-800 pt-4 text-xs leading-relaxed text-slate-400">
                    {t('planProDesc')}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => handleUpgrade('pro_990')}
                    disabled={shopRole !== 'owner' || isManagedSubscriptionPlan('pro_990') || mutatingResourceId === 'checkout-pro_990'}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl text-xs shadow-lg shadow-emerald-950/40 transition-all block text-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {mutatingResourceId === 'checkout-pro_990'
                      ? t('gotoBilling')
                      : isManagedSubscriptionPlan('pro_990')
                        ? t('currentPlan')
                        : t('choosePro')}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 text-left space-y-3">
              <div className="flex items-center gap-2 font-bold text-sm text-emerald-400">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                {t('stripeFooter')}
              </div>

              <p className="text-xs leading-relaxed text-slate-400">
                {t('stripeFooterBody')}
              </p>
            </div>
          </div>
        )}
      </main>

      {/* SLIP VERIFICATION MODAL */}
      {selectedSlipBooking && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl animate-fade-in relative">
            {/* Top Right Close Button */}
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">{t('slipTitle', { code: selectedSlipBooking.bookingCode })}</h3>
              <button
                onClick={() => { setSelectedSlipBooking(null); setSignedSlipUrl(null); }}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-all"
                title={t('slipCloseTitle')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="bg-slate-950 p-2 rounded-xl border border-slate-800 text-center relative">
              {signedSlipUrl ? (
                <img src={signedSlipUrl} alt="Deposit Slip" className="max-h-64 object-contain mx-auto rounded-lg" />
              ) : (
                <p className="py-10 text-xs text-rose-300">{t('slipNoUrl')}</p>
              )}
              <div className="mt-2 bg-emerald-500/10 border border-emerald-500/30 p-2 rounded text-[10px] text-emerald-400 font-medium">
                {t('slipAmountMatches', { amount: selectedSlipBooking.depositPrice })}
              </div>
            </div>

            <div className="text-xs space-y-1 text-slate-300">
              <p>{t('slipCustomer')}<span className="font-semibold text-white">{selectedSlipBooking.customerName}</span> ({selectedSlipBooking.phone})</p>
              <p>{t('slipService')}<span className="text-white">{selectedSlipBooking.serviceName}</span></p>
              <p>{t('slipAmountInSlip')}<span className="font-mono font-bold text-emerald-400">฿{selectedSlipBooking.depositPrice}.00</span></p>
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex gap-2">
                <button
                  onClick={() => handleRejectSlip(selectedSlipBooking.id)}
                  disabled={mutatingBookingId === selectedSlipBooking.id}
                  className="w-1/2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 font-bold py-2.5 rounded-xl text-xs transition-all"
                >
                  {t('rejectSlip')}
                </button>
                <button
                  onClick={() => handleApproveSlip(selectedSlipBooking.id)}
                  disabled={mutatingBookingId === selectedSlipBooking.id}
                  className="w-1/2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs shadow-lg transition-all"
                >
                  {t('approveConfirm')}
                </button>
              </div>

              <button
                type="button"
                onClick={() => { setSelectedSlipBooking(null); setSignedSlipUrl(null); }}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-semibold py-2 rounded-xl text-xs transition-all"
              >
                {t('closeNoChoice')}
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelBookingTarget && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-fade-in">
            <div>
              <h3 className="text-base font-bold text-white">{t('cancelTitle', { code: cancelBookingTarget.bookingCode })}</h3>
              <p className="mt-1 text-xs text-slate-400">{t('cancelSubtitle')}</p>
            </div>

            <textarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder={t('cancelPlaceholder')}
              rows={4}
              className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white outline-none focus:border-rose-500"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setCancelBookingTarget(null);
                  setCancelReason('');
                }}
                disabled={mutatingBookingId === cancelBookingTarget.id}
                className="w-1/2 rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-xs font-semibold text-slate-300 disabled:opacity-50"
              >
                {t('cancelBack')}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCancellation()}
                disabled={!cancelReason.trim() || mutatingBookingId === cancelBookingTarget.id}
                className="w-1/2 rounded-xl bg-rose-500 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mutatingBookingId === cancelBookingTarget.id ? t('cancelConfirming') : t('cancelConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
