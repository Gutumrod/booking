// WU3 (L-15 / L-01) legal draft guard.
//
// Proves the Terms of Service and the Privacy Policy exist in Thai and English
// with a shared message-key set, that the key-set parity check passes, that every
// produced page carries a visible pre-launch draft marker naming the missing
// Owner and legal approval, that each document has a reachable route before any
// payment step, and that the drafts do not invent Owner-supplied facts.
//
// Static only: it reads JSON and source text. It opens no database connection,
// reads no .env file and makes no network request.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Normalise CRLF: Windows checkouts (core.autocrlf=true) turn the .md drafts into CRLF while the
// message strings use LF, which made the content comparison fail on Windows only.
const read = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const readJson = (rel: string) => JSON.parse(read(rel));

const messages = {
  th: readJson('apps/booking-consumer/messages/th.json'),
  en: readJson('apps/booking-consumer/messages/en.json'),
};
const locales = ['th', 'en'] as const;
const documentKeys = ['terms', 'privacy'] as const;

/** Every leaf path of a nested object, dotted, sorted. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    keyPaths(nested, prefix ? `${prefix}.${key}` : key),
  );
}

test('Thai and English message key sets are identical for the legal documents', () => {
  const th = keyPaths(messages.th.legal).sort();
  const en = keyPaths(messages.en.legal).sort();
  const missingInEn = th.filter((key) => !en.includes(key));
  const missingInTh = en.filter((key) => !th.includes(key));
  assert.deepEqual(missingInEn, [], `keys present in th.json but missing from en.json: ${missingInEn.join(', ')}`);
  assert.deepEqual(missingInTh, [], `keys present in en.json but missing from th.json: ${missingInTh.join(', ')}`);
  assert.equal(th.length, en.length);
  assert.ok(th.length > 0);
});

test('Thai and English declare the same sections for both documents', () => {
  for (const documentKey of documentKeys) {
    const thSections = Object.keys(messages.th.legal[documentKey].sections).sort();
    const enSections = Object.keys(messages.en.legal[documentKey].sections).sort();
    assert.deepEqual(enSections, thSections, `${documentKey} section keys differ between locales`);
    assert.ok(thSections.length >= 14, `${documentKey} must keep its full section list`);
  }
});

test('every section has a heading and a non-empty body in both languages', () => {
  for (const locale of locales) {
    for (const documentKey of documentKeys) {
      const doc = messages[locale].legal[documentKey];
      assert.ok(doc.title.trim().length > 0);
      assert.ok(doc.intro.trim().length > 0);
      for (const [key, section] of Object.entries<{ h: string; b: string }>(doc.sections)) {
        assert.ok(section.h.trim().length > 0, `${locale}.${documentKey}.${key} heading is empty`);
        assert.ok(section.b.trim().length > 0, `${locale}.${documentKey}.${key} body is empty`);
      }
    }
  }
});

test('Thai sections are Thai text, not English left in place', () => {
  for (const documentKey of documentKeys) {
    for (const [key, section] of Object.entries<{ h: string; b: string }>(messages.th.legal[documentKey].sections)) {
      assert.match(section.h, /[\u0E00-\u0E7F]/, `th.${documentKey}.${key} heading has no Thai script`);
      assert.match(section.b, /[\u0E00-\u0E7F]/, `th.${documentKey}.${key} body has no Thai script`);
    }
  }
});

test('English sections contain no Thai-only script substitution', () => {
  for (const documentKey of documentKeys) {
    for (const [key, section] of Object.entries<{ h: string; b: string }>(messages.en.legal[documentKey].sections)) {
      assert.ok(/[A-Za-z]/.test(section.h), `en.${documentKey}.${key} heading has no Latin script`);
      assert.ok(/[A-Za-z]/.test(section.b), `en.${documentKey}.${key} body has no Latin script`);
    }
  }
});

test('the draft marker names the missing Owner approval and qualified legal review', () => {
  for (const locale of locales) {
    const meta = messages[locale].legal.meta;
    assert.match(meta.draftBadge, locale === 'th' ? /ร่าง/ : /DRAFT/i);
    const marker = `${meta.draftBadge} ${meta.draftTitle} ${meta.draftBody} ${meta.draftFooter}`;
    assert.match(marker, locale === 'th' ? /เจ้าของผลิตภัณฑ์/ : /Owner/);
    assert.match(marker, locale === 'th' ? /กฎหมาย/ : /legal|lawyer/i);
    assert.match(marker, locale === 'th' ? /ยังไม่/ : /not final|unreviewed|PENDING/i);
    assert.ok(meta.lastUpdatedValue.includes('OWNER INPUT'));
  }
});

test('every rendered page carries the draft marker on screen', () => {
  const component = read('apps/booking-consumer/src/components/legal-document.tsx');
  // The notice is rendered above and below the section list, so a reader sees it
  // without scrolling past the whole document.
  const notices = component.match(/<LegalDraftNotice /g) ?? [];
  assert.equal(notices.length, 2, 'LegalDraftNotice must render at both ends of the document');
  assert.match(component, /role="note"/);
  assert.match(component, /aria-label=\{t\('draftBadge'\)\}/);
  assert.doesNotMatch(component, /hidden/, 'the draft marker must never be hidden at any breakpoint');
});

test('each document has a reachable route inside the consumer app', () => {
  const routes: Record<(typeof documentKeys)[number], { page: string; key: string }> = {
    terms: { page: 'apps/booking-consumer/src/app/legal/terms/page.tsx', key: 'terms' },
    privacy: { page: 'apps/booking-consumer/src/app/legal/privacy/page.tsx', key: 'privacy' },
  };
  for (const documentKey of documentKeys) {
    const { page, key } = routes[documentKey];
    assert.ok(existsSync(join(root, page)), `${page} must exist`);
    assert.match(read(page), new RegExp(`<LegalDocument documentKey="${key}" />`));
  }
  // The routes the messages advertise must be the routes that exist.
  const component = read('apps/booking-consumer/src/components/legal-document.tsx');
  assert.match(component, /href=\{t\('meta\.termsRoute'\)\}/);
  assert.match(component, /href=\{t\('meta\.privacyRoute'\)\}/);
  for (const locale of locales) {
    assert.equal(messages[locale].legal.meta.termsRoute, '/legal/terms');
    assert.equal(messages[locale].legal.meta.privacyRoute, '/legal/privacy');
    assert.ok(messages[locale].legal.meta.termsRoute.length > 0 && messages[locale].legal.meta.privacyRoute.length > 0);
  }
});

test('both documents are linked before any payment step', () => {
  // Landing page and the booking page footer. The footer sits outside the step
  // switch, so the links are reachable on step 1 and step 2, before any deposit
  // is requested, and on step 3 as well.
  for (const surface of ['apps/booking-consumer/src/app/page.tsx', 'apps/booking-consumer/src/app/book/[slug]/page.tsx']) {
    const source = read(surface);
    assert.match(source, /<LegalLinks /, `${surface} must link the legal documents`);
  }
  const booking = read('apps/booking-consumer/src/app/book/[slug]/page.tsx');
  const footerOpen = booking.indexOf('<footer');
  const footerClose = booking.indexOf('</footer>');
  assert.ok(footerOpen > 0 && footerClose > footerOpen, 'booking page must keep a footer');
  const footer = booking.slice(footerOpen, footerClose);
  assert.match(footer, /<LegalLinks /, 'the legal links must be rendered in the always-present footer');
  assert.doesNotMatch(footer, /\{step ===|&&|\?\s/, 'the footer legal links must not be gated on the booking step');
  // The payment step is inside <main>; the footer follows it and renders on every step.
  const mainOpen = booking.indexOf('<main');
  assert.ok(mainOpen > 0 && mainOpen < footerOpen, 'the footer must render outside the step container');
  for (const step of ['step1.title', 'step2.title', 'step3.title']) {
    assert.ok(booking.includes(`t('${step}')`), `booking page must still render ${step}`);
  }
});

test('the drafts cover the checklist headings for terms and privacy', () => {
  const required = {
    terms: [
      'subscriptionAndBilling', // subscription wording
      'cancellationPolicy', // cancellation wording
      'availability', // service availability wording
      'merchantRelationship', // merchant/customer responsibility
      'liability', // limitation wording
      'contact', // support channel
    ],
    privacy: [
      'whatWeHold', // actual collection
      'purposes', // purposes
      'subprocessors', // recipients / subprocessor inventory
      'retention', // retention
      'dataSubjectRights', // data-subject channels and rights
      'lawfulBasis', // lawful basis
      'crossBorder', // cross-border transfer
      'cookies', // analytics/cookies
      'breach', // breach readiness
      'security', // security controls
      'contact', // privacy request channel
    ],
  } as const;
  for (const locale of locales) {
    for (const documentKey of documentKeys) {
      const sections = messages[locale].legal[documentKey].sections;
      for (const key of required[documentKey]) {
        assert.ok(key in sections, `${locale}.${documentKey} is missing the required section "${key}"`);
      }
    }
  }
  // Retention must name every class the checklist lists.
  for (const locale of locales) {
    const retention = messages[locale].legal.privacy.sections.retention.b;
    const classes = [
      'customer and booking records',
      'deposit-slip images',
      'LINE notification and binding logs',
      'authentication and account data',
      'Stripe and billing records',
      'support tickets and attachments',
      'security and audit logs',
      'backups after account closure',
    ];
    for (const item of classes) {
      assert.ok(retention.includes(item), `${locale} retention section is missing "${item}"`);
    }
  }
  // Subprocessors must name every party the dependency inventory lists.
  for (const locale of locales) {
    const sub = messages[locale].legal.privacy.sections.subprocessors.b;
    for (const party of ['Supabase', 'Cloudflare', 'Stripe', 'LINE', 'LY Corporation']) {
      assert.ok(sub.includes(party), `${locale} subprocessor section is missing "${party}"`);
    }
  }
});

test('PDPA rights are enumerated and no response deadline or channel is invented', () => {
  const rightTokens: Record<(typeof locales)[number], string[]> = {
    en: ['PDPA', 'access', 'correction', 'deletion', 'restriction', 'object', 'withdraw consent', 'complain'],
    th: [
      'PDPA',
      'พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล',
      'เข้าถึง',
      'แก้ไข',
      'ลบ',
      'จำกัดการประมวลผล',
      'คัดค้าน',
      'ถอนความยินยอม',
      'ร้องเรียน',
    ],
  };
  for (const locale of locales) {
    const rights = messages[locale].legal.privacy.sections.dataSubjectRights.b;
    for (const token of rightTokens[locale]) {
      assert.ok(rights.includes(token), `${locale} rights section is missing "${token}"`);
    }
    assert.ok(rights.includes('OWNER INPUT'), 'the unapproved response deadline must stay an Owner input');
  }
});

test('no invented company identity, contact address or commercial term appears', () => {
  const forbidden = [
    /[\w.+-]+@[\w-]+\.[\w.]+/, // any e-mail address
    /\b\d{13}\b/, // a company registration number / Thai tax id
    /100%|100 %/, // absolute outcome or security claim
    /ปลอดภัย 100|100% ปลอดภัย/,
    /guaranteed no-show rate of/i,
    /฿4,?900|฿9,?900|4900 baht|9900 baht/i, // retired annual pricing
  ];
  for (const locale of locales) {
    const blob = JSON.stringify(messages[locale].legal);
    for (const pattern of forbidden) {
      assert.doesNotMatch(blob, pattern, `${locale} legal copy matched forbidden ${pattern}`);
    }
  }
  // The retired commercial model must never come back: the old ฿490/฿990 pilot
  // reference points, the free-plan-as-14-day-trial reading, and the 100/500
  // paid booking wall the database still blocked Basic at.
  const retired = [
    /฿490|490 baht|490 บาท/i,
    /฿990|990 baht|990 บาท/i,
    /100 or 500|100 หรือ 500/i,
  ];
  for (const locale of locales) {
    const blob = JSON.stringify(messages[locale].legal);
    for (const pattern of retired) {
      assert.doesNotMatch(blob, pattern, `${locale} legal copy still states the retired ${pattern}`);
    }
  }

  // The billing section must state the locked packs, and every value the Owner
  // has not supplied must stay an explicit placeholder rather than a number.
  const locked: Record<(typeof locales)[number], RegExp[]> = {
    en: [
      /free forever/i, // Free is free forever
      /50 bookings per calendar month/i, // 50 bookings per calendar month
      /\b1 shop\b/i, // 1 shop
      /\b3 services\b/i, // 3 services
      /no PromptPay deposit/i, // a Free shop takes no PromptPay deposit
      /฿390/, // Basic price, THB
      /\$11/, // Basic price, USD
      /no booking ceiling/i, // Basic has no booking ceiling
      /Pro is not on sale/i, // Pro is not on sale
      /annual billing is not open/i, // annual billing is not open
      /Basic trial promotion/i, // the 14-day offer is a Basic promotion
      /separate from Free/i, // and it is separate from Free
      /falls back to Free entitlements and is not closed/i, // trial expiry does not close the shop
      /precondition for selling Pro publicly/i, // Pro gated on automatic verification
    ],
    th: [
      /ฟรีตลอดไป/, // Free is free forever
      /50\s*คิวต่อเดือน/, // 50 bookings per calendar month
      /1\s*ร้าน/, // 1 shop
      /3\s*บริการ/, // 3 services
      /ไม่มีมัดจำ PromptPay/, // a Free shop takes no PromptPay deposit
      /฿390/, // Basic price, THB
      /\$11/, // Basic price, USD
      /ไม่มีเพดานจำนวนคิว/, // Basic has no booking ceiling
      /Pro ยังไม่เปิดขาย/, // Pro is not on sale
      /รายปียังไม่เปิด/, // annual billing is not open
      /โปรโมชันทดลองใช้แพ็ก Basic/, // the 14-day offer is a Basic promotion
      /แยกจากแพ็กฟรี/, // and it is separate from Free
      /ตกไปใช้สิทธิ์ของแพ็กฟรีโดยไม่ถูกปิด/, // trial expiry does not close the shop
      /เงื่อนไขบังคับก่อนขาย Pro สู่สาธารณะ/, // Pro gated on automatic verification
    ],
  };
  for (const locale of locales) {
    const billing = messages[locale].legal.terms.sections.subscriptionAndBilling.b;
    assert.match(billing, /OWNER INPUT/);
    for (const pattern of locked[locale]) {
      assert.match(billing, pattern, `${locale} billing section no longer states ${pattern}`);
    }
  }
});

test('every unapproved value is left as an explicit Owner input placeholder', () => {
  for (const locale of locales) {
    for (const documentKey of documentKeys) {
      const doc = messages[locale].legal[documentKey];
      for (const [key, section] of Object.entries<{ h: string; b: string }>({ ...doc.sections, intro: { h: 'x', b: doc.intro } })) {
        const opens = (section.b.match(/\[\[OWNER INPUT:/g) ?? []).length;
        const closes = (section.b.match(/\]\]/g) ?? []).length;
        assert.equal(opens, closes, `${locale}.${documentKey}.${key} has an unclosed OWNER INPUT placeholder`);
        assert.doesNotMatch(section.b, /\[\[(?!OWNER INPUT:)/, `${locale}.${documentKey}.${key} has a non-Owner placeholder`);
      }
    }
  }
  // No placeholder may sit inside a section heading, where it would read as final text.
  for (const locale of locales) {
    for (const documentKey of documentKeys) {
      for (const [key, section] of Object.entries<{ h: string; b: string }>(messages[locale].legal[documentKey].sections)) {
        assert.doesNotMatch(section.h, /\[\[|OWNER INPUT/, `${locale}.${documentKey}.${key} heading contains a placeholder`);
      }
    }
  }
});

test('the readable draft documents exist in both languages and stay in step with the messages', () => {
  const files = [
    ['terms', 'en', 'docs/legal/TERMS-OF-SERVICE-EN.md'],
    ['terms', 'th', 'docs/legal/TERMS-OF-SERVICE-TH.md'],
    ['privacy', 'en', 'docs/legal/PRIVACY-POLICY-EN.md'],
    ['privacy', 'th', 'docs/legal/PRIVACY-POLICY-TH.md'],
  ] as const;
  for (const [documentKey, locale, rel] of files) {
    assert.ok(existsSync(join(root, rel)), `${rel} must exist`);
    const text = read(rel);
    const doc = messages[locale].legal[documentKey];
    assert.ok(text.includes(messages[locale].legal.meta.draftBadge), `${rel} must carry the draft badge`);
    assert.ok(text.includes(doc.intro), `${rel} must contain the intro`);
    for (const [key, section] of Object.entries<{ h: string; b: string }>(doc.sections)) {
      assert.ok(text.includes(section.h), `${rel} is missing heading ${key}`);
      assert.ok(text.includes(section.b), `${rel} is missing body ${key}`);
    }
    assert.ok(text.includes('OWNER INPUT'), `${rel} must keep its Owner inputs visible`);
  }
});
