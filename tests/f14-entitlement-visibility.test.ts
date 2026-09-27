// F-14 — the consumer booking choices are entitlement-aware, and the owner
// dashboard names WHY a row cannot be booked.
//
// The read surface under test is the read-only view
// local_service.bk01_shop_entitlement_status (one row per service and per staff
// member of a shop, whatever its state):
//
//   state 'bookable' | 'plan_excluded' | 'switched_off'
//   system_disabled  TRUE/FALSE for a service, NULL for a staff row
//
// The consumer accessor tests below drive the REAL exported accessors
// (getShopServices, getShopStaff, getShopEntitlementKinds) through a stubbed
// global fetch, so the fail-closed cases are exercised end to end through
// @supabase/postgrest-js and the app's own local_service-schema client rather
// than through a hand-written adapter. No request leaves the process: the stub
// client points at an unreachable host (tests/entitlement-supabase-stub.ts) and
// every fetch is answered in-process.
//
// Three facts must not be confused, and most of this file exists to keep them
// apart:
//   1. the shop has no row of that kind at all      -> NO_SERVICES / NO_STAFF
//   2. the shop has rows of that kind, none bookable -> BOOKING_DISABLED
//   3. the row itself is off, or outside the plan    -> the dashboard names which

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { register } from 'node:module';

import { loadBookingRoute } from '../apps/booking-consumer/src/lib/booking-route-load.ts';
import {
  resolveBookingPageState,
  type BookingStateInput,
} from '../apps/booking-consumer/src/lib/booking-state.ts';
import {
  resolveEntitlementStatusLabel,
  type EntitlementStatusLabels,
  type EntitlementStatusRow,
} from '../apps/booking-admin/src/lib/entitlement-status.ts';

// The app modules import their neighbours with Next.js bundler specifiers
// (`./supabase`), which Node's ESM resolver cannot resolve. The hook does the
// two rewrites documented in tests/entitlement-stub-loader.mjs and nothing else;
// it must be registered before the first import of the consumer service module.
register('./entitlement-stub-loader.mjs', import.meta.url);

const bookingService = await import('../apps/booking-consumer/src/lib/booking-service.ts');
const { getShopServices, getShopStaff, getShopEntitlementKinds } = bookingService;

const read = (path: string) => readFileSync(path, 'utf8');

const SHOP = 'shop-1';
const OTHER_SHOP = 'shop-2';

const VIEW = 'bk01_shop_entitlement_status';
const ENTITLEMENT_COLUMNS =
  'shop_id,item_kind,item_id,item_name,is_active,plan_entitled,state,system_disabled,created_at';
const SERVICE_COLUMNS = 'id,shop_id,name,description,duration_minutes,price,deposit_amount';
const STAFF_COLUMNS = 'id,shop_id,name,nickname';

// ---------------------------------------------------------------------------
// A stubbed PostgREST backend
// ---------------------------------------------------------------------------

interface ViewRow {
  shop_id: string;
  item_kind: string;
  item_id: string;
  item_name: string;
  is_active: boolean;
  plan_entitled: boolean;
  state: string;
  system_disabled: boolean | null;
  created_at?: string;
}

/**
 * A view row as the database would build it, so a fixture states the state it
 * means and the two flags follow from it. `system_disabled` is NULL for a staff
 * row because local_service.staff carries no such column.
 */
const viewRow = (
  over: Partial<ViewRow> & Pick<ViewRow, 'item_id' | 'item_kind' | 'state'>,
): ViewRow => ({
  shop_id: SHOP,
  item_name: over.item_id,
  is_active: over.state !== 'switched_off',
  plan_entitled: over.state === 'bookable',
  system_disabled: over.item_kind === 'staff' ? null : false,
  ...over,
});

type ViewAnswer =
  | ViewRow[]
  | { status: number; body: unknown }
  /** Used verbatim, so a test can make the server answer with the wrong rows. */
  | ((url: string) => ViewRow[] | { status: number; body: unknown });

