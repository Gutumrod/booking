// Why a dashboard row can or cannot be booked (F-11).
//
// The owner dashboard is entitled to know why a row it can see is not bookable,
// so it reads the same read-only view the customer listing uses
// (local_service.bk01_shop_entitlement_status) for the selected shop:
//
//   state 'plan_excluded'  the row is active but outside the current plan's
//                          entitled set -> over the plan's entitlement
//   state 'switched_off' + system_disabled = true   -> parked by the system
//   state 'switched_off' + system_disabled = false  -> switched off by the owner
//   state 'bookable'       -> no status chip; the row is offered as it is
//
// A STAFF row carries system_disabled = NULL: the staff table holds no such
// fact, so the database does not distinguish a system switch-off from the
// owner's own. It therefore renders one neutral "not in use" label and no
// reason is invented for it.
//
// The view's state is the only input: no plan limit, cap, price or pack number
// is embedded here, and none is derived from a plan identifier.
//
// Pure and framework-free for unit testing from `tests/`.

export type EntitlementItemKind = 'service' | 'staff';

export type EntitlementState = 'bookable' | 'plan_excluded' | 'switched_off';

export interface EntitlementStatusRow {
  /** item_id of the view row. */
  id: string;
  itemKind: EntitlementItemKind;
  state: EntitlementState;
  /** NULL means the database does not hold the reason for this row. */
  systemDisabled: boolean | null;
}

export interface EntitlementStatusLabels {
  /** Active, but outside the current plan's entitlement. */
  overPlan: string;
  /** Not active, switched off by the system. */
  systemParked: string;
  /** Not active, switched off by the owner. */
  ownerOff: string;
  /** Not active and the database does not hold the reason. */
  notInUse: string;
}

/**
 * The status chip text for a row, or null when the row is bookable and needs no
 * chip. Never invents a reason the read surface did not supply.
 */
export function resolveEntitlementStatusLabel(
  row: EntitlementStatusRow,
  labels: EntitlementStatusLabels,
): string | null {
  switch (row.state) {
    case 'plan_excluded':
      return labels.overPlan;
    case 'switched_off':
      // system_disabled is NULL for every staff row and the view's own comment
      // says so explicitly: the neutral label is the only honest answer there.
      if (row.itemKind === 'staff') return labels.notInUse;
      if (row.systemDisabled === true) return labels.systemParked;
      if (row.systemDisabled === false) return labels.ownerOff;
      return labels.notInUse;
    default:
      return null;
  }
}

/** Index view rows by item id, so a rendered row can find its own status. */
export function indexEntitlementStatusByItemId(
  rows: readonly EntitlementStatusRow[],
): Map<string, EntitlementStatusRow> {
  return new Map(rows.map((row) => [row.id, row]));
}
