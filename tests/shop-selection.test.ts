import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectActiveMembership } from '../apps/booking-admin/src/lib/shop-selection.ts';
import { tenantPreviewUrl, BOOKING_SITE_URL } from '../apps/booking-admin/src/lib/customer-page-url.ts';

const adminSrc = fileURLToPath(new URL('../apps/booking-admin/src/', import.meta.url));
const read = (rel: string) => readFileSync(join(adminSrc, rel), 'utf8');

// Fake query builder that records the chain and resolves rows in the order
// the recorded ORDER BY implies -- proves determinism regardless of the
// storage order the database happens to return.
function fakeClient(rows: Array<{ shop_id: string; role: string; created_at: string | null; user_id: string }>) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder = {
    select: (...a: unknown[]) => (calls.push(['select', ...a]), builder),
    eq: (...a: unknown[]) => (calls.push(['eq', ...a]), builder),
    order: (...a: unknown[]) => (calls.push(['order', ...a]), builder),
    limit: (...a: unknown[]) => (calls.push(['limit', ...a]), builder),
    maybeSingle: async () => {
      calls.push(['maybeSingle']);
      const userId = calls.find((c) => c[0] === 'eq' && c[1] === 'user_id')![2];
      const mine = rows.filter((r) => r.user_id === userId);
      mine.sort((a, b) => {
        if (a.created_at !== b.created_at) {
          if (a.created_at === null) return 1; // NULLS LAST
          if (b.created_at === null) return -1;
          return a.created_at < b.created_at ? -1 : 1;
        }
        return a.shop_id < b.shop_id ? -1 : 1;
      });
      const top = mine[0];
      return { data: top ? { shop_id: top.shop_id, role: top.role } : null, error: null };
    },
  };
  const client = { from: (t: string) => (calls.push(['from', t]), builder) };
  return { client: client as never, calls };
}

test('canonical selection query: own memberships, created_at ASC NULLS LAST, shop_id ASC, one row', async () => {
  const { client, calls } = fakeClient([]);
  await selectActiveMembership(client, 'user-1');
  assert.deepEqual(calls, [
    ['from', 'shop_users'],
    ['select', 'shop_id, role'],
    ['eq', 'user_id', 'user-1'],
    ['order', 'created_at', { ascending: true, nullsFirst: false }],
    ['order', 'shop_id', { ascending: true }],
    ['limit', 1],
    ['maybeSingle'],
  ]);
});

test('multi-shop user resolves to the same shop regardless of row order', async () => {
  const rows = [
    { shop_id: 'shop-b', role: 'admin', created_at: '2026-09-02T00:00:00Z', user_id: 'u' },
    { shop_id: 'shop-a', role: 'owner', created_at: '2026-09-01T00:00:00Z', user_id: 'u' },
    { shop_id: 'shop-c', role: 'owner', created_at: null, user_id: 'u' },
    { shop_id: 'shop-z', role: 'owner', created_at: '2026-01-01T00:00:00Z', user_id: 'someone-else' },
  ];
  for (const order of [rows, [...rows].reverse(), [rows[2], rows[0], rows[3], rows[1]]]) {
    const { data } = await selectActiveMembership(fakeClient(order).client, 'u');
    assert.deepEqual(data, { shop_id: 'shop-a', role: 'owner' });
  }
  const tie = [
    { shop_id: 'shop-2', role: 'owner', created_at: '2026-09-01T00:00:00Z', user_id: 'u' },
    { shop_id: 'shop-1', role: 'staff', created_at: '2026-09-01T00:00:00Z', user_id: 'u' },
  ];
  assert.equal((await selectActiveMembership(fakeClient(tie).client, 'u')).data!.shop_id, 'shop-1');
  assert.equal((await selectActiveMembership(fakeClient(tie).client, 'nobody')).data, null);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test('no admin code selects shop_users outside the canonical helper', () => {
  const offenders = walk(adminSrc)
    .filter((f) => !f.endsWith(join('lib', 'shop-selection.ts')))
    .filter((f) => /from\(\s*['"]shop_users['"]\s*\)/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('layout, dashboard data, ticket data and billing all use the canonical selection', () => {
  for (const rel of [
    'app/dashboard/layout.tsx',
    'lib/admin-service.ts',
    'lib/ticket-service.ts',
    'app/api/billing/checkout/route.ts',
    'app/api/billing/portal/route.ts',
  ]) {
    assert.match(read(rel), /await selectActiveMembership\(supabase, /, `${rel} must use selectActiveMembership`);
  }
  // Preview identity is the layout's selected membership; the bookings-tab link
  // is the dashboard data's own shop (same canonical selection).
  assert.match(read('app/dashboard/layout.tsx'), /<ShopSlugProvider shopId=\{membership\.shop_id\}/);
  assert.match(read('lib/admin-service.ts'), /\.from\('shops'\)[\s\S]{0,200}\.eq\('id', membership\.shop_id\)/);
  assert.match(read('app/dashboard/page.tsx'), /customerPageUrl\(shopSlug\)/);
});

test('Preview fails closed on a tenant mismatch or missing identity/slug', () => {
  const identity = { shopId: 'shop-a', slug: 'good-cuts' };
  const url = `${BOOKING_SITE_URL}/book/good-cuts`;
  assert.equal(tenantPreviewUrl(identity), url);
  assert.equal(tenantPreviewUrl(identity, ''), url, 'page data still loading');
  assert.equal(tenantPreviewUrl(identity, 'shop-a'), url);
  assert.equal(tenantPreviewUrl(identity, 'shop-b'), null, 'never preview another tenant');
  assert.equal(tenantPreviewUrl({ shopId: null, slug: 'good-cuts' }), null);
  assert.equal(tenantPreviewUrl({ shopId: 'shop-a', slug: null }), null, 'failed slug read hides Preview');
});