interface Seed {
  view: ViewAnswer;
  services?: Record<string, unknown>[];
  staff?: Record<string, unknown>[];
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeFetch(seed: Seed, calls: string[], profiles: Array<Record<string, string>>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(decodeURIComponent(url));
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key.toLowerCase()] = value;
    });
    profiles.push(record);

    if (url.includes(VIEW)) {
      const answer = typeof seed.view === 'function' ? seed.view(url) : seed.view;
      if (!Array.isArray(answer)) return jsonResponse(answer.body, answer.status);
      // Answer like PostgREST: the row filters the URL carries are applied.
      const requestedKind = /item_kind=eq\.([a-z]+)/.exec(decodeURIComponent(url))?.[1];
      const requestedShop = /shop_id=eq\.([^&]+)/.exec(decodeURIComponent(url))?.[1];
      const rows = answer.filter(
        (row) =>
          (requestedKind === undefined || row.item_kind === requestedKind) &&
          (requestedShop === undefined || row.shop_id === requestedShop),
      );
      return jsonResponse(rows, 200);
    }

    const table = url.includes('/rest/v1/services')
      ? 'services'
      : url.includes('/rest/v1/staff')
        ? 'staff'
        : null;
    if (table === null) {
      // Answered, never thrown: a bare throw on a GET is treated as a transport
      // failure by @supabase/postgrest-js and retried three times with backoff,
      // which would make a wrong request look like a slow one.
      return jsonResponse({ message: `unexpected request: ${url}` }, 400);
    }

    const requested = /id=in\.\(([^)]*)\)/.exec(decodeURIComponent(url))?.[1];
    if (requested === undefined) {
      return jsonResponse({ message: `hydration read without an id filter: ${url}` }, 400);
    }
    const ids = requested.split(',').filter((id) => id !== '');
    const source = (table === 'services' ? seed.services : seed.staff) ?? [];
    const selected = ids
      .map((id) => source.find((row) => row.id === id))
      .filter((row): row is Record<string, unknown> => row !== undefined);

    const response = jsonResponse(selected, 200);
    response.headers.set('content-range', selected.length === 0 ? '*/0' : `0-${selected.length - 1}/${selected.length}`);
    return response;
  };
}

async function withStubbedFetch<T>(
  seed: Seed,
  run: (calls: string[], profiles: Array<Record<string, string>>) => Promise<T>,
): Promise<{ value: T; calls: string[]; profiles: Array<Record<string, string>> }> {
  const calls: string[] = [];
  const profiles: Array<Record<string, string>> = [];
  const original = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SDK's Fetch type wraps typeof fetch
  (globalThis as any).fetch = makeFetch(seed, calls, profiles);
  try {
    const value = await run(calls, profiles);
    return { value, calls, profiles };
  } finally {
    (globalThis as any).fetch = original;
  }
}

const byId = (rows: Array<Record<string, unknown>>) =>
  [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)));

const callTo = (calls: string[], fragment: string) => calls.find((call) => call.includes(fragment));

// ---------------------------------------------------------------------------
// 1. The consumer lists offer only what the view marks bookable
// ---------------------------------------------------------------------------

test('getShopServices returns only rows the view marks bookable for this shop, with the same public columns', async (t) => {
  t.mock.method(console, 'error', () => {});
  const seed: Seed = {
    view: [
      viewRow({ item_id: 'svc-1', item_kind: 'service', state: 'bookable' }),
      viewRow({ item_id: 'svc-4', item_kind: 'service', state: 'plan_excluded' }),
      viewRow({ item_id: 'svc-off', item_kind: 'service', state: 'switched_off', system_disabled: false }),
      viewRow({ item_id: 'svc-sys', item_kind: 'service', state: 'switched_off', system_disabled: true }),
    ],
    services: [
      { id: 'svc-1', shop_id: SHOP, name: 'Cut', description: 'a haircut', duration_minutes: 45, price: 350, deposit_amount: 100 },
      { id: 'svc-4', shop_id: SHOP, name: 'Four', description: 'over the plan', duration_minutes: 30, price: 200, deposit_amount: null },
      { id: 'svc-off', shop_id: SHOP, name: 'Off', description: 'owner off', duration_minutes: 30, price: 200, deposit_amount: null },
      { id: 'svc-sys', shop_id: SHOP, name: 'Sys', description: 'system off', duration_minutes: 30, price: 200, deposit_amount: null },
    ],
  };

  const { value, calls, profiles } = await withStubbedFetch(seed, () => getShopServices(SHOP));

  // Only the bookable row, hydrated with exactly the fields the page renders.
  assert.deepEqual(value, [
    { id: 'svc-1', shop_id: SHOP, name: 'Cut', description: 'a haircut', duration_minutes: 45, price: 350, deposit_amount: 100 },
  ]);

  const view = callTo(calls, VIEW);
  assert.ok(view, 'the entitlement view must be the source of the consumer list');
  assert.match(view!, /item_kind=eq\.service/);
  assert.match(view!, /shop_id=eq\.shop-1/);
  assert.ok(view!.includes(ENTITLEMENT_COLUMNS), `the view read must select its nine columns: ${view}`);
  assert.equal(
    profiles.find((headers) => headers['accept-profile'] !== undefined)?.['accept-profile'],
    'local_service',
    'the read runs in the local_service schema, as the client is configured',
  );

  const hydration = callTo(calls, '/rest/v1/services');
  assert.ok(hydration, 'a bookable service row must still be hydrated from local_service.services');
  assert.match(hydration!, /id=in\.\(svc-1\)/);
  assert.ok(hydration!.includes(SERVICE_COLUMNS), `hydration must use the public column allowlist: ${hydration}`);
  assert.doesNotMatch(hydration!, /is_active/);
  assert.doesNotMatch(hydration!, /select=\*/);
  // The three non-bookable rows were never requested.
  for (const id of ['svc-4', 'svc-off', 'svc-sys']) {
    assert.doesNotMatch(hydration!, new RegExp(`id=in\\.\\([^)]*${id}`));
  }
});

