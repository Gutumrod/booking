import { supabase } from './supabase';
import { selectActiveMembership } from './shop-selection';
import {
  indexEntitlementStatusByItemId,
  type EntitlementItemKind,
  type EntitlementState,
  type EntitlementStatusRow,
} from './entitlement-status';

export type BookingStatus =
  | 'hold'
  | 'pending_review'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'expired';

export type DepositStatus =
  | 'not_required'
  | 'awaiting'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'refunded';

export interface DashboardBooking {
  id: string;
  bookingCode: string;
  customerName: string;
  phone: string;
  serviceName: string;
  staffName: string;
  date: string;
  time: string;
  totalPrice: number;
  depositPrice: number;
  status: BookingStatus;
  depositStatus: DepositStatus;
  slipObjectPath?: string;
}

export interface DashboardShop {
  id: string;
  name: string;
  slug: string;
  phone: string;
  address: string;
  promptpayNumber: string;
  promptpayName: string;
  lineOaId: string;
  role: 'owner' | 'admin' | 'staff';
  // Current deposit policy, needed for honest client readiness (Codex F3).
  requireDeposit: boolean;
  // null = not configured; never coerced to 0 (Amendment B1).
  defaultDepositAmount: number | null;
}

export interface DashboardService {
  id: string;
  name: string;
  description: string;
  duration: number;
  price: number;
  // null = the merchant has not set a per-service deposit; distinct from an
  // explicit 0 (Codex F4).
  deposit: number | null;
  isActive: boolean;
  /**
   * F-14: why this row can or cannot be booked right now, from the read-only
   * view local_service.bk01_shop_entitlement_status. null when the view carries
   * no row for this service (nothing may be claimed about it).
   */
  entitlementStatus: EntitlementStatusRow | null;
}

export interface DashboardStaff {
  id: string;
  name: string;
  phone: string;
  role: string;
  isActive: boolean;
  /** F-14: as DashboardService.entitlementStatus; always itemKind 'staff'. */
  entitlementStatus: EntitlementStatusRow | null;
}

export interface DashboardScheduleDay {
  dayOfWeek: number;
  isWorkingDay: boolean;
  workStart: string;
  workEnd: string;
  breakStart: string;
  breakEnd: string;
}

export interface DashboardStaffSchedule {
  staffId: string;
  staffName: string;
  days: DashboardScheduleDay[];
}

export interface DashboardHoliday {
  id: string;
  date: string;
  reason: string;
}

export type SubscriptionPlan = 'free_trial' | 'basic_490' | 'pro_990';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid';

export interface DashboardSubscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface AdminDashboardData {
  shop: DashboardShop;
  bookings: DashboardBooking[];
  services: DashboardService[];
  staff: DashboardStaff[];
  schedules: DashboardStaffSchedule[];
  holidays: DashboardHoliday[];
  subscription: DashboardSubscription | null;
  subscriptionError?: string;
}

interface RelationName {
  name: string;
}

interface RelationCustomer extends RelationName {
  phone: string;
}

interface RelationStaff extends RelationName {
  nickname: string | null;
}

interface RawBooking {
  id: string;
  booking_code: string;
  booking_date: string;
  start_time: string;
  status: BookingStatus;
  deposit_status: DepositStatus;
  deposit_amount: number | string | null;
  total_price: number | string;
  slip_url: string | null;
  customers: RelationCustomer | RelationCustomer[] | null;
  services: RelationName | RelationName[] | null;
  staff: RelationStaff | RelationStaff[] | null;
}

interface RawService {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number | string;
  deposit_amount: number | string | null;
  is_active: boolean;
}

interface RawShop {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  promptpay_number: string | null;
  promptpay_name: string | null;
  line_oa_id: string | null;
  require_deposit: boolean | null;
  default_deposit_amount: number | string | null;
}

interface RawStaff {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  is_active: boolean;
}

/**
 * One row of the read-only view local_service.bk01_shop_entitlement_status
 * (F-14), as the database returns it. The view holds no plan limit, cap, price
 * or pack: it carries the resolved state and, for a service, whether the switch
 * was the system's; a staff row's system_disabled is NULL because the staff
 * table holds no such fact.
 */
interface RawEntitlementStatus {
  shop_id: string;
  item_kind: EntitlementItemKind;
  item_id: string;
  item_name: string;
  is_active: boolean;
  plan_entitled: boolean;
  state: EntitlementState;
  system_disabled: boolean | null;
}

interface RawSchedule {
  staff_id: string;
  day_of_week: number;
  is_working_day: boolean;
  work_start: string;
  work_end: string;
  break_start: string | null;
  break_end: string | null;
}

interface RawHoliday {
  id: string;
  holiday_date: string;
  reason: string | null;
}

