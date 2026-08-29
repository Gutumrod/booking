import { supabase } from './supabase';

export interface Shop {
  id: string;
  name: string;
  slug: string;
  phone: string;
  address: string;
  line_oa_id: string;
  promptpay_number: string;
  promptpay_name: string;
  require_deposit: boolean;
  default_deposit_amount: number;
  // Public, non-sensitive booking eligibility flag from shop_public_profile.
  // Billing status and the reason for any block remain server-side.
  is_accepting_online_bookings?: boolean;
}

export interface Service {
  id: string;
  shop_id: string;
  name: string;
  description: string;
  duration_minutes: number;
  price: number;
  deposit_amount: number | null;
}

export interface Staff {
  id: string;
  shop_id: string;
  name: string;
  nickname: string;
}

export interface StaffSchedule {
  staff_id: string;
  day_of_week: number;
  is_working_day: boolean;
  work_start: string;
  work_end: string;
  break_start: string | null;
  break_end: string | null;
}

export interface ShopHoliday {
  staff_id: string | null;
  holiday_date: string;
  reason: string | null;
}

export interface ShopAvailability {
  schedules: StaffSchedule[];
  holidays: ShopHoliday[];
}

export interface CreateHoldParams {
  shop_id: string;
  service_id: string;
  staff_id?: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  booking_date: string;
  start_time: string;
  notes?: string;
}

export interface HoldResponse {
  booking_id: string;
  booking_code: string;
  link_token: string;
  status: 'hold' | 'confirmed';
  deposit_status: 'awaiting' | 'not_required';
  deposit_amount: number;
  total_price: number;
  expires_at: string | null;
  staff_id: string;
}

export interface CreateBookingHoldMessages {
  shopBlocked: string;
}

export async function getShopBySlug(slug: string): Promise<Shop | null> {
  // shop_public_profile exposes only customer-facing columns (name, phone,
  // address, PromptPay, LINE OA ID, deposit config) and already filters to
  // active shops -- unauthenticated clients can no longer select(*) on the
  // shops table itself, which used to also return subscription_status,
  // trial_ends_at, owner_name, etc.
  const { data, error } = await supabase
    .from('shop_public_profile')
    .select('id, name, slug, phone, address, line_oa_id, promptpay_number, promptpay_name, require_deposit, default_deposit_amount, is_accepting_online_bookings')
    .eq('slug', slug)
    .single();

  if (error || !data) {
    console.error('Error fetching shop by slug:', error);
    return null;
  }
  return data as Shop;
}

export async function getShopServices(shopId: string): Promise<Service[]> {
  const { data, error } = await supabase
    .from('services')
    .select('id, shop_id, name, description, duration_minutes, price, deposit_amount')
    .eq('shop_id', shopId)
    .eq('is_active', true);

  if (error) {
    console.error('Error fetching shop services:', error);
    return [];
  }
  return (data || []) as Service[];
}

export async function getShopStaff(shopId: string): Promise<Staff[]> {
  const { data, error } = await supabase
    .from('staff')
    .select('id, shop_id, name, nickname')
    .eq('shop_id', shopId)
    .eq('is_active', true);

  if (error) {
    console.error('Error fetching shop staff:', error);
    return [];
  }
  return (data || []) as Staff[];
}

export async function getShopAvailability(shopId: string): Promise<ShopAvailability> {
  const [schedulesResult, holidaysResult] = await Promise.all([
    supabase
      .from('staff_schedules')
      .select('staff_id, day_of_week, is_working_day, work_start, work_end, break_start, break_end')
      .eq('shop_id', shopId),
    supabase
      .from('shop_holidays')
      .select('staff_id, holiday_date, reason')
      .eq('shop_id', shopId),
  ]);

  if (schedulesResult.error) {
    console.error('Error fetching staff schedules:', schedulesResult.error);
    throw new Error(schedulesResult.error.message || 'Failed to fetch staff schedules');
  }
  if (holidaysResult.error) {
    console.error('Error fetching shop holidays:', holidaysResult.error);
    throw new Error(holidaysResult.error.message || 'Failed to fetch shop holidays');
  }

  return {
    schedules: (schedulesResult.data || []) as StaffSchedule[],
    holidays: (holidaysResult.data || []) as ShopHoliday[],
  };
}

export async function createBookingHold(
  params: CreateHoldParams,
  messages?: CreateBookingHoldMessages,
): Promise<HoldResponse> {
  const { data, error } = await supabase.rpc('create_booking_hold', {
    p_shop_id: params.shop_id,
    p_service_id: params.service_id,
    p_staff_id: params.staff_id || null,
    p_customer_name: params.customer_name,
    p_customer_phone: params.customer_phone,
    p_customer_email: params.customer_email || null,
    p_booking_date: params.booking_date,
    p_start_time: params.start_time,
    p_notes: params.notes || null,
  });

  if (error) {
    console.error('Error in create_booking_hold RPC:', error);
    if (error.message?.includes('SHOP_NOT_ACCEPTING_ONLINE_BOOKINGS')) {
      throw new Error(messages?.shopBlocked || 'ร้านนี้ไม่รับจองคิวออนไลน์ในขณะนี้');
    }
    throw new Error(error.message || 'Failed to create booking hold');
  }

  return data as HoldResponse;
}

export async function submitDepositSlip(bookingId: string, recoveryToken: string, slipObjectPath: string, transRef?: string) {
  const { data, error } = await supabase.rpc('submit_deposit_slip', {
    p_booking_id: bookingId,
    p_recovery_token: recoveryToken,
    p_slip_url: slipObjectPath,
    p_trans_ref: transRef || null,
  });

  if (error) {
    console.error('Error submitting deposit slip:', error);
    throw new Error(error.message || 'Failed to submit deposit slip');
  }
  if ((data as { ok?: boolean; error?: string } | null)?.ok === false) {
    throw new Error((data as { error?: string }).error || 'Invalid booking recovery token');
  }

  return data;
}

export interface UploadDepositSlipMessages {
  unsupportedType: string;
  tooLarge: string;
  urlFailed: string;
}

const defaultUploadDepositSlipMessages: UploadDepositSlipMessages = {
  unsupportedType: 'รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP',
  tooLarge: 'ไฟล์สลิปต้องมีขนาดไม่เกิน 5 MB',
  urlFailed: 'Failed to create deposit slip URL',
};

export async function uploadDepositSlip(
  bookingId: string,
  recoveryToken: string,
  file: File,
  messages: UploadDepositSlipMessages = defaultUploadDepositSlipMessages,
): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error(messages.unsupportedType);
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error(messages.tooLarge);
  }

  const intentResponse = await fetch('/api/deposit-slips/upload-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId, recoveryToken, contentType: file.type, size: file.size }),
  });
  const intent = await intentResponse.json().catch(() => null) as { objectPath?: string; token?: string; error?: string } | null;
  if (!intentResponse.ok || !intent?.objectPath || !intent.token) {
    throw new Error(intent?.error || messages.urlFailed);
  }
  const { error } = await supabase.storage
    .from('deposit-slips')
    .uploadToSignedUrl(intent.objectPath, intent.token, file, { contentType: file.type });

  if (error) {
    console.error('Error uploading deposit slip:', error);
    throw new Error(error.message || 'Failed to upload deposit slip');
  }

  return intent.objectPath;
}