test('getShopStaff returns only rows the view marks bookable for this shop, still carrying nickname', async (t) => {
  t.mock.method(console, 'error', () => {});
  const seed: Seed = {
    view: [
      viewRow({ item_id: 'st-1', item_kind: 'staff', state: 'bookable' }),
      viewRow({ item_id: 'st-2', item_kind: 'staff', state: 'plan_excluded' }),
      viewRow({ item_id: 'st-off', item_kind: 'staff', state: 'switched_off' }),
    ],
    staff: [
      { id: 'st-1', shop_id: SHOP, name: 'Somchai', nickname: 'Chai' },
      { id: 'st-2', shop_id: SHOP, name: 'Somsri', nickname: 'Sri' },
      { id: 'st-off', shop_id: SHOP, name: 'Off', nickname: 'Off' },
    ],
  };

  const { value, calls } = await withStubbedFetch(seed, () => getShopStaff(SHOP));

  assert.deepEqual(value, [{ id: 'st-1', shop_id: SHOP, name: 'Somchai', nickname: 'Chai' }]);
  assert.equal(value[0].nickname, 'Chai', 'the customer choice list still needs the nickname');

  const view = callTo(calls, VIEW);
  assert.ok(view, 'the entitlement view must be the source of the staff list');
  assert.match(view!, /item_kind=eq\.staff/);

  const hydration = callTo(calls, '/rest/v1/staff');
  assert.ok(hydration, 'the staff row must be hydrated so the nickname renders');
  assert.match(hydration!, /id=in\.\(st-1\)/);
  assert.ok(hydration!.includes(STAFF_COLUMNS), `staff hydration must keep its allowlist: ${hydration}`);
  assert.doesNotMatch(hydration!, /is_active/);
});

test('plan_excluded and switched_off rows never reach a choice list, and nothing is hydrated for them', async (t) => {
  const seed: Seed = {
    view: [
      viewRow({ item_id: 'svc-4', item_kind: 'service', state: 'plan_excluded' }),
      viewRow({ item_id: 'svc-off', item_kind: 'service', state: 'switched_off', system_disabled: false }),
      viewRow({ item_id: 'st-2', item_kind: 'staff', state: 'plan_excluded' }),
      viewRow({ item_id: 'st-sys', item_kind: 'staff', state: 'switched_off' }),
    ],
    services: [{ id: 'svc-4', shop_id: SHOP, name: 'Four', description: '', duration_minutes: 30, price: 200, deposit_amount: null }],
    staff: [{ id: 'st-2', shop_id: SHOP, name: 'Somsri', nickname: 'Sri' }],
  };

  const services = await withStubbedFetch(seed, () => getShopServices(SHOP));
  assert.deepEqual(services.value, [], 'no bookable service may be offered');
  assert.equal(callTo(services.calls, '/rest/v1/services'), undefined, 'nothing to hydrate');

  const staff = await withStubbedFetch(seed, () => getShopStaff(SHOP));
  assert.deepEqual(staff.value, [], 'no bookable staff member may be offered');
  assert.equal(callTo(staff.calls, '/rest/v1/staff'), undefined, 'nothing to hydrate');

  // The shop does have rows of both kinds: only the state made them unbookable.
  const kinds = await withStubbedFetch(seed, () => getShopEntitlementKinds(SHOP));
  assert.deepEqual(kinds.value, { service: true, staff: true });
});

test('the kind presence read reports a kind only when the view has a row of it', async (t) => {
  const seed: Seed = { view: [viewRow({ item_id: 'svc-1', item_kind: 'service', state: 'bookable' })] };
  const { value } = await withStubbedFetch(seed, () => getShopEntitlementKinds(SHOP));
  assert.deepEqual(value, { service: true, staff: false });
});

// ---------------------------------------------------------------------------
// 2. Fail closed: a read that cannot be vouched for never becomes an offer
// ---------------------------------------------------------------------------

test('an entitlement read error throws instead of falling back to the whole table', async (t) => {
  t.mock.method(console, 'error', () => {});
  const seed: Seed = {
    view: { status: 403, body: { code: '42501', message: `permission denied for view ${VIEW}` } },
    services: [{ id: 'svc-1', shop_id: SHOP, name: 'Cut', description: '', duration_minutes: 45, price: 350, deposit_amount: null }],
  };

  const services = await withStubbedFetch(seed, async () => {
    await assert.rejects(() => getShopServices(SHOP), /permission denied/);
    return 'rejected';
  });
  assert.equal(services.value, 'rejected');
  assert.equal(callTo(services.calls, '/rest/v1/services'), undefined, 'no fallback listing');

  const staff = await withStubbedFetch(
    { view: { status: 500, body: { message: 'network down' } } },
    async () => {
      await assert.rejects(() => getShopStaff(SHOP), /network down/);
      return 'rejected';
    },
  );
  assert.equal(staff.value, 'rejected');
  assert.equal(callTo(staff.calls, '/rest/v1/staff'), undefined, 'no fallback listing');

  const kinds = await withStubbedFetch(
    { view: { status: 500, body: { message: 'network down' } } },
    async () => {
      await assert.rejects(() => getShopEntitlementKinds(SHOP), /network down/);
      return 'rejected';
    },
  );
  assert.equal(kinds.value, 'rejected');
});

