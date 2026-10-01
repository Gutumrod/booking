import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  resolveShopDepositPolicy,
  SHOP_DEPOSIT_POLICY_MAX_CHARS,
} from '../apps/booking-consumer/src/lib/shop-deposit-policy.ts';
import { loadShopDepositPolicyNotice } from './house-shop-deposit-policy-render.mjs';

/**
 * HOUSE-BK01-SHOP-POLICY-APP — the customer-facing half (brief 26, section 2).
 *
 * Four claims are pinned here, each with a refusal case so a vacuous
 * implementation cannot pass:
 *   1. the language rule (own language -> other language -> neutral message);
 *   2. the customer sees the shop's text BEFORE the slip picker and the confirm
 *      button;
 *   3. the text is PLAIN TEXT — proven by really rendering the component and
 *      checking React's escaping, not by reading the source;
 *   4. a single 1500-character unbroken token still fits a 375px viewport.
 */

const read = (path: string) => readFileSync(path, 'utf8');

/**
 * Strip `//` and block comments so a source-level ban tests the CODE, not a
 * comment that explains the ban (the notice documents the rules it obeys).
 */
const stripComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ 	]*\/\/.*$/gm, ' ');
const BOOK_PAGE = 'apps/booking-consumer/src/app/book/[slug]/page.tsx';
const NOTICE = 'apps/booking-consumer/src/components/shop-deposit-policy.tsx';
const CONSUMER_MESSAGES = [
  'apps/booking-consumer/messages/th.json',
  'apps/booking-consumer/messages/en.json',
] as const;

const { ShopDepositPolicyNotice, toShopDepositPolicyLocale } = await loadShopDepositPolicyNotice();

/**
 * React escapes `& < > " '` in text children. Reproduce that exactly so the
 * "the payload is still visible as text" assertion cannot be satisfied by a
 * component that silently drops the value.
 */
function escapeAsReactText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Render the real notice component for one policy + one payload. */
function renderNotice(policy: { th: string | null; en: string | null }): string {
  return renderToStaticMarkup(
    React.createElement(ShopDepositPolicyNotice, { policy }) as React.ReactElement,
  );
}

test('policy language rule: own language wins, other language is the fallback, nothing gives the neutral message', () => {
  const policy = { th: 'นโยบายภาษาไทย', en: 'English policy' };
  assert.deepEqual(resolveShopDepositPolicy(policy, 'th'), { kind: 'published', text: 'นโยบายภาษาไทย', locale: 'th' });
  assert.deepEqual(resolveShopDepositPolicy(policy, 'en'), { kind: 'published', text: 'English policy', locale: 'en' });

  // Thai-only shop + English viewer -> the Thai text, explicitly marked fallback.
  assert.deepEqual(resolveShopDepositPolicy({ th: 'เฉพาะไทย', en: null }, 'en'), { kind: 'fallback', text: 'เฉพาะไทย', locale: 'th' });
  // English-only shop + Thai viewer -> the English text, marked fallback.
  assert.deepEqual(resolveShopDepositPolicy({ th: null, en: 'English only' }, 'th'), { kind: 'fallback', text: 'English only', locale: 'en' });

  // Nothing published -> the neutral message state, never an empty published box.
  assert.equal(resolveShopDepositPolicy({ th: null, en: null }, 'th').kind, 'missing');
  assert.equal(resolveShopDepositPolicy({ th: null, en: null }, 'en').kind, 'missing');
  assert.equal(resolveShopDepositPolicy(null, 'th').kind, 'missing');
  assert.equal(resolveShopDepositPolicy(undefined, 'en').kind, 'missing');

  // Non-vacuity: whitespace is not a policy.
  assert.equal(resolveShopDepositPolicy({ th: '   \n  ', en: '\t' }, 'th').kind, 'missing');
  assert.equal(resolveShopDepositPolicy({ th: '  real  ', en: null }, 'th').text, 'real');
});

test('only th and en are policy locales, and an unknown app locale reads Thai first', () => {
  assert.equal(toShopDepositPolicyLocale('en'), 'en');
  assert.equal(toShopDepositPolicyLocale('th'), 'th');
  assert.equal(toShopDepositPolicyLocale('fr'), 'th');
  assert.equal(toShopDepositPolicyLocale(''), 'th');
});

test('the shop text renders as escaped plain text — real render of the real component', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    'javascript:alert(1)',
    '<a href="javascript:alert(1)">click</a>',
    '</p><script>alert(document.cookie)</script>',
    '<svg/onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '&#60;script&#62;alert(1)&#60;/script&#62;',
  ];

  for (const payload of payloads) {
    const html = renderNotice({ th: payload, en: null });
    const outsideLegalLinks = html.replace(/<a href="\/legal\/[^"]*"[^>]*>/g, '');
    assert.equal(/<script/i.test(outsideLegalLinks), false, `script tag survived for ${payload}`);
    assert.equal(/<img/i.test(outsideLegalLinks), false, `img tag survived for ${payload}`);
    assert.equal(/<svg/i.test(outsideLegalLinks), false, `svg tag survived for ${payload}`);
    assert.equal(/<iframe/i.test(outsideLegalLinks), false, `iframe tag survived for ${payload}`);
    assert.equal(/<a\s+href/i.test(outsideLegalLinks), false, `anchor survived for ${payload}`);
    // An event handler only matters when it is an ATTRIBUTE OF A LIVE TAG; the
    // escaped characters inside the text node are inert and must stay readable.
    assert.equal(/<[a-zA-Z][^>]*\son(?:error|load|click)\s*=/i.test(outsideLegalLinks), false, `live event handler survived for ${payload}`);
    assert.ok(html.includes(escapeAsReactText(payload)), `the payload must still be readable as text: ${payload}`);
  }
});

