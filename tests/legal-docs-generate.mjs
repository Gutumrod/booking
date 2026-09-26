// Generates the readable draft documents in docs/legal/ from the shared message
// files, so the Thai and English documents and the in-app pages can never drift
// apart. Read-only with respect to every other file.
//
//   node tests/legal-docs-generate.mjs
//
// It opens no database connection, reads no .env file and touches no network.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

const th = read('apps/booking-consumer/messages/th.json');
const en = read('apps/booking-consumer/messages/en.json');

// Same order as apps/booking-consumer/src/components/legal-document.tsx
const SECTION_ORDER = {
  terms: [
    'whoWeAre', 'acceptance', 'theService', 'merchantRelationship', 'accounts',
    'bookingAndDeposits', 'subscriptionAndBilling', 'cancellationPolicy',
    'availability', 'acceptableUse', 'intellectualProperty', 'liability',
    'governingLaw', 'contact',
  ],
  privacy: [
    'controllerAndRoles', 'whatWeHold', 'purposes', 'lawfulBasis', 'cookies',
    'subprocessors', 'crossBorder', 'retention', 'dataSubjectRights', 'security',
    'breach', 'age', 'changes', 'contact',
  ],
};

const FILES = [
  ['terms', 'en', 'docs/legal/TERMS-OF-SERVICE-EN.md', '# Terms of Service (BK01) — pre-launch draft'],
  ['terms', 'th', 'docs/legal/TERMS-OF-SERVICE-TH.md', '# ข้อกำหนดการให้บริการ (BK01) — ร่างก่อนเปิดให้บริการ'],
  ['privacy', 'en', 'docs/legal/PRIVACY-POLICY-EN.md', '# Privacy Policy (BK01) — pre-launch draft'],
  ['privacy', 'th', 'docs/legal/PRIVACY-POLICY-TH.md', '# ประกาศความเป็นส่วนตัว (BK01) — ร่างก่อนเปิดให้บริการ'],
];

const sources = { th, en };
const banner = (locale, key) => {
  const m = sources[locale].legal.meta;
  return [
    `> ${m.draftBadge}`,
    '>',
    `> ${m.draftBody}`,
    '>',
    `> ${m.draftFooter}`,
    '>',
    `> ${m.ownerInputLegend}`,
    '>',
    `> ${m.lastUpdatedLabel} ${m.lastUpdatedValue}`,
    '',
    `*${locale === 'th' ? 'เข้าถึงได้ที่' : 'Reachable at'}: \`/${key === 'terms' ? 'legal/terms' : 'legal/privacy'}\`*`,
  ].join('\n');
};

let written = 0;
for (const [key, locale, relPath, heading] of FILES) {
  const doc = sources[locale].legal[key];
  const parts = [heading, '', banner(locale, key), '', doc.intro, ''];
  for (const sectionKey of SECTION_ORDER[key]) {
    const section = doc.sections[sectionKey];
    if (!section) throw new Error(`missing section ${key}.${sectionKey} in ${locale}.json`);
    parts.push(`## ${section.h}`, '', section.b, '');
  }
  const out = `${parts.join('\n').trimEnd()}\n`;
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, out, 'utf8');
  written += 1;
  console.log(`wrote ${relPath} (${out.length} bytes)`);
}
console.log(`generated ${written} draft document(s)`);