test('a missing view throws instead of falling back to the whole table', async (t) => {
  t.mock.method(console, 'error', () => {});
  const seed: Seed = {
    view: {
      status: 404,
      body: { code: 'PGRST205', message: `Could not find the table 'local_service.${VIEW}' in the schema cache` },
    },
    services: [{ id: 'svc-1', shop_id: SHOP, name: 'Cut', description: '', duration_minutes: 45, price: 350, deposit_amount: null }],
  };

  const { calls } = await withStubbedFetch(seed, async () => {
    await assert.rejects(() => getShopServices(SHOP), new RegExp(VIEW));
    return 'rejected';
  });
  assert.equal(callTo(calls, '/rest/v1/services'), undefined, 'no fallback listing');
});

test('an unknown state string in a view row throws rather than being skipped or offered', async (t) => {
  t.mock.method(console, 'error', () => {});
  const seed: Seed = {
    view: [{ ...viewRow({ item_id: 'svc-1', item_kind: 'service', state: 'bookable' }), state: 'mystery' }],
    services: [{ id: 'svc-1', shop_id: SHOP, name: 'Cut', description: '', duration_minutes: 45, price: 350, deposit_amount: null }],
  };

  const { calls } = await withStubbedFetch(seed, async () => {
    await assert.rejects(() => getShopServices(SHOP), /unknown state "mystery"/);
    return 'rejected';
  });
  assert.equal(callTo(calls, '/rest/v1/services'), undefined, 'an unreadable row must not become an offer');
});

test('a view row whose shop_id does not match the request throws', async (t) => {
  t.mock.method(console, 'error', () => {});
  const seed: Seed = {
    view: () => [viewRow({ item_id: 'svc-1', item_kind: 'service', state: 'bookable', shop_id: OTHER_SHOP })],
    services: [{ id: 'svc-1', shop_id: OTHER_SHOP, name: 'Cut', description: '', duration_minutes: 45, price: 350, deposit_amount: null }],
  };

  const { calls } = await withStubbedFetch(seed, async () => {
    await assert.rejects(() => getShopServices(SHOP), /belongs to shop shop-2, not shop-1/);
    return 'rejected';
  });
  assert.equal(callTo(calls, '/rest/v1/services'), undefined, 'another shop\'s row is never hydrated');
});

test('a view row whose item_kind does not match the request throws', async (t) => {
  t.mock.method(console, 'error', () => {});
  const seed: Seed = {
    view: () => [viewRow({ item_id: 'st-1', item_kind: 'staff', state: 'bookable' })],
    services: [{ id: 'st-1', shop_id: SHOP, name: 'Wrong', description: '', duration_minutes: 45, price: 350, deposit_amount: null }],
  };

  const { calls } = await withStubbedFetch(seed, async () => {
    await assert.rejects(() => getShopServices(SHOP), /not a service row/);
    return 'rejected';
  });
  assert.equal(callTo(calls, '/rest/v1/services'), undefined, 'a row of the wrong kind is never offered');
});

test('an unknown item kind, a missing item id and a non-boolean flag all throw', async (t) => {
  t.mock.method(console, 'error', () => {});
  const cases: Array<{ row: ViewRow; expected: RegExp }> = [
    { row: { ...viewRow({ item_id: 'x-1', item_kind: 'service', state: 'bookable' }), item_kind: 'addon' }, expected: /unknown item kind "addon"/ },
    { row: { ...viewRow({ item_id: 'x-1', item_kind: 'service', state: 'bookable' }), item_id: '' }, expected: /has no item id/ },
    { row: { ...viewRow({ item_id: 'x-1', item_kind: 'service', state: 'bookable' }), plan_entitled: 'yes' as unknown as boolean }, expected: /non-boolean flag/ },
  ];

  for (const { row, expected } of cases) {
    const seed: Seed = { view: [row] };
    const { calls } = await withStubbedFetch(seed, async () => {
      await assert.rejects(() => getShopServices(SHOP), expected);
      return 'rejected';
    });
    assert.equal(callTo(calls, '/rest/v1/services'), undefined);
  }
});

// ---------------------------------------------------------------------------
// 3. "No rows of this kind" is not "no bookable row of this kind"
// ---------------------------------------------------------------------------

