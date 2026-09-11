import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBookingRoute, createRequestGate } from '../apps/booking-consumer/src/lib/booking-route-load.ts';
import { rowOrNull, rowsOrThrow, type QueryResult } from '../apps/booking-consumer/src/lib/load-result.ts';
import { resolveBookingPageState } from '../apps/booking-consumer/src/lib/booking-state.ts';

// Fake backend per slug; accessors go through the real NEW-F8 adapters.
type Row = Record<string, unknown>;
type Backend = Record<string, {
  shop: QueryResult<Row>;
  services?: QueryResult<Row[]>;
  staff?: QueryResult<Row[]>;
  schedulesError?: boolean;
}>;
const fail = { data: null, error: { message: 'network down' } };
const ok = <T>(data: T) => ({ data, error: null });

function api(backend: Backend) {
  const byId = (id: string) => Object.values(backend).find((b) => (b.shop.data as Row | null)?.id === id)!;
  return {
    getShopBySlug: async (slug: string) => rowOrNull(backend[slug]?.shop ?? ok(null), 'shop') as never,
    getShopServices: async (id: string) => rowsOrThrow(byId(id).services ?? ok([{ id: 'sv' }]), 'services') as never,
    getShopStaff: async (id: string) => rowsOrThrow(byId(id).staff ?? ok([{ id: 'st' }]), 'staff') as never,
    getShopAvailability: async (id: string) => {
      if (byId(id).schedulesError) throw new Error('availability down');
      return { schedules: [{ staff_id: 'st' }], holidays: [] } as never;
    },
  };
}

const stateOf = (d: Awaited<ReturnType<typeof loadBookingRoute>>) => resolveBookingPageState({
  isLoading: false,
  loadError: d.loadError,
  shop: d.shop,
  serviceCount: d.services.length,
  staffCount: d.staff.length,
  scheduleCount: d.schedules.length,
  everyServicePaymentBlocked: false,
});

const backend: Backend = {
  a: { shop: ok({ id: 'A', is_accepting_online_bookings: true }) },
  empty: { shop: ok({ id: 'E', is_accepting_online_bookings: true }), services: ok([]) },
  nostaff: { shop: ok({ id: 'N', is_accepting_online_bookings: true }), staff: ok([]) },
  svcfail: { shop: ok({ id: 'F', is_accepting_online_bookings: true }), services: fail },
  stafffail: { shop: ok({ id: 'G', is_accepting_online_bookings: true }), staff: fail },
  availfail: { shop: ok({ id: 'H', is_accepting_online_bookings: true }), schedulesError: true },
  shopfail: { shop: fail },
  disabled: { shop: ok({ id: 'D', is_accepting_online_bookings: false }) },
};

test('each load is a complete snapshot for its slug with truthful state', async (t) => {
  t.mock.method(console, 'error', () => {});
  const load = (slug: string) => loadBookingRoute(slug, api(backend));
  assert.equal(stateOf(await load('a')), 'OK');
  assert.equal(stateOf(await load('missing')), 'SHOP_NOT_FOUND');
  assert.equal(stateOf(await load('empty')), 'NO_SERVICES');
  assert.equal(stateOf(await load('nostaff')), 'NO_STAFF');
  assert.equal(stateOf(await load('disabled')), 'BOOKING_DISABLED');
  for (const slug of ['shopfail', 'svcfail', 'stafffail', 'availfail']) {
    const d = await load(slug);
    assert.equal(stateOf(d), 'LOAD_ERROR', slug);
    assert.deepEqual([d.shop, d.services, d.staff, d.schedules], [null, [], [], []], `${slug}: no partial data`);
  }
});

test('a no-row slug after a loaded shop is SHOP_NOT_FOUND (shop replaced with null)', async () => {
  const first = await loadBookingRoute('a', api(backend));
  assert.ok(first.shop);
  const second = await loadBookingRoute('missing', api(backend));
  assert.equal(second.shop, null);
  assert.deepEqual(second.services, []);
  assert.equal(stateOf(second), 'SHOP_NOT_FOUND');
});

test('request gate: only the latest un-cancelled request may apply', () => {
  const gate = createRequestGate();
  const oldSlug = gate.start();
  assert.equal(oldSlug(), true);
  const newSlug = gate.start();
  assert.equal(oldSlug(), false, 'late old-slug response is dropped');
  assert.equal(newSlug(), true);
  gate.cancel(); // route changed / unmounted
  assert.equal(newSlug(), false);
});

test('late old-slug response cannot overwrite the current route result', async (t) => {
  t.mock.method(console, 'error', () => {});
  const gate = createRequestGate();
  let applied: string | null = null;
  const apply = (slug: string) => {
    const isCurrent = gate.start();
    return loadBookingRoute(slug, api(backend)).then((d) => {
      if (isCurrent()) applied = `${slug}:${stateOf(d)}`;
    });
  };
  const oldLoad = apply('a');         // starts first, resolves later
  const newLoad = apply('svcfail');   // current route
  await newLoad;
  await oldLoad;
  assert.equal(applied, 'svcfail:LOAD_ERROR');
});

test('booking page remounts per slug and gates loader results', () => {
  const src = readFileSync(new URL('../apps/booking-consumer/src/app/book/[slug]/page.tsx', import.meta.url), 'utf8');
  assert.match(src, /<BookingRoute key=\{slug\} slug=\{slug\} \/>/);
  assert.match(src, /const isCurrent = requestGate\.start\(\);/);
  assert.match(src, /if \(!isCurrent\(\)\) return;/);
  assert.match(src, /return \(\) => requestGate\.cancel\(\);/);
  assert.match(src, /setShop\(data\.shop\);/);
});