interface RawSubscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function toAmount(value: number | string | null): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export async function fetchAdminDashboardData(): Promise<AdminDashboardData> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }

  // Canonical V1 selected shop, shared with the layout Preview and ticket data (NEW-F12).
  const { data: membership, error: membershipError } = await selectActiveMembership(supabase, authData.user.id);

  if (membershipError || !membership) {
    throw new Error(membershipError?.message || 'ไม่พบสิทธิ์ร้านค้าของบัญชีนี้');
  }

  const [shopResult, bookingsResult, servicesResult, staffResult, entitlementResult, schedulesResult, holidaysResult, subscriptionResult] = await Promise.all([
    supabase
      .from('shops')
      .select('id, name, slug, phone, address, promptpay_number, promptpay_name, line_oa_id, require_deposit, default_deposit_amount')
      .eq('id', membership.shop_id)
      .single(),
    supabase
      .from('bookings')
      .select(`
        id,
        booking_code,
        booking_date,
        start_time,
        status,
        deposit_status,
        deposit_amount,
        total_price,
        slip_url,
        customers ( name, phone ),
        services ( name ),
        staff ( name, nickname )
      `)
      .eq('shop_id', membership.shop_id)
      .order('booking_date', { ascending: false })
      .order('start_time', { ascending: false }),
    supabase
      .from('services')
      .select('id, name, description, duration_minutes, price, deposit_amount, is_active')
      .eq('shop_id', membership.shop_id)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: true }),
    supabase
      .from('staff')
      .select('id, name, nickname, phone, is_active')
      .eq('shop_id', membership.shop_id)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: true }),
    // F-14: the read-only view that decides why a row can or cannot be booked,
    // for the SAME selected shop as every other read here. This is a read of the
    // view the migration lane named (local_service schema, as the client is
    // configured), never of the raw tables it derives from, and it carries the
    // view's own state -- no plan limit, cap or price is read or derived here.
    supabase
      .from('bk01_shop_entitlement_status')
      .select('shop_id, item_kind, item_id, item_name, is_active, plan_entitled, state, system_disabled, created_at')
      .eq('shop_id', membership.shop_id),
    supabase
      .from('staff_schedules')
      .select('staff_id, day_of_week, is_working_day, work_start, work_end, break_start, break_end')
      .eq('shop_id', membership.shop_id)
      .order('day_of_week', { ascending: true }),
    supabase
      .from('shop_holidays')
      .select('id, holiday_date, reason')
      .eq('shop_id', membership.shop_id)
      .is('staff_id', null)
      .order('holiday_date', { ascending: true }),
    membership.role === 'owner'
      ? supabase
        .from('subscriptions')
        .select('plan, status, current_period_end, cancel_at_period_end')
        .eq('shop_id', membership.shop_id)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (shopResult.error || !shopResult.data) {
    throw new Error(shopResult.error?.message || 'โหลดข้อมูลร้านค้าไม่สำเร็จ');
  }

  if (bookingsResult.error) {
    throw new Error(bookingsResult.error.message);
  }

  if (servicesResult.error) {
    throw new Error(servicesResult.error.message);
  }

  if (staffResult.error) {
    throw new Error(staffResult.error.message);
  }

  // F-14: a view read that cannot be vouched for is an error, never a null
  // status per row. Throwing here reaches the dashboard's existing error path
  // (the same one every other read uses), so no screen is ever produced with
  // rows whose reason is silently missing.
  if (entitlementResult.error) {
    throw new Error(entitlementResult.error.message);
  }

  if (schedulesResult.error) throw new Error(schedulesResult.error.message);
  if (holidaysResult.error) throw new Error(holidaysResult.error.message);

  // Index the view rows by item id once, so each rendered row finds its own
  // status (undefined when the view carries no row for it).
  const entitlementStatusByItemId = indexEntitlementStatusByItemId(
    ((entitlementResult.data ?? []) as unknown as RawEntitlementStatus[]).map((row) => ({
      id: row.item_id,
      itemKind: row.item_kind,
      state: row.state,
      systemDisabled: row.system_disabled,
    })),
  );
  const entitlementStatusFor = (itemId: string) => entitlementStatusByItemId.get(itemId);

  const rawSubscription = subscriptionResult.data as RawSubscription | null;
  const subscription = rawSubscription ? {
    plan: rawSubscription.plan,
    status: rawSubscription.status,
    currentPeriodEnd: rawSubscription.current_period_end,
    cancelAtPeriodEnd: rawSubscription.cancel_at_period_end,
  } satisfies DashboardSubscription : null;

  const rawSchedules = (schedulesResult.data ?? []) as RawSchedule[];
  const dashboardStaff = ((staffResult.data ?? []) as unknown as RawStaff[]).map((staffMember) => ({
    id: staffMember.id,
    name: staffMember.name,
    phone: staffMember.phone ?? '-',
    role: staffMember.nickname || 'พนักงานให้บริการ',
    isActive: staffMember.is_active,
    // F-14: this staff row's own view row, or null when the view has none. A
    // staff row's system_disabled is NULL in the view, so the dashboard renders
    // the neutral label for it and invents no reason.
    entitlementStatus: entitlementStatusFor(staffMember.id) ?? null,
  }));

  const bookings = ((bookingsResult.data ?? []) as unknown as RawBooking[]).map((booking) => {
    const customer = firstRelation(booking.customers);
    const service = firstRelation(booking.services);
    const staff = firstRelation(booking.staff);

    return {
      id: booking.id,
      bookingCode: booking.booking_code,
      customerName: customer?.name ?? 'ไม่พบชื่อลูกค้า',
      phone: customer?.phone ?? '-',
      serviceName: service?.name ?? 'ไม่พบบริการ',
      staffName: staff?.nickname || staff?.name || 'ยังไม่ระบุพนักงาน',
      date: booking.booking_date,
      time: booking.start_time.slice(0, 5),
      totalPrice: toAmount(booking.total_price),
      depositPrice: toAmount(booking.deposit_amount),
      status: booking.status,
      depositStatus: booking.deposit_status,
      slipObjectPath: booking.slip_url ?? undefined,
    } satisfies DashboardBooking;
  });

  const rawShop = shopResult.data as unknown as RawShop;

  return {
    shop: {
      id: rawShop.id,
      name: rawShop.name,
      slug: rawShop.slug,
      phone: rawShop.phone ?? '',
      address: rawShop.address ?? '',
      promptpayNumber: rawShop.promptpay_number ?? '',
      promptpayName: rawShop.promptpay_name ?? '',
      lineOaId: rawShop.line_oa_id ?? '',
      role: membership.role as DashboardShop['role'],
      requireDeposit: rawShop.require_deposit ?? true,
      defaultDepositAmount: rawShop.default_deposit_amount == null ? null : Number(rawShop.default_deposit_amount),
    },
    bookings,
    services: ((servicesResult.data ?? []) as unknown as RawService[]).map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description ?? '',
      duration: service.duration_minutes,
      price: toAmount(service.price),
      deposit: service.deposit_amount == null ? null : toAmount(service.deposit_amount),
      isActive: service.is_active,
      // F-14: this service row's own view row, or null when the view has none.
      // state plan_excluded / switched_off plus system_disabled is the whole
      // input; no plan limit or price is read anywhere on this path.
      entitlementStatus: entitlementStatusFor(service.id) ?? null,
    })),
    staff: dashboardStaff,
    schedules: dashboardStaff.map((staffMember) => ({
      staffId: staffMember.id,
      staffName: staffMember.name,
      days: Array.from({ length: 7 }, (_, dayOfWeek) => {
        const schedule = rawSchedules.find((row) => (
          row.staff_id === staffMember.id && row.day_of_week === dayOfWeek
        ));
        return schedule ? {
          dayOfWeek,
          isWorkingDay: schedule.is_working_day,
          workStart: schedule.work_start.slice(0, 5),
          workEnd: schedule.work_end.slice(0, 5),
          breakStart: schedule.break_start?.slice(0, 5) ?? '',
          breakEnd: schedule.break_end?.slice(0, 5) ?? '',
        } : {
          dayOfWeek,
          isWorkingDay: false,
          workStart: '10:00',
          workEnd: '19:00',
          breakStart: '12:00',
          breakEnd: '13:00',
        };
      }),
    })),
    holidays: ((holidaysResult.data ?? []) as RawHoliday[]).map((holiday) => ({
      id: holiday.id,
      date: holiday.holiday_date,
      reason: holiday.reason ?? 'วันหยุดพิเศษร้านค้า',
    })),
    subscription,
    subscriptionError: subscriptionResult.error ? 'ไม่สามารถโหลดข้อมูลสมาชิกได้' : undefined,
  };
}