const stateInput = (over: Partial<BookingStateInput>): BookingStateInput => ({
  isLoading: false,
  loadError: false,
  shop: { is_accepting_online_bookings: true },
  serviceCount: 1,
  staffCount: 1,
  scheduleCount: 1,
  everyServicePaymentBlocked: false,
  serviceKindPresent: true,
  staffKindPresent: true,
  ...over,
});

test('a shop with rows of a kind but none bookable renders BOOKING_DISABLED, not the "never added" state', () => {
  // The NO_SERVICES / NO_STAFF copy asserts the shop never added any, which is
  // false for this shop, so that state must not be reachable here.
  assert.equal(resolveBookingPageState(stateInput({ serviceCount: 0, serviceKindPresent: true })), 'BOOKING_DISABLED');
  assert.equal(resolveBookingPageState(stateInput({ staffCount: 0, staffKindPresent: true })), 'BOOKING_DISABLED');
  assert.equal(
    resolveBookingPageState(stateInput({ serviceCount: 0, staffCount: 0 })),
    'BOOKING_DISABLED',
  );

  // A shop with genuinely no row of that kind keeps the existing states.
  assert.equal(resolveBookingPageState(stateInput({ serviceCount: 0, serviceKindPresent: false })), 'NO_SERVICES');
  assert.equal(resolveBookingPageState(stateInput({ staffCount: 0, staffKindPresent: false })), 'NO_STAFF');
  assert.equal(
    resolveBookingPageState(stateInput({ serviceCount: 0, serviceKindPresent: false, staffCount: 0, staffKindPresent: false })),
    'NO_SERVICES',
    'services still come first in the existing precedence order',
  );
});

test('every other page state keeps its existing precedence', () => {
  assert.equal(resolveBookingPageState(stateInput({ isLoading: true })), 'LOADING');
  assert.equal(resolveBookingPageState(stateInput({ loadError: true })), 'LOAD_ERROR');
  assert.equal(resolveBookingPageState(stateInput({ shop: null })), 'SHOP_NOT_FOUND');
  assert.equal(resolveBookingPageState(stateInput({ shop: { is_accepting_online_bookings: false } })), 'BOOKING_DISABLED');
  assert.equal(resolveBookingPageState(stateInput({ scheduleCount: 0 })), 'NO_SCHEDULE');
  assert.equal(resolveBookingPageState(stateInput({ everyServicePaymentBlocked: true })), 'PAYMENT_NOT_CONFIGURED');
  assert.equal(resolveBookingPageState(stateInput({})), 'OK');
});

// ---------------------------------------------------------------------------
// 4. The route snapshot carries the two facts the page decides on
// ---------------------------------------------------------------------------

const pageStateOf = (data: Awaited<ReturnType<typeof loadBookingRoute>>) =>
  resolveBookingPageState({
    isLoading: false,
    loadError: data.loadError,
    shop: data.shop,
    serviceCount: data.services.length,
    staffCount: data.staff.length,
    scheduleCount: data.schedules.length,
    everyServicePaymentBlocked: false,
    serviceKindPresent: data.serviceKindPresent,
    staffKindPresent: data.staffKindPresent,
  });

function routeAccessors() {
  return {
    getShopBySlug: async () => ({ id: SHOP, is_accepting_online_bookings: true }) as never,
    getShopServices,
    getShopStaff,
    getShopEntitlementKinds,
    getShopAvailability: async () => ({ schedules: [{ staff_id: 'st-1' }], holidays: [] }) as never,
  };
}

