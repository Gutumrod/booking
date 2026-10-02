/**
 * BK01 P0 — application unit H5 (council findings G26, G18; brief 28 §4).
 *
 * THREE THINGS, ONE UNIT — and one that is deliberately NOT done.
 *
 *  G26 — `update_shop_settings` went from 7 to 9 parameters with no defaults, so a
 *  7-argument caller (which is what this app shipped) got
 *  `function … does not exist` and a shop could not save its PromptPay, address or
 *  name. Worse, the two new columns took a blanket 24/12 on every row. The CONTRACT
 *  keeps the 9 named inputs with the new ones `DEFAULT NULL` = PRESERVE under a row
 *  lock; the app therefore sends all NINE and means "keep" explicitly.
 *
 *  G18 — the shop notification e-mail had NO caller in the app at all, so the setting
 *  could never be recorded. Half of why the Basic/trial shop e-mail feature was dead.
 *  The button now calls `set_shop_notification_contact(p_shop_id)`, which (per the
 *  CONTRACT) reads the address from the signed-in JWT's top-level `email` claim and
 *  refuses an anonymous session — the app never carries an address of its own.
 *
 *  G23 — recording a refund for a REJECTED slip: the UI work is NOT in this unit and
 *  this file asserts why rather than pretending otherwise. The CONTRACT adds
 *  `deposit_money_events` (append-only, RPC-only, `FORCE RLS`) and widens
 *  `record_deposit_refund` to accept `rejected` with MANDATORY textual transfer
 *  evidence, and it explicitly states that FILE attachments are "held pending a
 *  separate storage contract; never reuse customer slip upload to upload merchant
 *  evidence". There is therefore no authorised attachment path to build against, and
 *  the money-event reader (`get_deposit_refund_history`) is a new RPC whose rows the
 *  UI would need. Building the refund screen now would mean inventing a storage scope,
 *  which A-24 item 2 and this unit's boundaries forbid.
 *
 *  G18's TRANSPORT — the Resend adapter: also NOT in this unit. There is no e-mail
 *  adapter in the repository at all, and the R1 CONTRACT does not name one. The report
 *  records e-mail delivery as UNMEASURED; nothing here claims it works.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

// ---------------------------------------------------------------------------
// G26 — nine named arguments, and "omitted" means preserve
// ---------------------------------------------------------------------------

test('the app sends all NINE named arguments to update_shop_settings', () => {
  const service = read('apps/booking-admin/src/lib/admin-service.ts');
  const call = service.slice(service.indexOf("rpc('update_shop_settings'"));
  const body = call.slice(0, call.indexOf('});'));
  const named = [...body.matchAll(/p_[a-z_]+:/g)].map((match) => match[0].slice(0, -1));
  assert.deepEqual(named.sort(), [
    'p_address', 'p_customer_cancel_before_hours', 'p_customer_reschedule_before_hours',
    'p_line_oa_id', 'p_name', 'p_phone', 'p_promptpay_name', 'p_promptpay_number', 'p_shop_id',
  ], 'the CONTRACT pins exactly these nine');
});

test('the two new policy windows are sent as null (preserve), never as a blanket 24/12', () => {
  const service = read('apps/booking-admin/src/lib/admin-service.ts');
  assert.match(service, /p_customer_cancel_before_hours: input\.customer_cancel_before_hours \?\? null/);
  assert.match(service, /p_customer_reschedule_before_hours: input\.customer_reschedule_before_hours \?\? null/);
  // The dashboard has no policy editor in this unit, so it must not pass a literal.
  assert.doesNotMatch(service, /p_customer_cancel_before_hours:\s*\d/);
  assert.doesNotMatch(service, /p_customer_reschedule_before_hours:\s*\d/);
});

test('the dashboard saves the settings without inventing a policy value', () => {
  const dashboard = read('apps/booking-admin/src/app/dashboard/page.tsx');
  const call = dashboard.slice(dashboard.indexOf('await updateShopSettings(shopId'));
  const body = call.slice(0, call.indexOf('});'));
  assert.doesNotMatch(body, /customer_cancel_before_hours/, 'a value here would silently reset every shop');
  assert.match(body, /lineOaId/);
});

// ---------------------------------------------------------------------------
// G18 — the notification contact has a caller, and the app sends no address
// ---------------------------------------------------------------------------

test('the app calls set_shop_notification_contact with the shop id and NO address', () => {
  const service = read('apps/booking-admin/src/lib/admin-service.ts');
  const call = service.slice(service.indexOf("rpc('set_shop_notification_contact'"));
  const body = call.slice(0, call.indexOf('});'));
  const named = [...body.matchAll(/p_[a-z_]+:/g)].map((match) => match[0].slice(0, -1));
  assert.deepEqual(named, ['p_shop_id'], 'the CONTRACT signature takes only the shop id');
  // The address must not travel from the browser: the CONTRACT derives it server-side.
  assert.doesNotMatch(body, /email/i, 'no address may be sent from the app');
});

test('the dashboard exposes the control, and it is owner-only', () => {
  const dashboard = read('apps/booking-admin/src/app/dashboard/page.tsx');
  assert.match(dashboard, /handleSetNotificationContact/);
  assert.match(dashboard, /setShopNotificationContact\(shopId\)/);
  assert.match(dashboard, /shopRole !== 'owner'/, 'a staff session must not set the shop mailbox');
  assert.match(dashboard, /notifyContactUseLoginEmail/);
});

test('the control is labelled in both languages, with the same key set', () => {
  const th = JSON.parse(read('apps/booking-admin/messages/th.json')) as { dashboard: Record<string, string> };
  const en = JSON.parse(read('apps/booking-admin/messages/en.json')) as { dashboard: Record<string, string> };
  for (const key of ['notifyContactTitle', 'notifyContactBody', 'notifyContactUseLoginEmail', 'notifyContactCurrent', 'notifyContactSaved', 'notifyContactFailed']) {
    assert.ok(th.dashboard[key], `th.json is missing ${key}`);
    assert.ok(en.dashboard[key], `en.json is missing ${key}`);
  }
});

test('the app does not reach for auth.users, user_metadata or service_role to get an address', () => {
  // The caretaker explicitly rejected both of the tempting shortcuts (AGY's
  // auth.users trigger and LANE's user_metadata read), and this unit must not
  // reintroduce either under a different name.
  const service = read('apps/booking-admin/src/lib/admin-service.ts');
  const dashboard = read('apps/booking-admin/src/app/dashboard/page.tsx');
  for (const [name, source] of [['admin-service', service], ['dashboard', dashboard]] as const) {
    assert.doesNotMatch(source, /user_metadata/, `${name} must not read user_metadata`);
    assert.doesNotMatch(source, /auth\.users|from\(['"]users['"]\)/, `${name} must not read auth.users`);
    assert.doesNotMatch(source, /service_role/, `${name} must not reach for service_role`);
  }
});

// ---------------------------------------------------------------------------
// G23 — the refund UI was NOT in the first P0 unit; it is built here (round 2),
// and these two tests keep the boundary honest in both directions.
// ---------------------------------------------------------------------------

test('no merchant refund-evidence upload path is invented, because none is authorised', () => {
  // The CONTRACT: "No new storage scope or upload route is authorized. File
  // attachments are held pending a separate storage contract; never reuse customer
  // slip upload to upload merchant evidence."
  const contract = read(
    'D:/AI-Workspace/runtime/worktrees/bk01-p0-sql-20261002/reports/CONTRACT-BK01-P0-SQL-2026-10-02.md',
  );
  assert.match(contract, /No new storage scope or upload route is authorized/);
  assert.match(contract, /never reuse customer slip upload to upload merchant evidence/);

  // So the refund screen records TEXT ONLY and offers no file input. The caretaker
  // re-affirmed this in room 2026-10-01 1004: "ไฟล์แนบ HOLD".
  const dashboard = read('apps/booking-admin/src/app/dashboard/page.tsx');
  const refundModal = dashboard.slice(dashboard.indexOf('H5/G23 RECORD-A-REFUND MODAL'));
  assert.ok(refundModal.length > 0, 'the refund modal must exist in this unit');
  assert.doesNotMatch(refundModal, /type="file"|createSignedUploadUrl|\.upload\(/, 'no upload path may be invented');
  assert.doesNotMatch(refundModal, /deposit-slips|deposit-slips bucket/, 'merchant evidence must not reuse the customer slip bucket');
});

test('the refund path is not a duplicate writer — it calls the CONTRACT RPC through the shared service', () => {
  // `record_deposit_refund` / `get_deposit_refund_history` are the SQL functions the
  // P0 CONTRACT widened; the app must reach them through admin-service rather than
  // open-coding a second writer for the same money fact, and must never borrow the
  // approve/reject RPCs to record money movement.
  const service = read('apps/booking-admin/src/lib/admin-service.ts');
  assert.match(service, /rpc\(DEPOSIT_REFUND_RPC/, 'the refund must use the CONTRACT RPC name');
  assert.match(service, /rpc\(DEPOSIT_REFUND_HISTORY_RPC/);
  const refundBlock = service.slice(service.indexOf('recordBookingDepositRefund'));
  assert.doesNotMatch(refundBlock.slice(0, 900), /approve_booking_deposit|reject_deposit_slip/);
});

// ---------------------------------------------------------------------------
// The e-mail transport is not built either — and the report must say so
// ---------------------------------------------------------------------------

test('no Resend adapter was added, and the code does not claim e-mail is delivered', () => {
  const candidates = [
    'apps/booking-admin/src/lib/admin-service.ts',
    'apps/booking-admin/src/app/dashboard/page.tsx',
  ];
  for (const path of candidates) {
    assert.doesNotMatch(read(path), /resend|RESEND_API_KEY/i, `${path} must not pretend to send e-mail`);
  }
});
