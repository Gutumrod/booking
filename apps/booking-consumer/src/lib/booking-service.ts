import { supabase } from './supabase';
import { rowOrNull, rowsOrThrow, type QueryLike } from './load-result';
import {
  ENTITLEMENT_VIEW,
  ENTITLEMENT_VIEW_COLUMNS,
  resolveEntitlementPresence,
  selectEntitlement,
  type EntitlementItemKind,
  type EntitlementPresence,
  type EntitlementRow,
  type EntitlementSelection,
} from './booking-entitlement';

export interface Shop {
  id: string;
  name: string;
  slug: string;
  phone: string;
  address: string;
  promptpay_number: string;
  promptpay_name: string;
  require_deposit: boolean;
  // default_deposit_amount is intentionally NOT read by the consumer: the client
  // never derives a displayed deposit from a shop-level default (Codex F2). The
  // authoritative amount for an awaiting instruction comes only from the hold RPC.
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
  /**
   * The Turnstile challenge token from the booking widget (H4 / G01). Optional
   * here because the SERVER route, not this layer, decides whether a challenge is
   * configured and required — see `createBookingHold`.
   */
  turnstile_token?: string | null;
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
  // address, PromptPay, deposit config, booking eligibility) and already filters
  // to active shops -- unauthenticated clients can no longer select(*) on the
  // shops table itself, which used to also return subscription_status,
  // trial_ends_at, owner_name, etc.
  // The public profile carries NO per-shop LINE OA id: the central OA is the only
  // binding target (see lib/line-link.ts), and the P0 SQL view
  // (20261002120000_bk01_council_p0.sql) removed the column, so selecting it here
  // would make EVERY /book/[slug] load return LOAD_ERROR.
  // maybeSingle(): no row -> { data: null, error: null } (SHOP_NOT_FOUND); a
  // query/network error throws so the page shows LOAD_ERROR (Codex R2-5).
  const result = await supabase
    .from('shop_public_profile')
    .select('id, name, slug, phone, address, promptpay_number, promptpay_name, require_deposit, is_accepting_online_bookings')
    .eq('slug', slug)
    .maybeSingle();

  return rowOrNull(result, 'shop') as Shop | null;
}

export async function getShopServices(shopId: string): Promise<Service[]> {
  const { bookableIds } = await readShopEntitlement(shopId, 'service', 'shop services');
  if (bookableIds.length === 0) return [];
  return hydrateBookableRows<Service>(
    supabase
      .from('services')
      .select('id, shop_id, name, description, duration_minutes, price, deposit_amount')
      .in('id', bookableIds),
    'shop services',
  );
}

export async function getShopStaff(shopId: string): Promise<Staff[]> {
  const { bookableIds } = await readShopEntitlement(shopId, 'staff', 'shop staff');
  if (bookableIds.length === 0) return [];
  return hydrateBookableRows<Staff>(
    supabase
      .from('staff')
      .select('id, shop_id, name, nickname')
      .in('id', bookableIds),
    'shop staff',
  );
}

/**
 * Whether the shop has any row of each kind, whatever its state (F-14). This is
 * what separates "the shop never added a bookable service" from "the shop has
 * services and none the plan allows": the page renders the two differently.
 * One read serves both, so a fail-closed error here is the same error.
 */
export async function getShopEntitlementKinds(shopId: string): Promise<EntitlementPresence> {
  const result = await supabase
    .from(ENTITLEMENT_VIEW)
    .select(ENTITLEMENT_VIEW_COLUMNS)
    .eq('shop_id', shopId);
  const rows = rowsOrThrow<EntitlementRow>(result, 'shop entitlement status');
  return resolveEntitlementPresence(rows, shopId, 'shop entitlement status');
}

/**
 * Reads the entitlement view for one shop and one item kind. A query/network
 * error or a missing view throws through rowsOrThrow, and a row this shop cannot
 * claim (foreign shop_id, wrong item kind, unknown state, malformed flag) throws
 * through selectEntitlement. There is no path from here to the whole table.
 */