test('an exclusion-only shop reaches BOOKING_DISABLED while a genuinely empty kind keeps its own state', async (t) => {
  t.mock.method(console, 'error', () => {});

  const excludedOnly: Seed = {
    view: [
      viewRow({ item_id: 'svc-4', item_kind: 'service', state: 'plan_excluded' }),
      viewRow({ item_id: 'st-1', item_kind: 'staff', state: 'bookable' }),
    ],
    services: [{ id: 'svc-4', shop_id: SHOP, name: 'Four', description: '', duration_minutes: 30, price: 200, deposit_amount: null }],
    staff: [{ id: 'st-1', shop_id: SHOP, name: 'Somchai', nickname: 'Chai' }],
  };
  const excluded = await withStubbedFetch(excludedOnly, () => loadBookingRoute('a', routeAccessors() as never));
  assert.deepEqual(excluded.value.services, []);
  assert.equal(excluded.value.serviceKindPresent, true, 'the shop does have a service row');
  assert.equal(excluded.value.staffKindPresent, true);
  assert.equal(pageStateOf(excluded.value), 'BOOKING_DISABLED');

  // No staff rows at all: the shop really has nobody, so NO_STAFF stays honest.
  const noStaff: Seed = {
    view: [viewRow({ item_id: 'svc-1', item_kind: 'service', state: 'bookable' })],
    services: [{ id: 'svc-1', shop_id: SHOP, name: 'Cut', description: '', duration_minutes: 30, price: 200, deposit_amount: null }],
  };
  const noStaffData = await withStubbedFetch(noStaff, () => loadBookingRoute('a', routeAccessors() as never));
  assert.equal(noStaffData.value.staffKindPresent, false);
  assert.equal(pageStateOf(noStaffData.value), 'NO_STAFF');

  // No service rows at all: NO_SERVICES stays honest.
  const noService: Seed = {
    view: [viewRow({ item_id: 'st-1', item_kind: 'staff', state: 'bookable' })],
    staff: [{ id: 'st-1', shop_id: SHOP, name: 'Somchai', nickname: 'Chai' }],
  };
  const noServiceData = await withStubbedFetch(noService, () => loadBookingRoute('a', routeAccessors() as never));
  assert.equal(noServiceData.value.serviceKindPresent, false);
  assert.equal(pageStateOf(noServiceData.value), 'NO_SERVICES');

  // A healthy shop is untouched by the filtering.
  const healthy: Seed = {
    view: [
      viewRow({ item_id: 'svc-1', item_kind: 'service', state: 'bookable' }),
      viewRow({ item_id: 'st-1', item_kind: 'staff', state: 'bookable' }),
    ],
    services: [{ id: 'svc-1', shop_id: SHOP, name: 'Cut', description: '', duration_minutes: 30, price: 200, deposit_amount: null }],
    staff: [{ id: 'st-1', shop_id: SHOP, name: 'Somchai', nickname: 'Chai' }],
  };
  const healthyData = await withStubbedFetch(healthy, () => loadBookingRoute('a', routeAccessors() as never));
  assert.equal(pageStateOf(healthyData.value), 'OK');
});

test('an entitlement read error in the route snapshot is LOAD_ERROR with no partial data', async (t) => {
  t.mock.method(console, 'error', () => {});
  const seed: Seed = { view: { status: 403, body: { code: '42501', message: `permission denied for view ${VIEW}` } } };
  const { value } = await withStubbedFetch(seed, () => loadBookingRoute('a', routeAccessors() as never));
  assert.equal(value.loadError, true);
  assert.deepEqual([value.shop, value.services, value.staff], [null, [], []]);
  assert.equal(pageStateOf(value), 'LOAD_ERROR');
});

// ---------------------------------------------------------------------------
// 5. The dashboard names the reason, and never invents one
// ---------------------------------------------------------------------------

const LABELS: EntitlementStatusLabels = {
  overPlan: 'OVER_PLAN',
  systemParked: 'SYSTEM_PARKED',
  ownerOff: 'OWNER_OFF',
  notInUse: 'NOT_IN_USE',
};

const serviceStatus = (
  state: EntitlementStatusRow['state'],
  systemDisabled: boolean | null,
): EntitlementStatusRow => ({ id: 'svc-1', itemKind: 'service', state, systemDisabled });

const staffStatus = (state: EntitlementStatusRow['state']): EntitlementStatusRow => ({
  id: 'st-1',
  itemKind: 'staff',
  state,
  systemDisabled: null,
});

test('the dashboard chip gives three distinct outcomes for a service row', () => {
  assert.equal(resolveEntitlementStatusLabel(serviceStatus('plan_excluded', false), LABELS), 'OVER_PLAN');
  assert.equal(resolveEntitlementStatusLabel(serviceStatus('switched_off', true), LABELS), 'SYSTEM_PARKED');
  assert.equal(resolveEntitlementStatusLabel(serviceStatus('switched_off', false), LABELS), 'OWNER_OFF');
  assert.equal(resolveEntitlementStatusLabel(serviceStatus('bookable', false), LABELS), null, 'a bookable row needs no chip');

  const chips = [
    resolveEntitlementStatusLabel(serviceStatus('plan_excluded', false), LABELS),
    resolveEntitlementStatusLabel(serviceStatus('switched_off', true), LABELS),
    resolveEntitlementStatusLabel(serviceStatus('switched_off', false), LABELS),
  ];
  assert.equal(new Set(chips).size, 3, 'the three non-bookable outcomes are three different labels');
});

test('a staff row shows the single neutral not-in-use label and no invented reason', () => {
  // system_disabled is NULL for a staff row: the database does not hold the
  // reason, so neither reason label may appear.
  assert.equal(resolveEntitlementStatusLabel(staffStatus('switched_off'), LABELS), 'NOT_IN_USE');
  assert.notEqual(resolveEntitlementStatusLabel(staffStatus('switched_off'), LABELS), LABELS.ownerOff);
  assert.notEqual(resolveEntitlementStatusLabel(staffStatus('switched_off'), LABELS), LABELS.systemParked);

  // An exclusion is still an exclusion: that fact IS held for a staff row.
  assert.equal(resolveEntitlementStatusLabel(staffStatus('plan_excluded'), LABELS), 'OVER_PLAN');
  assert.equal(resolveEntitlementStatusLabel(staffStatus('bookable'), LABELS), null);

  // A service row with no recorded reason is neutral too, never guessed.
  assert.equal(
    resolveEntitlementStatusLabel({ id: 'svc-1', itemKind: 'service', state: 'switched_off', systemDisabled: null }, LABELS),
    'NOT_IN_USE',
  );
});

