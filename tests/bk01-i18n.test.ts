import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown;
const collect = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? collect(path) : /\.tsx?$/.test(name) ? [path] : [];
});
const keyPaths = (value: unknown, prefix = ''): string[] => {
  if (Array.isArray(value)) return [`${prefix}[]`];
  if (!value || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key));
};

test('booking admin and consumer English/Thai catalogues have identical keys', () => {
  for (const app of ['booking-admin', 'booking-consumer']) {
    const th = keyPaths(readJson(`apps/${app}/messages/th.json`)).sort();
    const en = keyPaths(readJson(`apps/${app}/messages/en.json`)).sort();
    assert.deepEqual(en, th, `${app} English and Thai message keys differ`);
  }
});

test('Booking admin and consumer page source contains no hard-coded Thai UI copy', () => {
  const files = ['apps/booking-admin/src/app', 'apps/booking-consumer/src/app'].flatMap(collect).filter((file) => file.endsWith('.tsx')); // API route templates carry Thai LINE channel copy by design.
  const findings = files.flatMap((file) => readFileSync(file, 'utf8').split(/\r?\n/)
    .flatMap((line, index) => /[\u0E00-\u0E3E\u0E40-\u0E7F]/.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : []));
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('BK01 registration copy matches the locked Free and Basic terms without advertising unapproved features', () => {
  const catalogues = ['th', 'en'].map((locale) => readJson(`apps/booking-admin/messages/${locale}.json`) as Record<string, any>);
  for (const messages of catalogues) {
    const auth = messages.auth;
    assert.match(auth.planFreeQ1, /50/);
    assert.match(auth.planFreeQ2, /1/);
    assert.match(auth.planFreeQ3, /3/);
    assert.match(auth.planBasicQ1, /fair use|fair-use/i);
    assert.match(auth.planBasicQ2, /\*/);
    assert.doesNotMatch(JSON.stringify(auth), /500 bookings|500 คิว|10 staff|10 คน|Custom LINE Token/i);
    assert.match(auth.planProBadge, /not on sale|ไม่เปิดขาย/i);
  }
});

test('English booking time suffix is intentionally empty', () => {
  const en = readJson('apps/booking-admin/messages/en.json') as { dashboard: { timeSuffix: string } };
  assert.equal(en.dashboard.timeSuffix, '', 'English time formatting uses no suffix; keep the intentional empty string');
});
