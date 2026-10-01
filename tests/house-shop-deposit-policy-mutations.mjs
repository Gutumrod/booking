#!/usr/bin/env node
// Non-vacuity harness for HOUSE-BK01-SHOP-POLICY-APP (brief 26, unit 8).
//
// Each mutation removes exactly one behaviour the unit claims. While a mutation
// is in place, the named test file must FAIL; after the edit is reverted it must
// pass again. A mutation that stays green means the test is vacuous and proves
// nothing about the shipped code.
//
// Run from the repo root:  node tests/house-shop-deposit-policy-mutations.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CONSUMER = 'apps/booking-consumer/src/lib/shop-deposit-policy.ts';
const NOTICE = 'apps/booking-consumer/src/components/shop-deposit-policy.tsx';
const BOOK_PAGE = 'apps/booking-consumer/src/app/book/[slug]/page.tsx';
const BOOKING_SERVICE = 'apps/booking-consumer/src/lib/booking-service.ts';
const ADMIN_LIB = 'apps/booking-admin/src/lib/shop-deposit-policy.ts';
const ADMIN_PAGE = 'apps/booking-admin/src/app/dashboard/page.tsx';
const ADMIN_SERVICE = 'apps/booking-admin/src/lib/admin-service.ts';
const ADMIN_MESSAGES = 'apps/booking-admin/messages/th.json';
const SQL_SPEC = 'docs/design/BK01-SHOP-DEPOSIT-POLICY-SQL-SPEC-2026-10-01.md';

const CONSUMER_TEST = 'tests/house-shop-deposit-policy-consumer.test.ts';
const ADMIN_TEST = 'tests/house-shop-deposit-policy-admin.test.ts';