test('the admin service reads the view for the selected shop and surfaces a status per row', () => {
  const source = read('apps/booking-admin/src/lib/admin-service.ts');

  // The read exists, is scoped to the selected shop, and selects the view's
  // public status columns.
  assert.match(source, /from\('bk01_shop_entitlement_status'\)/, 'the dashboard must read the entitlement view');
  assert.match(source, /eq\('shop_id', membership\.shop_id\)/);
  for (const column of ['item_kind', 'item_id', 'item_name', 'is_active', 'plan_entitled', 'state', 'system_disabled']) {
    assert.ok(source.includes(column), `the entitlement read must select ${column}`);
  }
  // Both row shapes carry the status the tab renders, and the existing fields are untouched.
  for (const iface of ['DashboardService', 'DashboardStaff']) {
    const body = new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] ?? '';
    assert.ok(body.length > 0, `${iface} must still exist`);
    assert.match(body, /entitlementStatus: EntitlementStatusRow \| null;/, `${iface} must carry its entitlement status`);
  }
  assert.match(source, /entitlementStatus: (\w+) \?\? null/);
});

test('the dashboard tabs render a chip for both kinds and keep the existing controls', () => {
  const page = read('apps/booking-admin/src/app/dashboard/page.tsx');

  // The pure resolver is wired for the rows of both tabs.
  assert.match(page, /resolveEntitlementStatusLabel/);
  assert.match(page, /entitlementStatus/);
  assert.equal((page.match(/resolveEntitlementStatusLabel\(/g) ?? []).length >= 2, true, 'both tabs must resolve a chip');
  // The four labels come from the dashboard catalogue, not from literals.
  for (const key of ['entitlementOverPlan', 'entitlementSystemOff', 'entitlementOwnerOff', 'entitlementNotInUse']) {
    assert.match(page, new RegExp(`t\\('${key}'\\)`), `the chip must use t('${key}')`);
  }
  // The existing per-row data and toggle controls are unchanged.
  assert.match(page, /t\('serviceClosed'\)/, 'the existing service-closed badge stays');
  assert.match(page, /toggleStaffActive\(st\)/, 'the existing staff toggle stays');
  assert.match(page, /handleToggleService\(sv\)/, 'the existing service toggle stays');
  assert.match(page, /st\.isActive \? 'bg-emerald-500\/10/);
  assert.match(page, /sv\.isActive \? 'text-slate-500 hover:text-rose-400'/);
  // No new control: the only buttons near a row are the pre-existing ones.
  assert.doesNotMatch(page, /entitlementEnable|entitlementFix|reactivateWithinPlan/i);
});

// ---------------------------------------------------------------------------
// 6. The message catalogues: same key sets, no numbers, no new buyer copy
// ---------------------------------------------------------------------------

type Dict = { [key: string]: unknown };

function flattenKeys(node: Dict, prefix = ''): string[] {
  return Object.keys(node).flatMap((key) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = node[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? flattenKeys(value as Dict, path)
      : [path];
  });
}

const json = (path: string) => JSON.parse(read(path)) as Dict;

const ENTITLEMENT_KEYS = [
  'entitlementOverPlan',
  'entitlementSystemOff',
  'entitlementOwnerOff',
  'entitlementNotInUse',
] as const;

const CONSUMER = [
  { locale: 'th', path: 'apps/booking-consumer/messages/th.json' },
  { locale: 'en', path: 'apps/booking-consumer/messages/en.json' },
];
const ADMIN = [
  { locale: 'th', path: 'apps/booking-admin/messages/th.json' },
  { locale: 'en', path: 'apps/booking-admin/messages/en.json' },
];

test('all four catalogues carry the entitlement strings and each app agrees between Thai and English', () => {
  for (const { path } of CONSUMER) {
    const booking = json(path).booking as Dict;
    for (const key of ENTITLEMENT_KEYS) {
      const value = booking[key];
      assert.equal(typeof value, 'string', `${path} booking.${key} must exist`);
      assert.ok((value as string).trim().length > 0, `${path} booking.${key} must not be empty`);
      assert.doesNotMatch(value as string, /\d/, `${path} booking.${key} must not embed a number`);
    }
  }

  for (const { path } of ADMIN) {
    const dashboard = json(path).dashboard as Dict;
    for (const key of ENTITLEMENT_KEYS) {
      const value = dashboard[key];
      assert.equal(typeof value, 'string', `${path} dashboard.${key} must exist`);
      assert.ok((value as string).trim().length > 0, `${path} dashboard.${key} must not be empty`);
      assert.doesNotMatch(value as string, /\d/, `${path} dashboard.${key} must not embed a number`);
      assert.doesNotMatch(value as string, /฿|\$/);
    }
  }

  const consumerTh = json('apps/booking-consumer/messages/th.json');
  const consumerEn = json('apps/booking-consumer/messages/en.json');
  assert.deepEqual(flattenKeys(consumerTh).sort(), flattenKeys(consumerEn).sort());

  const adminTh = json('apps/booking-admin/messages/th.json');
  const adminEn = json('apps/booking-admin/messages/en.json');
  assert.deepEqual(flattenKeys(adminTh).sort(), flattenKeys(adminEn).sort());

  // The consumer app carries the strings but renders none of them: the buyer
  // copy for an exclusion-only shop is the existing BOOKING_DISABLED copy.
  for (const { path } of CONSUMER) {
    const booking = json(path).booking as Dict;
    const adminDashboard = json(path.replace('booking-consumer', 'booking-admin')).dashboard as Dict;
    for (const key of ENTITLEMENT_KEYS) {
      assert.equal(
        booking[key],
        adminDashboard[key],
        `${path}: the same approved wording must be reused, not re-invented`,
      );
    }
  }
});

test('the four dashboard labels are four different strings in each language', () => {
  for (const { locale, path } of ADMIN) {
    const dashboard = json(path).dashboard as Dict;
    const values = ENTITLEMENT_KEYS.map((key) => dashboard[key] as string);
    assert.equal(new Set(values).size, values.length, `${locale} entitlement labels must be distinct`);
  }
});

// ---------------------------------------------------------------------------
// 7. No plan limit, cap, price or pack number anywhere in this change
// ---------------------------------------------------------------------------

test('no plan limit, cap, price or pack number is embedded in the entitlement code or copy', () => {
  const entitlementModules = [
    read('apps/booking-consumer/src/lib/booking-entitlement.ts'),
    read('apps/booking-admin/src/lib/entitlement-status.ts'),
    read('apps/booking-consumer/src/lib/booking-service.ts'),
  ];
  for (const source of entitlementModules) {
    assert.doesNotMatch(source, /free_trial|basic_490|pro_990|entitlement_plans|services_limit|staff_limit/);
    assert.doesNotMatch(source, /฿|\b(?:390|490|990)\b/);
  }

  // A plan number may not reach the admin entitlement read or the chip either:
  // the view's state is the only input.
  for (const path of [
    'apps/booking-admin/src/lib/admin-service.ts',
    'apps/booking-admin/src/app/dashboard/page.tsx',
    'apps/booking-consumer/src/app/book/[slug]/page.tsx',
  ]) {
    const lines = read(path)
      .split('\n')
      .filter((line) => /entitlement/i.test(line));
    for (const line of lines) {
      assert.doesNotMatch(
        line,
        /free_trial|basic_490|pro_990|services_limit|staff_limit|entitlement_plans|\b(?:390|490|990)\b/,
        `${path}: an entitlement line embeds a plan limit or price: ${line.trim()}`,
      );
    }
  }
});

test('the consumer page adds no new buyer-visible sentence for this change', () => {
  const page = read('apps/booking-consumer/src/app/book/[slug]/page.tsx');

  // An exclusion-only shop renders the existing booking-disabled copy...
  assert.match(
    page,
    /case 'BOOKING_DISABLED':\s*\n\s*return \{ Icon: CalendarOff, title: t\('blocked\.title'\), description: t\('blocked\.description'\) \};/,
  );
  // ...and the entitlement reason strings are not rendered to a buyer at all.
  for (const key of ENTITLEMENT_KEYS) {
    assert.doesNotMatch(page, new RegExp(key), `${key} must not be rendered on the customer page`);
  }
  const consumerSource = read('apps/booking-consumer/src/lib/booking-state.ts');
  for (const key of ENTITLEMENT_KEYS) {
    assert.doesNotMatch(consumerSource, new RegExp(key));
  }
});

// ---------------------------------------------------------------------------
// 8. The database guard is still the authority, and nothing was retargeted
// ---------------------------------------------------------------------------

test('the hold RPC refusals the client can still meet are named by the migration, not re-implemented here', () => {
  const migration = read('supabase/bk01-migrations/20260926120000_bk01_entitlement_packs.sql');
  assert.match(migration, /MESSAGE = 'SERVICE_OUTSIDE_PLAN'/);
  assert.match(migration, /MESSAGE = 'STAFF_OUTSIDE_PLAN'/);

  const service = read('apps/booking-consumer/src/lib/booking-service.ts');
  // The client does not re-derive the plan: it reads the view and lets the RPC
  // remain the enforcement point.
  assert.match(service, /bk01_shop_entitlement_status/);
  assert.doesNotMatch(service, /SERVICE_OUTSIDE_PLAN|STAFF_OUTSIDE_PLAN/);
});
