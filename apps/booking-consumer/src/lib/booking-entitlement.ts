// Entitlement-aware catalogue reads for the customer booking page (F-14).
//
// The public listing must offer only what the shop's plan actually allows. The
// authority is the read-only view local_service.bk01_shop_entitlement_status
// (one row per service and per staff member of a shop, whatever its state):
//
//   state 'bookable'      active AND inside the entitled set -> the booking path accepts
//   state 'plan_excluded' active but outside the entitled set -> the hold RPC refuses
//                         with SERVICE_OUTSIDE_PLAN / STAFF_OUTSIDE_PLAN
//   state 'switched_off'  the row is not active; system_disabled distinguishes a
//                         system switch-off from the owner's own for a SERVICE,
//                         and is NULL for a STAFF row
//
// Two facts must not be confused here, and the page's copy depends on the
// difference:
//   - the shop has no row of that kind at all (item kind absent from the view);
//   - the shop has rows of that kind but none of them is bookable.
// The second is a shop that is not taking bookings right now; the first is a shop
// that never added the item. Only the first may use the "never added" copy.
//
// FAIL CLOSED. The caller (booking-service.ts) throws on an entitlement read
// error or a missing view, and this module throws on an unknown state string, an
// unknown item kind, a missing item id, a non-boolean flag, or a view row whose
// shop_id / item_kind does not match the request. A read that cannot be vouched
// for never degrades into "list everything" -- the page reaches LOAD_ERROR.
//
// No plan limit, cap, price or pack name appears here: the view's state is the
// only input, and the database remains the enforcement point.
//
// Pure and framework-free for unit testing from `tests/`.

/** The read-only view that decides what a shop may offer. */
export const ENTITLEMENT_VIEW = 'bk01_shop_entitlement_status';

/**
 * The view's nine columns, and nothing else: it carries no description,
 * duration, price, deposit or customer data. Written without spaces so the
 * request is byte-identical to what the test asserts on the wire.
 */
export const ENTITLEMENT_VIEW_COLUMNS =
  'shop_id,item_kind,item_id,item_name,is_active,plan_entitled,state,system_disabled,created_at';

export type EntitlementItemKind = 'service' | 'staff';

export type EntitlementState = 'bookable' | 'plan_excluded' | 'switched_off';

/** One row of local_service.bk01_shop_entitlement_status. */
export interface EntitlementRow {
  shop_id: string;
  item_kind: EntitlementItemKind;
  item_id: string;
  item_name: string;
  is_active: boolean;
  plan_entitled: boolean;
  state: EntitlementState;
  /**
   * services.entitlement_disabled for a service; NULL for a staff row, because
   * the staff table records no reason. NULL means the database does not hold
   * this fact for the row -- it is not a claim that the owner switched it off.
   */
  system_disabled: boolean | null;
  created_at?: string;
}

export const ENTITLEMENT_STATES: readonly EntitlementState[] = [
  'bookable',
  'plan_excluded',
  'switched_off',
];

export function isEntitlementState(value: unknown): value is EntitlementState {
  return typeof value === 'string' && (ENTITLEMENT_STATES as readonly string[]).includes(value);
}

export function isEntitlementItemKind(value: unknown): value is EntitlementItemKind {
  return value === 'service' || value === 'staff';
}

/**
 * Validates every row of one shop's entitlement read: identity, item kind,
 * state string and booleans. Throws on anything the caller cannot vouch for, so
 * a malformed or foreign row can never be turned into an offer.
 */
export function assertShopEntitlementRows(
  rows: readonly EntitlementRow[],
  shopId: string,
  what: string,
): EntitlementRow[] {
  return rows.map((row) => {
    if (!row || typeof row !== 'object') {
      throw new Error(`Malformed entitlement row for ${what}`);
    }
    if (row.shop_id !== shopId) {
      throw new Error(
        `Entitlement row for ${what} belongs to shop ${String(row.shop_id)}, not ${shopId}`,
      );
    }
    if (!isEntitlementItemKind(row.item_kind)) {
      throw new Error(
        `Entitlement row ${String(row.item_id)} for ${what} has an unknown item kind "${String(row.item_kind)}"`,
      );
    }
    if (typeof row.item_id !== 'string' || row.item_id.trim() === '') {
      throw new Error(`Entitlement row for ${what} has no item id`);
    }
    if (!isEntitlementState(row.state)) {
      throw new Error(
        `Entitlement row ${row.item_id} for ${what} has an unknown state "${String(row.state)}"`,
      );
    }
    if (typeof row.is_active !== 'boolean' || typeof row.plan_entitled !== 'boolean') {
      throw new Error(`Entitlement row ${row.item_id} for ${what} carries a non-boolean flag`);
    }
    return row;
  });
}

export interface EntitlementSelection {
  /** The ids the view marked bookable for this shop and item kind. */
  bookableIds: string[];
  /**
   * True when the view returned at least one row of this kind for this shop,
   * whatever its state -- the only honest evidence that the shop added items of
   * this kind. False means "the shop has no row of this kind at all".
   */
  kindPresent: boolean;
}

/** Validate one item kind's view rows and split out what may be offered. */
export function selectEntitlement(
  rows: readonly EntitlementRow[],
  shopId: string,
  itemKind: EntitlementItemKind,
  what: string,
): EntitlementSelection {
  const checked = assertShopEntitlementRows(rows, shopId, what);
  const bookableIds = new Set<string>();
  let kindPresent = false;

  for (const row of checked) {
    if (row.item_kind !== itemKind) {
      throw new Error(
        `Entitlement row ${row.item_id} for ${what} is a ${row.item_kind} row, not a ${itemKind} row`,
      );
    }
    kindPresent = true;
    if (row.state === 'bookable') bookableIds.add(row.item_id);
  }

  return { bookableIds: Array.from(bookableIds), kindPresent };
}

/** Whether the shop has any row of each kind, whatever its state. */
export interface EntitlementPresence {
  service: boolean;
  staff: boolean;
}

export function resolveEntitlementPresence(
  rows: readonly EntitlementRow[],
  shopId: string,
  what: string,
): EntitlementPresence {
  const checked = assertShopEntitlementRows(rows, shopId, what);
  return {
    service: checked.some((row) => row.item_kind === 'service'),
    staff: checked.some((row) => row.item_kind === 'staff'),
  };
}
