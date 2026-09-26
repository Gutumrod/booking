import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildLineOaUrl,
  normalizeLineOaId,
  resolveSupportChannels,
  OWNER_INPUT_REQUIRED_MARKER,
  SUPPORT_EMAIL_ENV_KEY,
  SUPPORT_LINE_OA_ENV_KEY,
  SUPPORT_OWNER_INPUT_KEYS,
} from '../apps/booking-consumer/src/lib/support-channel.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const messagesPath = (locale: 'th' | 'en') => `apps/booking-consumer/messages/${locale}.json`;

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

const th = JSON.parse(read(messagesPath('th'))) as Dict;
const en = JSON.parse(read(messagesPath('en'))) as Dict;

// L-13 written support channel: the customer-visible copy must exist in both
// languages with exactly the same message key set (L-01).
test('support copy key sets match between Thai and English', () => {
  const thSupport = flattenKeys(th.support as Dict, 'support');
  const enSupport = flattenKeys(en.support as Dict, 'support');

  assert.ok(thSupport.length > 0, 'support section must not be empty');
  assert.deepEqual([...thSupport].sort(), [...enSupport].sort());
});

test('the whole consumer message key set matches between Thai and English', () => {
  assert.deepEqual(flattenKeys(th).sort(), flattenKeys(en).sort());
});

test('every support message has a non-empty value in both languages', () => {
  for (const locale of ['th', 'en'] as const) {
    const dict = (locale === 'th' ? th : en).support as Dict;
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', `${locale}.support.${key} must be a string`);
      assert.ok((value as string).trim().length > 0, `${locale}.support.${key} must not be empty`);
    }
  }
});

// No approved response-time or service-level target exists (SUPPORT_RUNBOOK
// states its targets are internal only and public hours/SLA need owner
// approval), so no such promise may appear in customer-facing copy.
test('support copy makes no response-time or service-level promise', () => {
  const forbidden =
    /(within|respond|response time|business day|24\/7|sla|guarantee\w*|ชั่วโมง|วันทำการ|นาที|ตลอด 24|รับประกัน|ตอบกลับภายใน)/i;
  for (const locale of ['th', 'en'] as const) {
    const support = JSON.stringify((locale === 'th' ? th : en).support);
    assert.doesNotMatch(support, forbidden, `${locale} support copy must not promise a response time`);
  }
});

test('support copy states that live call support is not available', () => {
  assert.match((en.support as Dict).noLiveCall as string, /not available/i);
  assert.match((en.support as Dict).writtenOnlyBody as string, /written|text/i);
  assert.match((th.support as Dict).noLiveCall as string, /ไม่มี/);
  assert.match((th.support as Dict).writtenOnlyBody as string, /ข้อความ/);
});

test('the support entry point is reachable from the normal customer journey', () => {
  for (const page of [
    'apps/booking-consumer/src/app/page.tsx',
    'apps/booking-consumer/src/app/book/[slug]/page.tsx',
    'apps/booking-consumer/src/app/manage-booking/page.tsx',
  ]) {
    assert.match(read(page), /href="\/support"/, `${page} must link to /support`);
  }
  assert.match(read('apps/booking-consumer/src/app/support/page.tsx'), /SupportContact/);
  assert.match(read('apps/booking-consumer/src/components/support-contact.tsx'), /SupportContact/);
});

// The contact values are configuration, never invented in code.
test('unconfigured support channels render a marked owner-input placeholder', () => {
  const resolved = resolveSupportChannels({});

  assert.equal(resolved.hasConfiguredChannel, false);
  assert.equal(resolved.configured.length, 0);
  assert.equal(resolved.unresolved.length, 2);

  for (const [channel, envKey] of [
    [resolved.email, SUPPORT_EMAIL_ENV_KEY],
    [resolved.line, SUPPORT_LINE_OA_ENV_KEY],
  ] as const) {
    assert.equal(channel.value, null);
    assert.equal(channel.href, null);
    assert.equal(channel.placeholder, `[[${OWNER_INPUT_REQUIRED_MARKER}: ${envKey}]]`);
  }

  assert.deepEqual([...SUPPORT_OWNER_INPUT_KEYS], [SUPPORT_EMAIL_ENV_KEY, SUPPORT_LINE_OA_ENV_KEY]);
});

test('blank or whitespace configuration is treated as unconfigured, not as a value', () => {
  const resolved = resolveSupportChannels({
    [SUPPORT_EMAIL_ENV_KEY]: '   ',
    [SUPPORT_LINE_OA_ENV_KEY]: '',
  });
  assert.equal(resolved.email.value, null);
  assert.equal(resolved.line.value, null);
  assert.equal(resolved.hasConfiguredChannel, false);
});

test('configured support channels resolve to real links with no placeholder', () => {
  const resolved = resolveSupportChannels({
    [SUPPORT_EMAIL_ENV_KEY]: 'support@example.invalid',
    [SUPPORT_LINE_OA_ENV_KEY]: 'example_oa',
  });

  assert.equal(resolved.hasConfiguredChannel, true);
  assert.equal(resolved.email.value, 'support@example.invalid');
  assert.equal(resolved.email.href, 'mailto:support@example.invalid');
  assert.equal(resolved.email.placeholder, null);
  assert.equal(resolved.line.value, '@example_oa');
  assert.equal(resolved.line.href, 'https://line.me/R/ti/p/@example_oa');
  assert.equal(resolved.line.placeholder, null);
});

test('LINE identifier normalization always yields an @handle link', () => {
  assert.equal(normalizeLineOaId('example_oa'), '@example_oa');
  assert.equal(normalizeLineOaId('@example_oa'), '@example_oa');
  assert.equal(buildLineOaUrl('example_oa'), 'https://line.me/R/ti/p/@example_oa');
});

// No invented contact value may sit in the support surface source.
test('support surface source contains no hard-coded contact value', () => {
  const sources = [
    'apps/booking-consumer/src/lib/support-channel.ts',
    'apps/booking-consumer/src/components/support-contact.tsx',
    'apps/booking-consumer/src/app/support/page.tsx',
  ]
    .map(read)
    .join('\n');

  assert.doesNotMatch(sources, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'no literal e-mail address');
  assert.doesNotMatch(sources, /line\.me\/R\/ti\/p\/@[A-Za-z0-9._-]+/, 'no literal LINE OA identifier');
  assert.doesNotMatch(sources, /(\+66|0[689])[\d\s-]{7,}/, 'no literal telephone number');
});
