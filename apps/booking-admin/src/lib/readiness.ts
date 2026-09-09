// Merchant readiness as independent capabilities (KMO-03 / brief section 11).
//
// The dashboard had no readiness surface -- a merchant could not tell what was
// still missing before customers could book. This computes one row per
// capability from data the dashboard already loads. Derived, never stored,
// never blocks the "Preview customer page" action.
//
// Pure and framework-free for unit testing from `tests/`.
//
// R7: a get_shop_readiness RPC and a public 'online booking enabled' flag will
// let this also report `public_booking`. For now it covers what the admin
// client can see.

export type ReadinessKey = 'profile' | 'services' | 'staff' | 'schedule' | 'payment';

export interface ReadinessRow {
  key: ReadinessKey;
  ok: boolean;
}

export interface ReadinessInput {
  shopName: string;
  shopPhone: string;
  promptpayNumber: string;
  services: ReadonlyArray<{ isActive: boolean }>;
  staff: ReadonlyArray<{ isActive: boolean }>;
  schedules: ReadonlyArray<{ days: ReadonlyArray<{ isWorkingDay: boolean }> }>;
}

export function computeReadiness(input: ReadinessInput): ReadinessRow[] {
  return [
    { key: 'profile', ok: input.shopName.trim() !== '' && input.shopPhone.trim() !== '' },
    { key: 'services', ok: input.services.some((s) => s.isActive) },
    { key: 'staff', ok: input.staff.some((s) => s.isActive) },
    {
      key: 'schedule',
      ok: input.schedules.some((sch) => sch.days.some((d) => d.isWorkingDay)),
    },
    { key: 'payment', ok: input.promptpayNumber.trim() !== '' },
  ];
}

export function isShopReady(rows: ReadinessRow[]): boolean {
  return rows.every((r) => r.ok);
}
