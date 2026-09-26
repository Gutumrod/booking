import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// WU-A2 evidence helper: the key-set parity check must report the REAL Thai and
// English key counts (total + plans section), not just "sets are equal".
// Same flattening rule as tests/i18n-message-parity.test.ts.
const read = (name: 'th' | 'en') =>
  JSON.parse(readFileSync(new URL(`../apps/booking-consumer/messages/${name}.json`, import.meta.url), 'utf8'));

const flatten = (value: unknown, prefix = ''): string[] =>
  Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    child && typeof child === 'object' && !Array.isArray(child)
      ? flatten(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

test('consumer message key-set parity check reports real counts', () => {
  const thDoc = read('th');
  const enDoc = read('en');

  const th = flatten(thDoc).sort();
  const en = flatten(enDoc).sort();
  const thPlans = flatten(thDoc.plans).sort();
  const enPlans = flatten(enDoc.plans).sort();

  const onlyThai = th.filter((key) => !en.includes(key));
  const onlyEnglish = en.filter((key) => !th.includes(key));

  console.log('WUA2-PARITY th total keys :', th.length);
  console.log('WUA2-PARITY en total keys :', en.length);
  console.log('WUA2-PARITY th plans keys :', thPlans.length);
  console.log('WUA2-PARITY en plans keys :', enPlans.length);
  console.log('WUA2-PARITY only in th    :', JSON.stringify(onlyThai));
  console.log('WUA2-PARITY only in en    :', JSON.stringify(onlyEnglish));

  assert.equal(th.length, en.length, 'Thai and English total key counts must be equal');
  assert.equal(thPlans.length, enPlans.length, 'Thai and English plans key counts must be equal');
  assert.deepEqual(onlyThai, [], 'no key may exist only in Thai');
  assert.deepEqual(onlyEnglish, [], 'no key may exist only in English');
});