async function readShopEntitlement(
  shopId: string,
  itemKind: EntitlementItemKind,
  what: string,
): Promise<EntitlementSelection> {
  const result = await supabase
    .from(ENTITLEMENT_VIEW)
    .select(ENTITLEMENT_VIEW_COLUMNS)
    .eq('shop_id', shopId)
    .eq('item_kind', itemKind);
  const rows = rowsOrThrow<EntitlementRow>(result, `${what} entitlement`);
  return selectEntitlement(rows, shopId, itemKind, what);
}

/**
 * Hydrates the rows the view marked bookable, keeping the caller's id order.
 * The view carries no description, duration, price or deposit, so the detail
 * still comes from the table's public column allowlist -- and a bookable id the
 * table cannot supply is an error, never a silently shorter list (the same
 * fail-closed rule rowsOrThrow applies to an unreadable query).
 */
async function hydrateBookableRows<T>(
  query: PromiseLike<QueryLike<T[]>>,
  what: string,
): Promise<T[]> {
  // rowsOrThrow is generic in the row type, so the caller gets T[] without a
  // cast: a bookable id the table cannot supply is an error, never a silently
  // shorter list (the same fail-closed rule rowsOrThrow applies to a query that
  // reports an error).
  return rowsOrThrow<T>(await query, what);
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
  /*
   * H4 / G01 (brief 28 §4, A-24 item 1): a public booking is created through the
   * SERVER route, never by calling `create_booking_hold` from the browser. The P0
   * SQL set revokes the RPC from anon/authenticated and grants it to `bk01_runtime`
   * only, so this call is not just the intended path — it is the only one that
   * works. The route checks the abuse budget and the Turnstile challenge first.
   *
   * The challenge token is optional at THIS layer: the page supplies one when the
   * widget is configured, and the route refuses a missing token on its own terms.
   * The page does not decide whether a challenge is required — the server does.
   */
  const response = await fetch('/api/bookings/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, turnstileToken: params.turnstile_token ?? '' }),
  });

  const payload = await response.json().catch(() => null) as
    | { hold?: HoldResponse; error?: string }
    | null;

  if (!response.ok) {
    const message = payload?.error ?? '';
    // The shop-blocked refusal keeps its own customer-facing wording, which is the
    // one error the page has always translated itself.
    if (message.includes('SHOP_NOT_ACCEPTING_ONLINE_BOOKINGS')) {
      throw new Error(messages?.shopBlocked || 'ร้านนี้ไม่รับจองคิวออนไลน์ในขณะนี้');
    }
    throw new Error(message || 'Failed to create booking hold');
  }
  if (!payload?.hold) throw new Error('Failed to create booking hold');

  return payload.hold;
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
  dailyLimitReached: string;
}

const defaultUploadDepositSlipMessages: UploadDepositSlipMessages = {
  unsupportedType: 'รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP',
  tooLarge: 'ไฟล์สลิปต้องมีขนาดไม่เกิน 5 MB',
  urlFailed: 'Failed to create deposit slip URL',
  dailyLimitReached: 'ครบจำนวนครั้งที่อัปโหลดสลิปได้แล้ว กรุณาติดต่อร้าน',
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
  const intent = await intentResponse.json().catch(() => null) as
    { objectPath?: string; token?: string; error?: string; code?: string } | null;
  if (!intentResponse.ok || !intent?.objectPath || !intent.token) {
    /*
     * G09. The database caps successful upload intents at 20 per booking per 24 hours and
     * the route reports that as its own code. It is not one of the window-budget 429s and
     * not a bad token, so the customer needs different instructions: the slip cannot be
     * uploaded again today and the shop is the way forward. The route's Thai default is
     * used only when the page did not supply its own localized copy, so a raw English
     * server message can never reach a Thai customer here.
     */
    if (intent?.code === 'UPLOAD_INTENT_DAILY_LIMIT') {
      throw new Error(messages.dailyLimitReached || intent.error || defaultUploadDepositSlipMessages.dailyLimitReached);
    }
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