test('the only links the policy block renders are the app\'s own legal routes', () => {
  const html = renderNotice({ th: 'javascript:alert(1)', en: null });
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, ['/legal/terms', '/legal/privacy'], 'no href may come from shop text');
});

test('the neutral state and the fallback state render their own message, not an empty box', () => {
  const missing = renderNotice({ th: null, en: null });
  assert.match(missing, /data-policy-state="missing"/);
  assert.match(missing, /SHOP_POLICY_NOT_SET/);
  assert.equal(/data-testid="shop-deposit-policy-text"[^>]*><\/p>/.test(missing), false);

  const fallback = renderNotice({ th: null, en: 'English only terms' });
  assert.match(fallback, /data-policy-state="fallback"/);
  assert.match(fallback, /data-policy-locale="en"/);
  assert.match(fallback, /SHOP_POLICY_FALLBACK/);
  assert.match(fallback, /English only terms/);
});

test('the customer booking page renders the policy before the slip picker and the confirm button', () => {
  const page = read(BOOK_PAGE);
  const policyIndex = page.indexOf('<ShopDepositPolicyNotice');
  const slipIndex = page.indexOf("t('step3.slipLabel')");
  const confirmIndex = page.indexOf("t('step3.confirmDeposit')");
  const fileInputIndex = page.indexOf('type="file"');

  assert.ok(policyIndex > -1, 'the booking page must render the shop policy notice');
  assert.ok(slipIndex > -1 && confirmIndex > -1 && fileInputIndex > -1);
  assert.ok(policyIndex < slipIndex, 'policy must precede the slip label');
  assert.ok(policyIndex < fileInputIndex, 'policy must precede the slip file picker');
  assert.ok(policyIndex < confirmIndex, 'policy must precede the deposit confirm button');
});

test('the policy notice never injects raw HTML and never builds markup from shop text', () => {
  const code = stripComments(read(NOTICE));
  assert.equal(/dangerouslySetInnerHTML/.test(code), false);
  assert.equal(/innerHTML/.test(code), false);
  assert.equal(/from\s+['"](?:marked|markdown|remark|rehype|sanitize-html)['"]/.test(code), false);
  assert.equal(/require\(\s*['"](?:marked|markdown|remark|rehype|sanitize-html)['"]/.test(code), false);
  assert.equal(/marked\(/.test(code), false);
  // The merchant string reaches the DOM only as a React child.
  assert.match(code, /\{resolved\.text\}/);
  assert.match(code, /\{t\('policy\.notSet'\)\}/);
});

test('the policy notice wraps long text for a 375px viewport', () => {
  const notice = stripComments(read(NOTICE));
  assert.match(notice, /\[overflow-wrap:anywhere\]/);
  assert.match(notice, /break-words/);
  assert.equal(/w-\[\d+px\]|width:\s*\d+px|min-w-\[/.test(notice), false, 'no fixed width may be set');
  const minWidths = [...notice.matchAll(/min-w-([^\s"']+)/g)].map((match) => match[1]);
  assert.ok(minWidths.length > 0, 'the wrapping column must be constrained');
  assert.deepEqual([...new Set(minWidths)], ['0'], 'only min-w-0 may be used on the wrapping column');

  // The full 1500-character single token reaches the output un-split.
  const long = 'A'.repeat(SHOP_DEPOSIT_POLICY_MAX_CHARS);
  assert.ok(renderNotice({ th: long, en: null }).includes(long));
});

test('the customer catalogue carries the neutral message and the shop-owned disclaimer in both languages', () => {
  for (const path of CONSUMER_MESSAGES) {
    const messages = JSON.parse(read(path)) as { booking: { policy: Record<string, string> } };
    const policy = messages.booking.policy;
    assert.ok(policy, `${path} must have booking.policy`);
    for (const key of ['shopTitle', 'fallbackNote', 'shopOwnedNote', 'notSet', 'legalLinkNote', 'languageNameTh', 'languageNameEn']) {
      assert.equal(typeof policy[key], 'string', `${path} booking.policy.${key}`);
      assert.ok(policy[key].trim().length > 0, `${path} booking.policy.${key} must not be empty`);
    }
    assert.match(policy.notSet, /ติดต่อร้าน|Contact the shop/);
    assert.match(policy.shopOwnedNote, /WSTERA/);
  }
});

test('the booking page source carries the two policy columns through the shop snapshot', () => {
  const service = read('apps/booking-consumer/src/lib/booking-service.ts');
  assert.match(service, /deposit_policy_th: string \| null;/);
  assert.match(service, /deposit_policy_en: string \| null;/);
  assert.match(service, /select\('[^']*deposit_policy_th, deposit_policy_en/);
  assert.match(read(BOOK_PAGE), /\{ th: shop\.deposit_policy_th, en: shop\.deposit_policy_en \}/);
  assert.match(read(BOOK_PAGE), /<ShopDepositPolicyNotice policy=\{shopDepositPolicy\} \/>/);
});
