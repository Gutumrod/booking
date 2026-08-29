'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { LanguageToggle } from '@/components/language-toggle';
import { 
  Store, Mail, Sparkles, ArrowRight, ArrowLeft, QrCode, CreditCard,
  ShieldCheck, Building, CheckCircle2, Globe
} from 'lucide-react';

const PENDING_REGISTRATION_KEY = 'local-service.pending-owner-registration';

interface PendingRegistration {
  shopName: string;
  shopSlug: string;
  businessCategory: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  selectedPlan: 'free_trial' | 'basic_490' | 'pro_990';
  promptpayNumber: string;
  promptpayName: string;
  idempotencyKey: string;
}

function RegisterFormContent() {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const suggestedCategories = t.raw('suggestedCategories') as string[];
  const router = useRouter();
  const searchParams = useSearchParams();
  const planParam = searchParams.get('plan');

  const [currentStep, setCurrentStep] = useState<number>(1);

  // Step 1: Shop & Owner Info
  const [shopName, setShopName] = useState('');
  const [shopSlug, setShopSlug] = useState('');
  const [businessCategory, setBusinessCategory] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [password, setPassword] = useState('');

  // Step 2: Plan Selection
  const [selectedPlan, setSelectedPlan] = useState<'free_trial' | 'basic_490' | 'pro_990'>(() =>
    planParam === 'basic_490' || planParam === 'pro_990' || planParam === 'free_trial'
      ? planParam
      : 'free_trial'
  );

  // Step 3: PromptPay Setup
  const [promptpayNumber, setPromptpayNumber] = useState('');
  const [promptpayName, setPromptpayName] = useState('');

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isAwaitingEmail, setIsAwaitingEmail] = useState(false);
  const [errorMessage, setErrorMessage] = useState(() => searchParams.get('auth_error') ?? '');
  const resumeAttemptedRef = useRef(false);

  const provisionShop = useCallback(async (registration: PendingRegistration) => {
    const supabase = createClient();
    const { error } = await supabase.rpc('provision_owner_shop', {
      p_shop_name: registration.shopName,
      p_shop_slug: registration.shopSlug,
      p_business_category: registration.businessCategory,
      p_owner_name: registration.ownerName,
      p_owner_phone: registration.ownerPhone,
      p_promptpay_number: registration.promptpayNumber,
      p_promptpay_name: registration.promptpayName,
      p_requested_plan: registration.selectedPlan,
      p_idempotency_key: registration.idempotencyKey,
    });

    if (error) throw error;

    localStorage.removeItem(PENDING_REGISTRATION_KEY);
    setIsAwaitingEmail(false);
    setIsSuccess(true);
    setTimeout(() => router.replace('/dashboard'), 1200);
  }, [router]);

  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    resumeAttemptedRef.current = true;

    const resumeProvisioning = async () => {
      const rawRegistration = localStorage.getItem(PENDING_REGISTRATION_KEY);
      if (!rawRegistration) return;

      let registration: PendingRegistration;
      try {
        registration = JSON.parse(rawRegistration) as PendingRegistration;
      } catch {
        localStorage.removeItem(PENDING_REGISTRATION_KEY);
        setErrorMessage(t('pendingCorrupt'));
        return;
      }

      const supabase = createClient();
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        setIsAwaitingEmail(true);
        return;
      }

      setIsSubmitting(true);
      try {
        await provisionShop(registration);
      } catch (provisionError) {
        setErrorMessage(provisionError instanceof Error ? provisionError.message : t('registerFailed'));
      } finally {
        setIsSubmitting(false);
      }
    };

    void resumeProvisioning();
  }, [provisionShop, t]);

  // Auto generate slug from shop name (handles English & Thai gracefully)
  const handleShopNameChange = (val: string) => {
    setShopName(val);
    const sanitized = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');

    if (sanitized) {
      setShopSlug(sanitized);
    } else if (val.trim()) {
      // If shop name is in Thai, create a clean readable default slug
      setShopSlug('shop-' + Math.floor(100 + Math.random() * 900));
    } else {
      setShopSlug('your-shop-slug');
    }
  };

  const handleSlugInputChange = (val: string) => {
    const cleanSlug = val
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');
    setShopSlug(cleanSlug);
  };

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentStep < 3) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleFinalSubmit();
    }
  };

  const handleFinalSubmit = async () => {
    setErrorMessage('');
    setIsSubmitting(true);

    const registration: PendingRegistration = {
      shopName: shopName.trim(),
      shopSlug: shopSlug.trim(),
      businessCategory: businessCategory.trim(),
      ownerName: ownerName.trim(),
      ownerPhone: ownerPhone.trim(),
      ownerEmail: ownerEmail.trim().toLowerCase(),
      selectedPlan,
      promptpayNumber: promptpayNumber.trim(),
      promptpayName: promptpayName.trim(),
      idempotencyKey: crypto.randomUUID(),
    };

    localStorage.setItem(PENDING_REGISTRATION_KEY, JSON.stringify(registration));

    try {
      const supabase = createClient();
      const { data: currentUser } = await supabase.auth.getUser();

      if (currentUser.user) {
        await provisionShop(registration);
        return;
      }

      const configuredSiteUrl = process.env.NEXT_PUBLIC_ADMIN_SITE_URL?.replace(/\/$/, '');
      const callbackUrl = `${configuredSiteUrl || window.location.origin}/auth/callback?next=/register`;
      const { data, error } = await supabase.auth.signUp({
        email: registration.ownerEmail,
        password,
        options: { emailRedirectTo: callbackUrl },
      });

      if (error) throw error;

      if (data.session) {
        await provisionShop(registration);
      } else {
        setIsAwaitingEmail(true);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('registerFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 sm:p-6 font-sans">
      <div className="absolute top-4 right-4">
        <LanguageToggle />
      </div>

      <div className="max-w-2xl w-full space-y-6">
        {/* Top Header Logo */}
        <div className="text-center space-y-2">
          <Link href="/" className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full text-xs font-bold hover:bg-emerald-500/20 transition-all">
            <Store className="w-4 h-4" />
            Local Service Booking SaaS
          </Link>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">{t('registerTitle')}</h1>
          <p className="text-xs text-slate-400">{t('registerSubtitle')}</p>
        </div>

        {/* Wizard Stepper Progress Bar */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between text-xs">
          <div className={`flex items-center gap-2 font-semibold ${currentStep >= 1 ? 'text-emerald-400' : 'text-slate-500'}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold text-xs ${currentStep >= 1 ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>1</span>
            <span className="hidden sm:inline">{t('stepShopShort')}</span>
          </div>
          <div className="h-0.5 flex-1 bg-slate-800 mx-3" />
          <div className={`flex items-center gap-2 font-semibold ${currentStep >= 2 ? 'text-emerald-400' : 'text-slate-500'}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold text-xs ${currentStep >= 2 ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>2</span>
            <span className="hidden sm:inline">{t('stepPlanShort')}</span>
          </div>
          <div className="h-0.5 flex-1 bg-slate-800 mx-3" />
          <div className={`flex items-center gap-2 font-semibold ${currentStep >= 3 ? 'text-emerald-400' : 'text-slate-500'}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold text-xs ${currentStep >= 3 ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>3</span>
            <span className="hidden sm:inline">{t('stepPromptpayTitle')}</span>
          </div>
        </div>

        {/* Form Main Container */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
          {errorMessage && (
            <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
              {errorMessage}
            </p>
          )}

          {isSuccess ? (
            <div className="text-center py-10 space-y-4 animate-fade-in">
              <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/40">
                <CheckCircle2 className="w-10 h-10 animate-bounce" />
              </div>
              <h2 className="text-xl font-bold text-white">{t('registerSuccessTitle')}</h2>
              <p className="text-xs text-slate-400">{t('registerSuccessSubtitle')}</p>
            </div>
          ) : isAwaitingEmail ? (
            <div className="text-center py-10 space-y-4 animate-fade-in">
              <div className="w-16 h-16 bg-amber-500/20 text-amber-400 rounded-full flex items-center justify-center mx-auto border border-amber-500/40">
                <Mail className="w-9 h-9" />
              </div>
              <h2 className="text-xl font-bold text-white">{t('checkEmailTitle')}</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                {t('checkEmailBody', { email: ownerEmail })}
              </p>
              <p className="text-[11px] text-slate-500">{t('checkEmailSpam')}</p>
            </div>
          ) : (
            <form onSubmit={handleNextStep} className="space-y-6">
              {/* STEP 1: SHOP & OWNER IDENTITY */}
              {currentStep === 1 && (
                <div className="space-y-4 animate-fade-in">
                  <h2 className="text-base font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
                    <Building className="w-5 h-5 text-emerald-400" />
                    {t('stepShopTitle')}
                  </h2>

                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">{t('shopNameLabel')}</label>
                      <input
                        required
                        type="text"
                        placeholder={t('shopNamePlaceholder')}
                        value={shopName}
                        onChange={(e) => handleShopNameChange(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-bold focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    {/* URL Slug Editable Input & Live Preview */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                        <span>{t('slugLabel')}</span>
                        <span className="text-[10px] text-slate-400 font-normal">{t('slugHint')}</span>
                      </label>
                      <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-400 font-mono">
                        <Globe className="w-4 h-4 text-emerald-400 mr-2 flex-shrink-0" />
                        <span className="hidden sm:inline text-slate-500">http://localhost:3000/book/</span>
                        <input
                          required
                          type="text"
                          placeholder="good-cuts-barber"
                          value={shopSlug}
                          onChange={(e) => handleSlugInputChange(e.target.value)}
                          className="bg-transparent font-bold text-amber-400 focus:outline-none flex-1 font-mono"
                        />
                      </div>
                      <p className="text-[10px] text-amber-400/90 font-medium pt-0.5">
                        {t('slugNote')}
                      </p>
                    </div>

                    {/* FREE-TEXT BUSINESS CATEGORY WITH QUICK SUGGESTION CHIPS */}
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        {t('businessCategoryLabel')} <span className="text-emerald-400 font-normal">{t('businessCategoryHint')}</span>
                      </label>
                      <input
                        required
                        type="text"
                        placeholder={t('businessCategoryPlaceholder')}
                        value={businessCategory}
                        onChange={(e) => setBusinessCategory(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                      />
                      
                      {/* Suggestion Chips */}
                      <div className="mt-2.5 space-y-1">
                        <span className="text-[10px] text-slate-400 block font-medium">{t('businessCategoryQuickPick')}</span>
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {suggestedCategories.map((cat, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setBusinessCategory(cat.replace(/^[^a-zA-Z0-9\u0E00-\u0E7F]+\s*/, ''))}
                              className="text-[11px] bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-emerald-500/50 px-2.5 py-1 rounded-lg transition-all"
                            >
                              {cat}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      <div>
                        <label className="text-xs font-semibold text-slate-300 block mb-1">{t('ownerNameLabel')}</label>
                        <input
                          required
                          type="text"
                          placeholder={t('ownerNamePlaceholder')}
                          value={ownerName}
                          onChange={(e) => setOwnerName(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-300 block mb-1">{t('ownerPhoneLabel')}</label>
                        <input
                          required
                          type="tel"
                          placeholder="08X-XXX-XXXX"
                          value={ownerPhone}
                          onChange={(e) => setOwnerPhone(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-slate-300 block mb-1">{t('ownerEmailLabel')}</label>
                        <input
                          required
                          type="email"
                          placeholder="owner@yourshop.com"
                          value={ownerEmail}
                          onChange={(e) => setOwnerEmail(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-300 block mb-1">{t('passwordLabel2')}</label>
                        <input
                          required
                          type="password"
                          placeholder={t('passwordPlaceholder')}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: SELECT PLAN */}
              {currentStep === 2 && (
                <div className="space-y-5 animate-fade-in">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-emerald-400" />
                      {t('stepPlanTitle')}
                    </h2>

                    <span className="text-[11px] font-semibold text-amber-300">{t('pilotReferenceNotice')}</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* FREE TRIAL TIER */}
                    <div
                      onClick={() => setSelectedPlan('free_trial')}
                      className={`cursor-pointer rounded-2xl p-4 border transition-all space-y-3 relative ${
                        selectedPlan === 'free_trial'
                          ? 'bg-slate-900 border-2 border-emerald-500 shadow-lg shadow-emerald-950/40'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-sm text-white">{t('planFreeTitle')}</h3>
                        {selectedPlan === 'free_trial' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      </div>
                      <p className="text-xl font-extrabold text-emerald-400 font-mono">{t('planFreePrice')}</p>
                      <p className="text-[11px] text-slate-400">{t('planFreeDesc')}</p>
                      <ul className="text-[10px] space-y-1.5 text-slate-300 border-t border-slate-800/80 pt-2">
                        <li>{t('planFreeQ1')}</li>
                        <li>{t('planFreeQ2')}</li>
                        <li>{t('planFreeQ3')}</li>
                      </ul>
                    </div>

                    {/* BASIC TIER */}
                    <div
                      onClick={() => setSelectedPlan('basic_490')}
                      className={`cursor-pointer rounded-2xl p-4 border transition-all space-y-3 relative ${
                        selectedPlan === 'basic_490'
                          ? 'bg-slate-900 border-2 border-emerald-500 shadow-lg shadow-emerald-950/40'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-sm text-white">{t('planBasicTitle')}</h3>
                        {selectedPlan === 'basic_490' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      </div>
                      <p className="text-xl font-extrabold text-white font-mono">
                        ฿490 <span className="text-[10px] font-normal text-slate-400">{t('perMonth')}</span>
                      </p>
                      <p className="text-[11px] text-slate-400">{t('planBasicDesc')}</p>
                      <ul className="text-[10px] space-y-1.5 text-slate-300 border-t border-slate-800/80 pt-2">
                        <li>{t('planBasicQ1')}</li>
                        <li>{t('planBasicQ2')}</li>
                        <li>{t('planBasicQ3')}</li>
                      </ul>
                    </div>

                    {/* PRO TIER */}
                    <div
                      onClick={() => setSelectedPlan('pro_990')}
                      className={`cursor-pointer rounded-2xl p-4 border transition-all space-y-3 relative ${
                        selectedPlan === 'pro_990'
                          ? 'bg-slate-900 border-2 border-emerald-500 shadow-lg shadow-emerald-950/40'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <span className="absolute -top-2.5 right-3 bg-emerald-500 text-slate-950 text-[9px] font-extrabold px-2 py-0.5 rounded-full">
                        {t('planProBadge')}
                      </span>
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-sm text-white">{t('planProTitle')}</h3>
                        {selectedPlan === 'pro_990' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      </div>
                      <p className="text-xl font-extrabold text-emerald-400 font-mono">
                        ฿990 <span className="text-[10px] font-normal text-slate-400">{t('perMonth')}</span>
                      </p>
                      <p className="text-[11px] text-slate-400">{t('planProDesc')}</p>
                      <ul className="text-[10px] space-y-1.5 text-slate-300 border-t border-slate-800/80 pt-2">
                        <li>{t('planProQ1')}</li>
                        <li>{t('planProQ2')}</li>
                        <li>{t('planProQ3')}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: PROMPTPAY SETUP */}
              {currentStep === 3 && (
                <div className="space-y-4 animate-fade-in">
                  <h2 className="text-base font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
                    <QrCode className="w-5 h-5 text-emerald-400" />
                    {t('stepPromptpayTitle')} (Step 3/3)
                  </h2>

                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3.5 text-xs text-slate-300 space-y-1">
                    <p className="font-bold text-emerald-400 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" /> {t('depositFlowTitle')}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      ระบบจะนำเลขพร้อมเพย์นี้ไปสร้างเป็น Dynamic QR Code ให้ลูกค้าสแกนโอนเงินมัดจำ เงินเข้าบัญชีท่านทันทีโดยไม่ผ่านตัวกลาง
                    </p>
                  </div>

                  <div className="space-y-4 pt-1">
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">เลขพร้อมเพย์ร้านค้า (PromptPay Number) *</label>
                      <input
                        required
                        type="text"
                        placeholder="เช่น 080-074-2005 หรือ เลขนิติบุคคล 13 หลัก"
                        value={promptpayNumber}
                        onChange={(e) => setPromptpayNumber(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-emerald-400 font-mono font-bold focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">ชื่อบัญชีรับโอนเงินมัดจำ *</label>
                      <input
                        required
                        type="text"
                        placeholder="เช่น คุณสมชาย ใจดี (PromptPay Direct)"
                        value={promptpayName}
                        onChange={(e) => setPromptpayName(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Wizard Navigation Buttons */}
              <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-800">
                {currentStep > 1 ? (
                  <button
                    type="button"
                    onClick={() => setCurrentStep(prev => prev - 1)}
                    className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 font-semibold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 transition-all"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    {tCommon('back')}
                  </button>
                ) : (
                  <div />
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 transition-all ml-auto disabled:opacity-50"
                >
                  {isSubmitting ? (
                    tCommon('saving')
                  ) : currentStep === 3 ? (
                    <>
                      ยืนยันสร้างร้านค้า & เข้าสู่แดชบอร์ด
                      <Sparkles className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      ถัดไป
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function RegisterFallback() {
  const t = useTranslations('common');
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center text-xs">
      {t('loading')}
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterFallback />}>
      <RegisterFormContent />
    </Suspense>
  );
}
