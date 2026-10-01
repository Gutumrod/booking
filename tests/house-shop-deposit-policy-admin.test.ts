import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SHOP_DEPOSIT_POLICY_MAX_CHARS,
  isShopDepositPolicyEmpty,
  normalizePolicyText,
  policyCharLength,
  resolveShopDepositPolicyPreview,
  validateShopDepositPolicy,
} from '../apps/booking-admin/src/lib/shop-deposit-policy.ts';
import { resolveShopDepositPolicy } from '../apps/booking-consumer/src/lib/shop-deposit-policy.ts';

/**
 * HOUSE-BK01-SHOP-POLICY-APP — the merchant-facing half (brief 26, section 1).
 *
 * What is pinned:
 *   1. the length contract (1500 code points per language, exactly the SQL spec);
 *   2. the preview rule agreeing with the customer page's own resolver;
 *   3. the editor's WIRING: two languages, a preview, the "WSTERA does not review
 *      this" notice, the public-data warning, owner/admin-only editing, and a
 *      SEPARATE RPC (never `update_shop_settings`, whose 9-argument signature was
 *      frozen by the caretaker);
 *   4. the same wiring mirrored into the SQL spec that Codex implements.
 */

const read = (path: string) => readFileSync(path, 'utf8');
const ADMIN_PAGE = 'apps/booking-admin/src/app/dashboard/page.tsx';
const ADMIN_SERVICE = 'apps/booking-admin/src/lib/admin-service.ts';
const ADMIN_MESSAGES = [
  'apps/booking-admin/messages/th.json',
  'apps/booking-admin/messages/en.json',
] as const;
const SQL_SPEC = 'docs/design/BK01-SHOP-DEPOSIT-POLICY-SQL-SPEC-2026-10-01.md';
const RPC = 'update_shop_deposit_policy';

test('the length limit is 1500 characters per language, counted as code points', () => {
  assert.equal(SHOP_DEPOSIT_POLICY_MAX_CHARS, 1500);

  // Thai text with combining marks counts as characters a human would count,
  // not as its UTF-16 length (a naive .length would pass an over-limit value).
  const thai = 'มัดจำ'.repeat(500); // 2500 code points, 2500 UTF-16 units
  assert.equal(policyCharLength(thai), 2500);
  assert.equal(policyCharLength('👨‍👩‍👧'), 5); // one emoji sequence is 5 code points

  const atLimit = 'ก'.repeat(SHOP_DEPOSIT_POLICY_MAX_CHARS);
  const overLimit = 'ก'.repeat(SHOP_DEPOSIT_POLICY_MAX_CHARS + 1);
  assert.equal(validateShopDepositPolicy({ th: atLimit, en: '' }), null);
  assert.equal(validateShopDepositPolicy({ th: '', en: atLimit }), null);
  assert.deepEqual(
    validateShopDepositPolicy({ th: overLimit, en: '' }),
    { kind: 'too_long', locale: 'th', length: SHOP_DEPOSIT_POLICY_MAX_CHARS + 1 },
  );
  assert.deepEqual(
    validateShopDepositPolicy({ th: '', en: overLimit }),
    { kind: 'too_long', locale: 'en', length: SHOP_DEPOSIT_POLICY_MAX_CHARS + 1 },
  );
});

test('blank is allowed (a shop may publish in one language only) but never counted as content', () => {
  assert.equal(validateShopDepositPolicy({ th: '', en: '' }), null);
  assert.equal(validateShopDepositPolicy({ th: '   ', en: '\n\t ' }), null);
  assert.equal(normalizePolicyText('  ก  '), 'ก');
  assert.equal(normalizePolicyText(null), '');
  assert.equal(normalizePolicyText(undefined), '');
  assert.equal(isShopDepositPolicyEmpty({ th: '  ', en: '' }), true);
  assert.equal(isShopDepositPolicyEmpty({ th: ' ', en: 'x' }), false);
  // Whitespace-only must not become a published policy.
  assert.equal(resolveShopDepositPolicyPreview({ th: '   ', en: '' }, 'th').kind, 'empty');
});

