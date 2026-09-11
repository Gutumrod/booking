import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { customerPageUrl, BOOKING_SITE_URL } from '../apps/booking-admin/src/lib/customer-page-url.ts';

const read = (rel: string) => readFileSync(new URL(`../apps/booking-admin/src/${rel}`, import.meta.url), 'utf8');

test('customerPageUrl only yields a URL for a real slug (no fake URL or #)', () => {
  assert.equal(customerPageUrl('good-cuts'), `${BOOKING_SITE_URL}/book/good-cuts`);
  assert.equal(customerPageUrl('  good-cuts  '), `${BOOKING_SITE_URL}/book/good-cuts`);
  for (const missing of [null, undefined, '', '   ']) assert.equal(customerPageUrl(missing), null);
  assert.equal(customerPageUrl('a b/c'), `${BOOKING_SITE_URL}/book/a%20b%2Fc`);
});

// NEW-F9 source wiring: one Preview action on every /dashboard route header,
// visible at every breakpoint, fed by the layout's slug, never readiness-gated.
test('dashboard layout provides the shop slug to every dashboard route', () => {
  const layout = read('app/dashboard/layout.tsx');
  assert.match(layout, /<ShopSlugProvider slug=\{shop\?\.slug \?\? null\}>/);
  assert.match(layout, /\{children\}\s*<\/ShopSlugProvider>/);
});

test('every dashboard route header renders the Preview action', () => {
  for (const rel of [
    'app/dashboard/page.tsx',
    'app/dashboard/tickets/page.tsx',
    'app/dashboard/tickets/new/page.tsx',
    'app/dashboard/tickets/[id]/page.tsx',
  ]) {
    const src = read(rel);
    const previews = src.match(/<PreviewCustomerPageLink \/>/g) ?? [];
    const toggles = src.match(/<LanguageToggle \/>/g) ?? [];
    assert.ok(previews.length > 0, `${rel} must render Preview`);
    assert.equal(previews.length, toggles.length, `${rel}: Preview beside every header LanguageToggle`);
  }
});

test('Preview link is visible on small screens with an accessible label', () => {
  const src = read('components/preview-customer-page.tsx');
  const anchor = src.slice(src.indexOf('<a'), src.indexOf('</a>'));
  const anchorClass = /className="([^"]*)"/.exec(anchor)![1];
  assert.doesNotMatch(anchorClass, /(^|\s)hidden(\s|$)/, 'anchor itself must not be hidden at any breakpoint');
  assert.match(anchor, /aria-label=\{t\('previewCustomerPage'\)\}/);
  assert.match(anchor, /title=\{t\('previewCustomerPage'\)\}/);
  assert.match(src, /customerPageUrl\(useContext\(ShopSlugContext\)\)/);
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /readiness|public_booking|blocked_r7|payment/i, 'Preview is not gated on readiness/payment/R7');
});

test('dashboard page no longer hides Preview or links to #', () => {
  const src = read('app/dashboard/page.tsx');
  assert.doesNotMatch(src, /hidden sm:flex/);
  assert.doesNotMatch(src, /: '#'/);
});