export interface ShopSettingsInput {
  name: string;
  phone: string;
  address: string;
  promptpayNumber: string;
  promptpayName: string;
  lineOaId: string;
}

export async function updateShopSettings(shopId: string, input: ShopSettingsInput): Promise<void> {
  const { error } = await supabase.rpc('update_shop_settings', {
    p_shop_id: shopId,
    p_name: input.name,
    p_phone: input.phone,
    p_address: input.address,
    p_promptpay_number: input.promptpayNumber,
    p_promptpay_name: input.promptpayName,
    p_line_oa_id: input.lineOaId,
  });

  if (error) throw new Error(error.message);
}

export async function saveStaffWeeklySchedule(
  staffId: string,
  days: DashboardScheduleDay[],
): Promise<void> {
  const { error } = await supabase.rpc('upsert_staff_weekly_schedule', {
    p_staff_id: staffId,
    p_days: days.map((day) => ({
      day_of_week: day.dayOfWeek,
      is_working_day: day.isWorkingDay,
      work_start: day.workStart,
      work_end: day.workEnd,
      break_start: day.breakStart || null,
      break_end: day.breakEnd || null,
    })),
  });

  if (error) throw new Error(error.message);
}

export async function createShopHoliday(shopId: string, date: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('create_shop_holiday', {
    p_shop_id: shopId,
    p_holiday_date: date,
    p_reason: reason,
    p_idempotency_key: crypto.randomUUID(),
  });

  if (error) throw new Error(error.message);
}