test('the preview rule is exactly the rule the customer page applies', () => {
  const cases: Array<[{ th: string; en: string }, 'th' | 'en']> = [
    [{ th: 'ไทย', en: 'English' }, 'th'],
    [{ th: 'ไทย', en: 'English' }, 'en'],
    [{ th: 'ไทย', en: '' }, 'en'],
    [{ th: '', en: 'English' }, 'th'],
    [{ th: '', en: '' }, 'th'],
    [{ th: '  ', en: '  ' }, 'en'],
  ];

  for (const [draft, locale] of cases) {
    const preview = resolveShopDepositPolicyPreview(draft, locale);
    // The admin preview must be the customer's own resolver, state for state.
    const expected = resolveShopDepositPolicy({ th: draft.th || null, en: draft.en || null }, locale);
    if (preview.kind === 'empty') {
      assert.equal(expected.kind, 'missing', `${JSON.stringify(draft)}/${locale}`);
    } else {
      assert.equal(preview.kind, expected.kind);
      assert.equal(preview.locale, expected.locale);
      assert.equal(preview.text, expected.text);
    }
  }
});

test('the merchant editor exposes both languages, a preview and the shop-owns-it notice', () => {
  const page = read(ADMIN_PAGE);

  // Two inputs, keyed by language.
  assert.match(page, /data-testid={`shop-deposit-policy-input-\$\{policyLocale\}`}/);
  assert.match(page, /\{\(\['th', 'en'\] as const\)\.map\(\(policyLocale\)/);

  // A preview that renders the merchant's own text as a React child.
  assert.match(page, /data-testid="shop-deposit-policy-preview"/);
  assert.match(page, /\{depositPolicyPreview\.text\}/);
  assert.match(page, /resolveShopDepositPolicyPreview\(depositPolicyDraft, policyPreviewLocale\)/);

  // The two required disclaimers.
  assert.match(page, /\{t\('policyDisclaimer'\)\}/);
  assert.match(page, /\{t\('policyPublicNote'\)\}/);

  // No raw HTML anywhere on this path.
  assert.equal(/dangerouslySetInnerHTML/.test(page), false);
});

test('the editor is owner/admin only, and staff can neither type nor save', () => {
  const page = read(ADMIN_PAGE);
  const service = read(ADMIN_SERVICE);

  assert.match(page, /const depositPolicyCanEdit = shopRole === 'owner' \|\| shopRole === 'admin';/);
  assert.match(page, /disabled=\{!depositPolicyCanEdit\}/);
  assert.match(page, /if \(shopRole !== 'owner' && shopRole !== 'admin'\) return;/);
  assert.match(page, /depositPolicySaveLabel = !depositPolicyCanEdit[\s\S]{0,120}t\('policyEditorOnly'\)/);

  // Saving goes to the NEW RPC with the three policy parameters only.
  assert.match(service, new RegExp(`await supabase\\.rpc\\('${RPC}', \\{`));
  assert.match(service, /p_shop_id: shopId,\s*p_deposit_policy_th: input\.depositPolicyTh,\s*p_deposit_policy_en: input\.depositPolicyEn,/);
});

test('update_shop_settings keeps its frozen 9-argument call; the policy never rides on it', () => {
  const service = read(ADMIN_SERVICE);
  const call = service.slice(service.indexOf("rpc('update_shop_settings'"));
  const args = call.slice(call.indexOf('{'), call.indexOf('});'));

  for (const param of [
    'p_shop_id', 'p_name', 'p_phone', 'p_address',
    'p_promptpay_number', 'p_promptpay_name', 'p_line_oa_id',
  ]) assert.match(args, new RegExp(`${param}:`));
  assert.equal(/deposit_policy/.test(args), false, 'the policy must not be added to update_shop_settings');
  assert.equal(/p_customer_cancel_before_hours|p_customer_reschedule_before_hours/.test(args), false,
    'the app-side call shape is unchanged by this task');

  // And the policy RPC must be its own export, so a reviewer can see the split.
  assert.match(service, /export async function updateShopDepositPolicy\(/);
});

test('the policy columns are read back into the editor draft and never mixed with private data', () => {
  const service = read(ADMIN_SERVICE);
  assert.match(service, /depositPolicyTh: rawShop\.deposit_policy_th \?\? '',/);
  assert.match(service, /depositPolicyEn: rawShop\.deposit_policy_en \?\? '',/);
  assert.match(service, /deposit_policy_th: string \| null;/);
  assert.match(service, /deposit_policy_en: string \| null;/);
  assert.match(service, /\.select\('[^']*deposit_policy_th, deposit_policy_en'\)/);

  // Nothing personal may be selected alongside them on the public path.
  const consumer = read('apps/booking-consumer/src/lib/booking-service.ts');
  const publicSelect = /\.from\('shop_public_profile'\)\s*\.select\('([^']+)'\)/.exec(consumer);
  assert.ok(publicSelect, 'the public profile select must exist');
  assert.equal(/owner_name|subscription_status|trial_ends_at|email|phone_of/.test(publicSelect![1]), false);
});

test('both admin catalogues carry the policy copy, including the limit and the disclaimer', () => {
  for (const path of ADMIN_MESSAGES) {
    const messages = JSON.parse(read(path)) as { dashboard: Record<string, string> };
    const dashboard = messages.dashboard;
    for (const key of [
      'policyTitle', 'policySubtitle', 'policyThLabel', 'policyEnLabel', 'policyLimitNote',
      'policyTooLong', 'policyPreviewTitle', 'policyPreviewEmpty', 'policyPreviewFallback',
      'policyDisclaimer', 'policyPublicNote', 'policyEditorOnly', 'policySave',
      'policyLanguageTh', 'policyLanguageEn',
    ]) {
      assert.equal(typeof dashboard[key], 'string', `${path} dashboard.${key}`);
      assert.ok(dashboard[key].trim().length > 0, `${path} dashboard.${key} must not be empty`);
    }
    // The disclaimer must name WSTERA as the non-reviewer, in both languages.
    assert.match(dashboard.policyDisclaimer, /WSTERA/);
  }
});

test('the SQL spec hands Codex the same contract, with no allowlist growth', () => {
  const spec = read(SQL_SPEC);

  assert.match(spec, new RegExp(`CREATE FUNCTION local_service\\.${RPC}\\(`));
  assert.match(spec, /p_shop_id uuid,\s*p_deposit_policy_th text,\s*p_deposit_policy_en text/);
  // owner/admin only, and a cross-shop call must be refused.
  assert.match(spec, /has_shop_role\(p_shop_id,\s*ARRAY\['owner','admin'\]::text\[\]\)/);
  // Not-null validation with no NULL bypass (an explicit NULL must raise, not skip).
  assert.match(spec, /p_deposit_policy_th IS NULL OR p_deposit_policy_en IS NULL/);
  assert.match(spec, /char_length\(/);
  assert.match(spec, /1500/);
  // Audit event on edit.
  assert.match(spec, /audit_events/);
  // Two new public-by-design columns on `shops`, surfaced by the public view.
  assert.match(spec, /ADD COLUMN IF NOT EXISTS deposit_policy_th text/);
  assert.match(spec, /ADD COLUMN IF NOT EXISTS deposit_policy_en text/);
  assert.match(spec, /shop_public_profile/);
  // The frozen RPC is explicitly NOT touched — stated once, unambiguously, and
  // no sentence anywhere may grant permission to change it.
  assert.match(spec, /- \*\*ห้ามแก้ `local_service\.update_shop_settings`\*\* \(ลายเซ็น 9 พารามิเตอร์ถูกล็อกแล้ว\) — เพิ่มฟังก์ชันใหม่เท่านั้น/);
  assert.equal(/update_shop_settings.{0,60}(ต่อได้|may be modified|can be changed|amend)/is.test(spec), false);

  // No new bk01_runtime function: the grant is to `authenticated` only, and the
  // runtime role appears solely on the REVOKE side (so the allowlist stays 19/20).
  assert.match(spec, /REVOKE ALL ON FUNCTION local_service\.update_shop_deposit_policy\(uuid,text,text\) FROM PUBLIC, anon, service_role, bk01_runtime;/);
  assert.match(spec, /GRANT EXECUTE ON FUNCTION local_service\.update_shop_deposit_policy\(uuid,text,text\) TO authenticated;/);
  assert.equal(/GRANT EXECUTE ON FUNCTION local_service\.update_shop_deposit_policy\(uuid,text,text\) TO[^;]*bk01_runtime/.test(spec), false);
  assert.match(spec, /BK01_RUNTIME_FUNCTIONS` \(11\)/);
  assert.match(spec, /BK01_RUNTIME_EFFECTIVE_FUNCTIONS` \(19\)/);
});
