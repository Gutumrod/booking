'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { 
  Calendar, Clock, User, CheckCircle2, QrCode, Upload, ShieldCheck, 
  ChevronRight, Sparkles, MessageCircle, AlertTriangle, Coffee, CalendarOff,
  Copy, Download, Check, ShieldAlert, Send, PhoneCall, Phone, RefreshCw, Loader2
} from 'lucide-react';
import {
  getShopBySlug, getShopServices, getShopStaff, getShopAvailability, createBookingHold,
  submitDepositSlip, uploadDepositSlip, Shop, Service, Staff, HoldResponse,
  StaffSchedule, ShopHoliday,
} from '../../../lib/booking-service';
import { LanguageToggle } from '@/components/language-toggle';
import { QRCodeSVG } from 'qrcode.react';
import { createPromptPayPayload } from '../../../lib/promptpay';

const CENTRAL_LINE_OA_ID = process.env.NEXT_PUBLIC_CENTRAL_LINE_OA_ID || 'central_booking_oa';

const ALL_TIME_SLOTS = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00'];
const thaiMobilePhonePattern = /^0[689]\d{8}$/;

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isValidThaiMobilePhone(value: string): boolean {
  return thaiMobilePhonePattern.test(value.replace(/[\s-]/g, ''));
}

export default function BookingPage() {
  const t = useTranslations('booking');
  const tc = useTranslations('common');
  const params = useParams();
  const slug = (params?.slug as string) || 'good-cuts-barber';

  const [shop, setShop] = useState<Shop | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [staffSchedules, setStaffSchedules] = useState<StaffSchedule[]>([]);
  const [shopHolidays, setShopHolidays] = useState<ShopHoliday[]>([]);
  const [isLoadingShop, setIsLoadingShop] = useState(true);

  const [step, setStep] = useState<number>(1);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedTime, setSelectedTime] = useState<string>('11:00');

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [copiedPromptpay, setCopiedPromptpay] = useState(false);
  const [savedQrNotice, setSavedQrNotice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [holdResult, setHoldResult] = useState<HoldResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const qrContainerRef = useRef<HTMLDivElement>(null);

  // 15-Minute Countdown Timer (900 seconds)
  const [timeLeft, setTimeLeft] = useState<number>(900);

  // Fetch shop, services, staff from Supabase
  useEffect(() => {
    async function loadData() {
      setIsLoadingShop(true);
      try {
        const shopData = await getShopBySlug(slug);
        if (shopData) {
          setShop(shopData);
          // Do not request booking resources for a shop that the public profile
          // explicitly marks as unavailable. The server-side RPC remains the
          // enforcement boundary; this only keeps the customer flow truthful.
          if (shopData.is_accepting_online_bookings === false) {
            return;
          }
          const [servicesData, staffData, availabilityData] = await Promise.all([
            getShopServices(shopData.id),
            getShopStaff(shopData.id),
            getShopAvailability(shopData.id),
          ]);
          setServices(servicesData);
          setStaffList(staffData);
          setStaffSchedules(availabilityData.schedules);
          setShopHolidays(availabilityData.holidays);
          if (servicesData.length > 0) setSelectedService(servicesData[0]);
        }
      } catch (error) {
        console.error('Error loading booking page data:', error);
        setShop(null);
      } finally {
        setIsLoadingShop(false);
      }
    }
    loadData();
  }, [slug]);

  useEffect(() => {
    return () => {
      if (slipPreview) URL.revokeObjectURL(slipPreview);
    };
  }, [slipPreview]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (step === 3 && !bookingSuccess && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft(prev => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [step, bookingSuccess, timeLeft]);

  const formatCountdown = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const promptpayNumber = shop?.promptpay_number || '0812345678';
  const promptpayName = shop?.promptpay_name || shop?.name || t('fallbackShopName');
  const shopPhone = shop?.phone?.trim() || t('shopPhoneMissing');
  const shopPhoneHref = shop?.phone?.trim()
    ? `tel:${shop.phone.replace(/-/g, '')}`
    : undefined;
  const isBookingBlocked = shop?.is_accepting_online_bookings === false;
  const depositAmount = selectedService?.deposit_amount ?? shop?.default_deposit_amount ?? 100;
  const promptpayPayload = useMemo(() => {
    try {
      return createPromptPayPayload({ recipient: promptpayNumber, amount: depositAmount });
    } catch {
      return null;
    }
  }, [promptpayNumber, depositAmount]);

  const handleCopyPromptpay = () => {
    setCopiedPromptpay(true);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(promptpayNumber.replace(/-/g, ''))
        .catch((error) => console.error('Error copying PromptPay number:', error));
    }
    setTimeout(() => setCopiedPromptpay(false), 2000);
  };

  const handleSaveQr = () => {
    const svg = qrContainerRef.current?.querySelector('svg');
    if (!svg) return;
    setSavedQrNotice(true);
    const qrData = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`;
    const link = document.createElement('a');
    link.href = qrData;
    link.download = `PromptPay-QR-Deposit-${depositAmount}THB.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => setSavedQrNotice(false), 2000);
  };

  const availableTimeSlots = useMemo(() => {
    const bookingDate = new Date(`${selectedDate}T00:00:00`);
    const dayOfWeek = bookingDate.getDay();
    const serviceDuration = selectedService?.duration_minutes || 0;
    const wholeShopHoliday = shopHolidays.find(
      holiday => holiday.staff_id === null && holiday.holiday_date === selectedDate
    );
    const toMinutes = (time: string) => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };

    return ALL_TIME_SLOTS.map(slotTime => {
      if (wholeShopHoliday) {
        return {
          time: slotTime,
          isAvailable: false,
          reason: wholeShopHoliday.reason || t('step2.shopClosed'),
        };
      }

      const slotStart = toMinutes(slotTime);
      const slotEnd = slotStart + serviceDuration;
      const candidateStaff = selectedStaff ? [selectedStaff] : staffList;
      const hasAvailableStaff = candidateStaff.some(staff => {
        const isStaffHoliday = shopHolidays.some(
          holiday => holiday.staff_id === staff.id && holiday.holiday_date === selectedDate
        );
        if (isStaffHoliday) return false;

        const schedule = staffSchedules.find(
          item => item.staff_id === staff.id && item.day_of_week === dayOfWeek
        );
        if (!schedule) return false;
        if (!schedule.is_working_day) return false;

        const outsideWorkingHours =
          slotStart < toMinutes(schedule.work_start) || slotEnd > toMinutes(schedule.work_end);
        const overlapsBreak = schedule.break_start && schedule.break_end
          ? slotStart < toMinutes(schedule.break_end) && slotEnd > toMinutes(schedule.break_start)
          : false;
        return !outsideWorkingHours && !overlapsBreak;
      });

      return {
        time: slotTime,
        isAvailable: hasAvailableStaff,
        reason: hasAvailableStaff ? t('step2.available') : t('step2.unavailable'),
      };
    });
  }, [selectedDate, selectedService, selectedStaff, shopHolidays, staffList, staffSchedules, t]);

  const selectedSlotAvailable = availableTimeSlots.some(
    slot => slot.time === selectedTime && slot.isAvailable
  );

  const handleCreateHold = async () => {
    if (shop?.is_accepting_online_bookings === false) {
      setErrorMessage(t('errors.shopBlocked'));
      return;
    }
    if (!shop || !selectedService || !customerName.trim() || !customerPhone.trim()) {
      setErrorMessage(t('errors.requiredNamePhone'));
      return;
    }
    if (!customerName.trim()) {
      setErrorMessage(t('errors.nameRequired'));
      return;
    }
    if (!customerPhone.trim()) {
      setErrorMessage(t('errors.phoneRequired'));
      return;
    }
    if (!isValidThaiMobilePhone(customerPhone)) {
      setErrorMessage(t('errors.phoneInvalid'));
      return;
    }
    if (!selectedSlotAvailable) {
      setErrorMessage(t('errors.slotUnavailable'));
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const res = await createBookingHold({
        shop_id: shop.id,
        service_id: selectedService.id,
        staff_id: selectedStaff?.id || null,
        customer_name: customerName,
        customer_phone: customerPhone,
        booking_date: selectedDate,
        start_time: selectedTime + ':00',
      }, {
        shopBlocked: t('errors.shopBlockedService'),
      });
      setHoldResult(res);
      if (res.status === 'confirmed' && res.deposit_status === 'not_required') {
        setBookingSuccess(true);
      } else if (res.status === 'hold' && res.deposit_status === 'awaiting') {
        setTimeLeft(900); // 15 mins
        setStep(3);
      } else {
        throw new Error(t('errors.invalidBookingStatus'));
      }
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err, t('errors.createHoldFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSlipFile(file);
      setSlipPreview(URL.createObjectURL(file));
    }
  };

  const handleCompleteBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holdResult || !slipFile) {
      setErrorMessage(t('errors.slipRequired'));
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const slipObjectPath = await uploadDepositSlip(holdResult.booking_id, holdResult.link_token, slipFile, {
        unsupportedType: t('errors.slipUnsupportedType'),
        tooLarge: t('errors.slipTooLarge'),
        urlFailed: t('errors.slipUrlFailed'),
      });
      await submitDepositSlip(holdResult.booking_id, holdResult.link_token, slipObjectPath);
      setBookingSuccess(true);
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err, t('errors.slipSubmitFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingShop) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mx-auto" />
          <p className="text-xs text-slate-400">{t('loadingShop')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between font-sans selection:bg-emerald-500 selection:text-white">
      <LanguageToggle variant="booking" />
      {/* Top Header Bar */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-900/80 border-b border-slate-800 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-sm">
              Q
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-wide text-white capitalize">{shop?.name || slug.replace(/-/g, ' ')}</h1>
              <p className="text-[10px] text-emerald-400 font-medium">{t('headerSubtitle')}</p>
            </div>
          </div>

          <a
            href={shopPhoneHref}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-emerald-400 font-semibold px-2.5 py-1 rounded-full border border-slate-700 flex items-center gap-1 transition-all"
            title={t('callShopTitle')}
          >
            <PhoneCall className="w-3 h-3" />
            <span className="hidden sm:inline">{tc('phonePrefix')} </span>{shopPhone}
          </a>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-md mx-auto w-full px-4 py-6 flex-1">
        {errorMessage && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 mb-4 text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {isBookingBlocked ? (
          <div className="bg-slate-900/90 border border-amber-500/40 rounded-2xl p-6 text-center shadow-xl shadow-amber-950/40 space-y-3">
            <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
              <CalendarOff className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-white">{t('blocked.title')}</h2>
            <p className="text-xs text-slate-400">{t('blocked.description')}</p>
            <a
              href={shopPhoneHref}
              className="inline-flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 py-3 px-4 rounded-xl font-bold text-xs border border-slate-700 transition-all"
            >
              <Phone className="w-4 h-4 text-emerald-400" />
              {t('callShop', { phone: shopPhone })}
            </a>
          </div>
        ) : bookingSuccess ? (
          /* CONFIRMED OR PENDING REVIEW STATE (PRODUCT_RULES_V1 SECTION 1.4) */
          <div className={`bg-slate-900/90 rounded-2xl p-6 text-center shadow-xl animate-fade-in space-y-5 ${
            holdResult?.status === 'confirmed'
              ? 'border border-emerald-500/40 shadow-emerald-950/40'
              : 'border border-amber-500/40 shadow-amber-950/40'
          }`}>
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto border ${
              holdResult?.status === 'confirmed'
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
            }`}>
              {holdResult?.status === 'confirmed'
                ? <CheckCircle2 className="w-10 h-10" />
                : <Clock className="w-10 h-10 animate-pulse" />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-1">
                {holdResult?.status === 'confirmed'
                  ? t('success.confirmedTitle')
                  : t('success.reviewTitle')}
              </h2>
              <p className="text-xs text-slate-400">{t('success.bookingCode')} <span className="font-mono text-emerald-400 font-bold">{holdResult?.booking_code || 'BK-7K2M9Q'}</span></p>
            </div>

            {/* Receipt Card for Customer */}
            <div className={`bg-slate-950 rounded-xl p-4 text-left space-y-2 relative overflow-hidden shadow-md border ${
              holdResult?.status === 'confirmed' ? 'border-emerald-500/30' : 'border-amber-500/30'
            }`}>
              <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-white flex items-center gap-1">
                  <Clock className="w-4 h-4 text-amber-400" /> {t('success.queueStatus')}
                </span>
                <span className={`text-[11px] px-2.5 py-0.5 rounded-md font-bold border ${
                  holdResult?.status === 'confirmed'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}>
                  {holdResult?.status === 'confirmed' ? t('success.statusConfirmed') : t('success.statusReview')}
                </span>
              </div>

              <div className="text-xs space-y-1.5 pt-1 text-slate-300">
                <p>{t('success.service')} <span className="font-semibold text-white">{selectedService?.name}</span></p>
                <p>{t('success.staff')} <span className="font-semibold text-white">{selectedStaff?.nickname || t('staff.random')}</span></p>
                <p>{t('success.appointment')} <span className="font-semibold text-emerald-400">{t('success.appointmentValue', { date: selectedDate, time: selectedTime })}</span></p>
                <p>{t('success.deposit')} <span className="font-semibold text-emerald-400 font-mono">
                  {holdResult?.deposit_status === 'not_required'
                    ? t('success.noDeposit')
                    : t('success.slipSubmitted', { amount: holdResult?.deposit_amount ?? 0 })}
                </span></p>
                <p className="text-slate-400 pt-1">{t('success.shopDirectPhone')} <a href={shopPhoneHref} className="font-mono font-bold text-amber-400 hover:underline">{shopPhone}</a></p>
              </div>
            </div>

            {/* Central LINE OA Binding Button */}
            <div className="space-y-2">
              <a
                href={`https://line.me/R/oaMessage/@${shop?.line_oa_id || CENTRAL_LINE_OA_ID}/?%E0%B8%9C%E0%B8%B9%E0%B8%81%E0%B8%84%E0%B8%B4%E0%B8%A7%20${holdResult?.booking_code}-${holdResult?.link_token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-[#06C755] hover:bg-[#05b34c] text-white py-3.5 px-4 rounded-xl font-bold text-sm flex flex-col items-center justify-center gap-0.5 shadow-lg shadow-emerald-950/50 transition-all text-center"
              >
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5 flex-shrink-0" />
                  <span>{t('success.lineCta')}</span>
                </div>
                <span className="text-[11px] font-normal text-emerald-100 opacity-90">{t('success.lineSubtext', { lineId: CENTRAL_LINE_OA_ID })}</span>
              </a>
              {holdResult && (
                <a
                  href={`/manage-booking?bookingId=${encodeURIComponent(holdResult.booking_id)}&token=${encodeURIComponent(holdResult.link_token)}`}
                  className="block w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-center text-xs font-semibold text-slate-100 hover:bg-slate-700"
                >
                  {t('success.manageBooking')}
                </a>
              )}

              <a
                href={shopPhoneHref}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border border-slate-700 transition-all"
              >
                <Phone className="w-4 h-4 text-emerald-400" />
                {t('callShopEmergency', { phone: shopPhone })}
              </a>
            </div>
          </div>
        ) : (
          <div>
            {/* STEP 1: SELECT SERVICE */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-white mb-1">{t('step1.title')}</h2>
                  <p className="text-xs text-slate-400">{t('step1.description')}</p>
                </div>

                <div className="space-y-3">
                  {services.map((sv) => (
                    <div
                      key={sv.id}
                      onClick={() => setSelectedService(sv)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                        selectedService?.id === sv.id
                          ? 'bg-slate-900 border-emerald-500 shadow-md shadow-emerald-950/30'
                          : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1.5">
                        <h3 className="font-semibold text-sm text-white">{sv.name}</h3>
                        <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          ฿{sv.price}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mb-3 leading-relaxed">{sv.description}</p>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-slate-500" /> {tc('durationMinutes', { minutes: sv.duration_minutes })}</span>
                        <span className="text-amber-400 font-medium">{t('step1.depositLabel', { amount: sv.deposit_amount ?? shop?.default_deposit_amount ?? 100 })}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  disabled={!selectedService}
                  onClick={() => setStep(2)}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition-all mt-6"
                >
                  {t('step1.next')}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* STEP 2: SELECT STAFF & TIME & CUSTOMER INFO */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-white mb-1">{t('step2.title')}</h2>
                  <p className="text-xs text-slate-400">{t('step2.selectedService')} <span className="text-emerald-400 font-medium">{selectedService?.name}</span></p>
                </div>

                {/* Customer Details Form */}
                <div className="space-y-3 bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
                  <p className="text-xs font-bold text-white">{t('step2.customerInfo')}</p>
                  <div>
                    <label className="text-xs text-slate-300 mb-1 block">{t('step2.nameLabel')}</label>
                    <input
                      required
                      type="text"
                      placeholder={t('step2.namePlaceholder')}
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300 mb-1 block">{t('step2.phoneLabel')}</label>
                    <input
                      required
                      type="tel"
                      placeholder={t('step2.phonePlaceholder')}
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* Staff Selection */}
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-2 block">{t('step2.staffLabel')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div
                      onClick={() => setSelectedStaff(null)}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        selectedStaff === null
                          ? 'bg-emerald-500/10 border-emerald-500 text-white font-bold'
                          : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <User className={`w-4 h-4 mb-1 ${selectedStaff === null ? 'text-emerald-400' : 'text-slate-500'}`} />
                      <p className="text-xs font-semibold">{t('step2.anyStaff')}</p>
                    </div>
                    {staffList.map((st) => (
                      <div
                        key={st.id}
                        onClick={() => setSelectedStaff(st)}
                        className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                          selectedStaff?.id === st.id
                            ? 'bg-emerald-500/10 border-emerald-500 text-white font-bold'
                            : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <User className={`w-4 h-4 mb-1 ${selectedStaff?.id === st.id ? 'text-emerald-400' : 'text-slate-500'}`} />
                        <p className="text-xs font-semibold">{st.nickname || st.name}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Date Selection */}
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-2 block">{t('step2.dateLabel')}</label>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Time Slot Display */}
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-2 block">{t('step2.timeLabel')}</label>
                  <div className="grid grid-cols-4 gap-2">
                    {availableTimeSlots.map((slot) => (
                      <button
                        key={slot.time}
                        type="button"
                        disabled={!slot.isAvailable}
                        onClick={() => slot.isAvailable && setSelectedTime(slot.time)}
                        className={`py-2 px-1 rounded-lg text-xs font-mono border transition-all text-center ${
                          selectedTime === slot.time && slot.isAvailable
                            ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold shadow-md'
                            : slot.isAvailable
                              ? 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                              : 'bg-slate-900/30 border-slate-900 text-slate-600 cursor-not-allowed line-through'
                      }`}
                    >
                        <div>{slot.time} {tc('timeSuffix')}</div>
                        <div className={`text-[9px] font-sans ${slot.isAvailable ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {slot.reason}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <button
                    onClick={() => setStep(1)}
                    className="w-1/3 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 py-3.5 rounded-xl text-xs font-semibold"
                  >
                    {tc('back')}
                  </button>
                  <button
                    disabled={isSubmitting || !customerName || !customerPhone || !selectedTime || !selectedSlotAvailable}
                    onClick={handleCreateHold}
                    className="w-2/3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('step2.locking')}
                      </>
                    ) : (
                      <>
                        {t('step2.next')}
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: PROMPTPAY DEPOSIT & SLIP UPLOAD */}
            {step === 3 && (
              <form onSubmit={handleCompleteBooking} className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-white mb-1">{t('step3.title')}</h2>
                  <p className="text-xs text-slate-400">{t('step3.description')}</p>
                </div>

                {/* 15-Minute Countdown Timer Banner */}
                {timeLeft > 0 ? (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-center space-y-1">
                    <div className="flex items-center justify-center gap-1.5 text-amber-300 font-bold text-xs">
                      <Clock className="w-4 h-4 text-amber-400 animate-pulse flex-shrink-0" />
                      <span>{t('step3.timer')} <span className="font-mono text-sm font-extrabold text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30">{formatCountdown(timeLeft)}</span> {t('step3.timerUnit')}</span>
                    </div>
                    <p className="text-[10px] text-slate-400">{t('step3.temporaryCode')} <span className="font-mono text-emerald-400 font-bold">{holdResult?.booking_code}</span></p>
                  </div>
                ) : (
                  <div className="bg-rose-500/20 border-2 border-rose-500/40 rounded-xl p-4 text-center space-y-2 animate-fade-in">
                    <div className="flex items-center justify-center gap-2 text-rose-300 font-extrabold text-xs">
                      <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
                      <span>{t('step3.expired')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs shadow-md transition-all mt-1 inline-flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-4 h-4" />
                      {t('step3.chooseNewSlot')}
                    </button>
                  </div>
                )}

                {/* PromptPay Card */}
                <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-4 text-center relative overflow-hidden space-y-3">
                  <div className="absolute top-0 right-0 bg-emerald-500 text-slate-950 text-[10px] font-bold px-3 py-0.5 rounded-bl-lg">
                    PromptPay QR
                  </div>
                  
                  <div className="pt-2">
                    <div ref={qrContainerRef} className="w-44 h-44 bg-white rounded-2xl p-2 mx-auto mb-2 flex items-center justify-center border border-slate-300 shadow-xl" aria-label={t('step3.promptpayQrAlt')}>
                      {promptpayPayload ? <QRCodeSVG value={promptpayPayload} size={160} level="M" /> : <AlertTriangle className="w-10 h-10 text-rose-500" />}
                    </div>
                    <button
                      type="button"
                      onPointerDown={() => setSavedQrNotice(true)}
                      onClick={handleSaveQr}
                      className="inline-flex items-center gap-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-emerald-400 px-3 py-1 rounded-lg border border-slate-700 font-medium"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {savedQrNotice ? t('step3.savedQr') : t('step3.saveQr')}
                    </button>
                  </div>

                  <div>
                    <p className="text-xs text-slate-400">{t('step3.depositAmountLabel')}</p>
                    <p className="text-2xl font-extrabold text-emerald-400 font-mono my-0.5">{tc('currencyAmount', { amount: selectedService?.deposit_amount ?? shop?.default_deposit_amount ?? 100 })}</p>
                    <p className="text-[11px] text-slate-400">{t('step3.accountName')} <span className="text-white font-medium">{promptpayName}</span></p>
                    
                    <div className="flex items-center justify-center gap-2 mt-1">
                      <span className="text-xs text-slate-400">{t('step3.promptpayNumber')} <span className="font-mono text-white font-bold">{promptpayNumber}</span></span>
                      <button
                        type="button"
                        onPointerDown={() => setCopiedPromptpay(true)}
                        onClick={handleCopyPromptpay}
                        className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 p-1.5 rounded-lg border border-emerald-500/40 text-[10px] flex items-center gap-1 font-semibold"
                      >
                        {copiedPromptpay ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        {copiedPromptpay ? t('step3.copied') : t('step3.copyNumber')}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Slip Upload */}
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1 block">{t('step3.slipLabel')}</label>
                  <div className="relative border-2 border-dashed border-slate-800 hover:border-emerald-500/50 rounded-xl p-4 text-center bg-slate-900/50 transition-all">
                    <input
                      required
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    {slipPreview ? (
                      <div className="flex items-center justify-center gap-3">
                        <img src={slipPreview} alt={t('step3.slipAlt')} className="w-12 h-16 object-cover rounded-md border border-emerald-500" />
                        <div className="text-left">
                          <p className="text-xs font-semibold text-emerald-400">{t('step3.slipAttached')}</p>
                          <p className="text-[10px] text-slate-400">{t('step3.changeSlip')}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload className="w-6 h-6 text-slate-500 mx-auto" />
                        <p className="text-xs text-slate-300 font-medium">{t('step3.uploadSlip')}</p>
                        <p className="text-[10px] text-slate-500">{t('step3.supportedFiles')}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="w-1/3 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 py-3.5 rounded-xl text-xs font-semibold"
                  >
                    {tc('back')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || timeLeft === 0 || !slipFile}
                    className="w-2/3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40"
                  >
                    {isSubmitting ? t('step3.submitting') : t('step3.confirmDeposit')}
                    <ShieldCheck className="w-4 h-4" />
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-3 px-4 text-center text-[11px] text-slate-600">
        {t('footer', { brand: tc('brandName') })}
      </footer>
    </div>
  );
}