export async function deleteShopHoliday(holidayId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_shop_holiday', {
    p_holiday_id: holidayId,
  });

  if (error) throw new Error(error.message);
}

export interface ServiceInput {
  name: string;
  description: string;
  duration: number;
  price: number;
  deposit: number;
}

export async function createService(shopId: string, input: ServiceInput): Promise<void> {
  const { error } = await supabase.rpc('create_service', {
    p_shop_id: shopId,
    p_name: input.name,
    p_description: input.description,
    p_duration_minutes: input.duration,
    p_price: input.price,
    p_deposit_amount: input.deposit,
    p_idempotency_key: crypto.randomUUID(),
  });

  if (error) throw new Error(error.message);
}

export async function updateService(serviceId: string, input: ServiceInput): Promise<void> {
  const { error } = await supabase.rpc('update_service', {
    p_service_id: serviceId,
    p_name: input.name,
    p_description: input.description,
    p_duration_minutes: input.duration,
    p_price: input.price,
    p_deposit_amount: input.deposit,
  });

  if (error) throw new Error(error.message);
}

export async function setServiceActive(serviceId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_service_active', {
    p_service_id: serviceId,
    p_is_active: isActive,
  });

  if (error) throw new Error(error.message);
}

export async function createStaff(shopId: string, name: string, phone: string): Promise<void> {
  const { error } = await supabase.rpc('create_staff', {
    p_shop_id: shopId,
    p_name: name,
    p_phone: phone,
    p_idempotency_key: crypto.randomUUID(),
  });

  if (error) throw new Error(error.message);
}

export async function setStaffActive(staffId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_staff_active', {
    p_staff_id: staffId,
    p_is_active: isActive,
  });

  if (error) throw new Error(error.message);
}

export async function linkStaffUser(staffId: string, email: string): Promise<void> {
  const { error } = await supabase.rpc('link_staff_user', { p_staff_id: staffId, p_user_email: email });
  if (error) throw new Error(error.message);
}

export async function approveBookingDeposit(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_booking_deposit', {
    p_booking_id: bookingId,
  });

  if (error) throw new Error(error.message);
}

export async function rejectBookingDeposit(bookingId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reject_deposit_slip', {
    p_booking_id: bookingId,
    p_reason: reason,
  });

  if (error) throw new Error(error.message);
}

export async function createSignedDepositSlipUrl(objectPath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('deposit-slips')
    .createSignedUrl(objectPath, 300);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'สร้างลิงก์ดูสลิปชั่วคราวไม่สำเร็จ');
  }
  return data.signedUrl;
}

export async function cancelBooking(bookingId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_booking', {
    p_booking_id: bookingId,
    p_reason: reason,
  });

  if (error) throw new Error(error.message);
}

export async function setBookingOutcome(
  bookingId: string,
  outcome: 'completed' | 'no_show',
): Promise<void> {
  const { error } = await supabase.rpc('set_booking_outcome', {
    p_booking_id: bookingId,
    p_outcome: outcome,
  });

  if (error) throw new Error(error.message);
}

export async function exportCoreBusinessData(shopId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('export_core_business_data', { p_shop_id: shopId });
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, unknown>;
}

export async function requestAccountClosure(shopId: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc('request_account_closure', {
    p_shop_id: shopId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function startBillingCheckout(plan: 'basic_490'): Promise<string> {
  const response = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.url) {
    throw new Error(data?.error || 'สร้างลิงก์ชำระเงินไม่สำเร็จ');
  }

  return data.url as string;
}

export async function startBillingPortal(): Promise<string> {
  const response = await fetch('/api/billing/portal', { method: 'POST' });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.url) {
    throw new Error(data?.error || 'เปิดหน้าจัดการการชำระเงินไม่สำเร็จ');
  }

  return data.url as string;
}