const MUTATIONS = [
  {
    id: 'm1-xss-inner-html',
    claim: 'the shop text is escaped plain text, never interpreted as HTML',
    file: NOTICE,
    edits: [{
      from: '        {resolved.text}',
      to: '        <span dangerouslySetInnerHTML={{ __html: resolved.text }} />',
    }],
    test: CONSUMER_TEST,
  },
  {
    id: 'm2-no-language-fallback',
    claim: 'a shop that published only the other language still has its terms shown',
    file: CONSUMER,
    edits: [{
      from: "  const other = normalize(policy?.[otherLocale]);\n  if (other) return { kind: 'fallback', text: other, locale: otherLocale };",
      to: '  void otherLocale;',
    }],
    test: CONSUMER_TEST,
  },
  {
    id: 'm3-whitespace-counts-as-published',
    claim: 'a blank column is not a published policy',
    file: CONSUMER,
    edits: [{
      from: "  typeof value === 'string' ? value.trim() : ''",
      to: "  typeof value === 'string' ? value : ''",
    }],
    test: CONSUMER_TEST,
  },
  {
    id: 'm4-fixed-width-breaks-375px',
    claim: 'long text wraps instead of overflowing the booking page',
    file: NOTICE,
    edits: [{ from: 'className="min-w-0 whitespace-pre-wrap', to: 'className="w-[900px] whitespace-pre-wrap' }],
    test: CONSUMER_TEST,
  },
  {
    id: 'm5-policy-shown-after-the-slip',
    claim: 'the policy is shown BEFORE the slip picker and the confirm button',
    file: BOOK_PAGE,
    edits: [
      { from: '                <ShopDepositPolicyNotice policy={shopDepositPolicy} />\n', to: '' },
      { from: '        <LegalLinks className="mt-2 text-[11px]" />', to: '        <ShopDepositPolicyNotice policy={shopDepositPolicy} />\n        <LegalLinks className="mt-2 text-[11px]" />' },
    ],
    test: CONSUMER_TEST,
  },
  {
    id: 'm6-consumer-drops-the-columns',
    claim: 'the customer page actually reads the two policy columns',
    file: BOOKING_SERVICE,
    edits: [{
      from: 'require_deposit, deposit_policy_th, deposit_policy_en, is_accepting_online_bookings',
      to: 'require_deposit, is_accepting_online_bookings',
    }],
    test: CONSUMER_TEST,
  },
  {
    id: 'm7-admin-staff-can-edit',
    claim: 'only owner/admin may edit or save the policy',
    file: ADMIN_PAGE,
    edits: [
      { from: "  const depositPolicyCanEdit = shopRole === 'owner' || shopRole === 'admin';", to: '  const depositPolicyCanEdit = true;' },
      { from: "    if (shopRole !== 'owner' && shopRole !== 'admin') return;\n", to: '' },
    ],
    test: ADMIN_TEST,
  },
  {
    id: 'm8-policy-rides-on-update-shop-settings',
    claim: 'the policy never changes the frozen 9-argument update_shop_settings call',
    file: ADMIN_SERVICE,
    edits: [{
      from: "    p_line_oa_id: input.lineOaId,\n  });",
      to: "    p_line_oa_id: input.lineOaId,\n    p_deposit_policy_th: 'leak',\n  });",
    }],
    test: ADMIN_TEST,
  },
  {
    id: 'm9-limit-off-by-one',
    claim: 'the length limit is 1500 characters per language',
    file: ADMIN_LIB,
    edits: [{ from: 'export const SHOP_DEPOSIT_POLICY_MAX_CHARS = 1500;', to: 'export const SHOP_DEPOSIT_POLICY_MAX_CHARS = 1501;' }],
    test: ADMIN_TEST,
  },
  {
    id: 'm10-preview-locale-swapped',
    claim: 'the admin preview resolves the way the customer page does',
    file: ADMIN_LIB,
    edits: [{
      from: "  const own = normalizePolicyText(draft[viewerLocale]);\n  if (own) return { kind: 'published', text: own, locale: viewerLocale };",
      to: "  const own = normalizePolicyText(draft[viewerLocale === 'th' ? 'en' : 'th']);\n  if (own) return { kind: 'published', text: own, locale: viewerLocale };",
    }],
    test: ADMIN_TEST,
  },
  {
    id: 'm11-admin-copy-loses-the-disclaimer',
    claim: 'the merchant sees that WSTERA does not review the text',
    file: ADMIN_MESSAGES,
    edits: [{ from: '"policyDisclaimer": "', to: '"policyDisclaimerRenamed": "' }],
    test: ADMIN_TEST,
  },
  {
    id: 'm12-sql-spec-null-bypass',
    claim: 'the SQL spec refuses NULL (no NULL bypass) and keeps owner/admin',
    file: SQL_SPEC,
    edits: [{
      from: "    IF p_deposit_policy_th IS NULL OR p_deposit_policy_en IS NULL THEN",
      to: '    IF FALSE THEN',
    }],
    test: ADMIN_TEST,
  },
  {
    id: 'm13-sql-spec-opens-the-allowlist',
    claim: 'the spec adds no bk01_runtime function (allowlist stays 19/20)',
    file: SQL_SPEC,
    edits: [{
      from: 'GRANT EXECUTE ON FUNCTION local_service.update_shop_deposit_policy(uuid,text,text) TO authenticated;',
      to: 'GRANT EXECUTE ON FUNCTION local_service.update_shop_deposit_policy(uuid,text,text) TO authenticated, bk01_runtime;',
    }],
    test: ADMIN_TEST,
  },
  {
    id: 'm14-sql-spec-touches-the-frozen-rpc',
    claim: 'the spec must not authorise modifying update_shop_settings',
    file: SQL_SPEC,
    edits: [
      {
        from: '- **ห้ามแก้ `local_service.update_shop_settings`** (ลายเซ็น 9 พารามิเตอร์ถูกล็อกแล้ว) — เพิ่มฟังก์ชันใหม่เท่านั้น',
        to: '- **แก้ `local_service.update_shop_settings` ได้** (ลายเซ็น 9 พารามิเตอร์) — เพิ่มพารามิเตอร์ได้',
      },
      {
        from: '4. **ไม่แตะ `update_shop_settings`** เด็ดขาด',
        to: '4. **แตะ `update_shop_settings` ได้เลย**',
      },
    ],
    test: ADMIN_TEST,
  },
];

const run = (file) => spawnSync(
  process.execPath,
  ['--no-warnings', '--import', './tests/register-ts-loader.mjs', '--test', '--experimental-test-isolation=none', file],
  { encoding: 'utf8' },
).status;

function applyEdits(file, edits) {
  const original = readFileSync(file, 'utf8');
  let next = original;
  for (const { from, to } of edits) {
    if (!next.includes(from)) throw new Error(`${file}: mutation anchor not found: ${JSON.stringify(from.slice(0, 60))}`);
    next = next.replace(from, to);
  }
  writeFileSync(file, next);
  return original;
}

const results = [];
for (const mutation of MUTATIONS) {
  const original = applyEdits(mutation.file, mutation.edits);
  let mutated;
  try {
    mutated = run(mutation.test);
  } finally {
    writeFileSync(mutation.file, original);
  }
  const reverted = run(mutation.test);
  const ok = mutated !== 0 && reverted === 0;
  results.push({ ...mutation, mutated, reverted, ok });
  console.log(`${ok ? 'RED->GREEN' : 'VACUOUS  '}  ${mutation.id.padEnd(42)} mutated_exit=${mutated} reverted_exit=${reverted}`);
}

const vacuous = results.filter((row) => !row.ok);
console.log(`\n${results.length - vacuous.length}/${results.length} mutations proved non-vacuous`);
if (vacuous.length > 0) {
  for (const row of vacuous) console.log(`  NOT PROVEN: ${row.id} — ${row.claim}`);
  process.exit(1);
}
