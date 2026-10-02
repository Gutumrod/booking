import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * BK01 house — booking-admin server-side next-intl wiring (regression guard).
 *
 * THE DEFECT (present since 80710aa2eb6b582151126373356d4fb5c8ac25c8). The admin
 * server layouts call getLocale()/getTranslations() from 'next-intl/server', but
 * the app never wired a next-intl request configuration: no src/i18n/request.ts
 * and no createNextIntlPlugin in next.config.ts. Every such server render threw
 * "Couldn't find next-intl config file" and the route answered HTTP 500
 * (/dashboard, /dashboard/tickets, /platform-admin).
 *
 * These assertions read the real source, so they fail on the pre-fix tree.
 * The live HTTP proof (dev + production build) is kept outside the repo in
 * runtime/qwen-qa/bk01-admin-i18n-20261002/ and is pasted into the report.
 */

const adminRoot = 'apps/booking-admin';
const root = join(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

test('booking-admin server layouts consume the next-intl/server request API', () => {
  for (const relative of [
    `${adminRoot}/src/app/dashboard/layout.tsx`,
    `${adminRoot}/src/app/platform-admin/layout.tsx`,
  ]) {
    const source = read(relative);
    assert.match(source, /from\s*'next-intl\/server'/, `${relative} must import from next-intl/server`);
    assert.match(source, /\bgetLocale\b/, `${relative} must call getLocale()`);
    assert.match(source, /\bgetTranslations\b/, `${relative} must call getTranslations()`);
  }
});

test('next-intl request configuration exists at the default location and returns {locale, messages}', () => {
  const relative = `${adminRoot}/src/i18n/request.ts`;
  assert.ok(existsSync(join(root, relative)), `${relative} is required for server getLocale()/getTranslations()`);
  const source = read(relative);

  assert.match(source, /import\s*\{\s*getRequestConfig\s*\}\s*from\s*'next-intl\/server'/, 'must use next-intl/server getRequestConfig');
  assert.match(source, /export\s+default\s+getRequestConfig\(/, 'must default-export getRequestConfig(...)');
  assert.match(source, /\blocale\b/, 'must return a locale');
  assert.match(source, /\bmessages\b/, 'must return messages');
  // Reuse the app's existing locale plumbing instead of inventing a second source of truth.
  assert.match(source, /\blocaleCookieName\b|\bresolveLocale\b/, 'must resolve the locale through the existing config helpers');
  assert.match(source, /\bgetMessages\b/, 'must return messages from the existing catalogue module');
  assert.match(source, /timeZone/, 'must keep the Asia/Bangkok time zone the client provider already used');
});

test('booking-admin next.config.ts applies createNextIntlPlugin without dropping existing config', () => {
  const source = read(`${adminRoot}/next.config.ts`);
  assert.match(source, /import\s+createNextIntlPlugin\s+from\s*['"]next-intl\/plugin['"]/, 'must import createNextIntlPlugin');
  assert.match(source, /createNextIntlPlugin\(\s*\)/, 'must instantiate createNextIntlPlugin()');
  assert.match(source, /export\s+default\s+withNextIntl\(\s*nextConfig\s*\)/, 'must export the plugin-wrapped config');
  // Hard invariant: the pre-existing wiring must survive.
  assert.match(source, /initOpenNextCloudflareForDev\(\)/, 'initOpenNextCloudflareForDev() must remain (OpenNext local dev)');
  assert.match(source, /allowedDevOrigins/, 'allowedDevOrigins must remain');
});

test('booking-admin adds no [locale] routing segment and leaves middleware untouched', () => {
  assert.equal(existsSync(join(root, `${adminRoot}/src/app/[locale]`)), false, 'no [locale] segment may be introduced');

  const bytes = readFileSync(join(root, `${adminRoot}/src/middleware.ts`));
  const blobHash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(blobHash, 'a669378abc5c8f80def332d245d86c369ec13b51', 'src/middleware.ts must stay byte-identical');
});

test('booking-admin confirmation screen points the user at the junk-mail folder (TH + EN)', () => {
  const th = read(`${adminRoot}/messages/th.json`);
  const en = read(`${adminRoot}/messages/en.json`);
  assert.match(th, /ถ้าไม่พบอีเมล ลองดูในจดหมายขยะ/, 'Thai checkEmailSpam must carry the junk-mail line');
  assert.match(en, /junk/i, 'the English twin must carry the equivalent junk-mail line');
});
