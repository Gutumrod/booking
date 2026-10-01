import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * HOUSE-BK01-ADMIN-TRUTH (brief 23 section 4, findings B5 + B6).
 *
 * B5: the slip-review modal in apps/booking-admin/src/app/dashboard/page.tsx
 * printed a green "the transfer amount in this slip matches the shop PromptPay"
 * badge for every booking. Nothing on that path reads the slip image: the
 * amount it printed was `selectedSlipBooking.depositPrice`, i.e. the deposit
 * configured for the booking when it was created (the only amount the database
 * holds -- see RawBooking.deposit_amount), and the only "verification" the
 * screen performs is createSignedDepositSlipUrl. A shop was therefore told the
 * money had been checked when it had not.
 *
 * B6: local_service.shops.customer_cancel_before_hours is NULL for every shop,
 * and customer_cancel_booking / customer_reschedule_booking raise
 * "Customer cancellation policy is not configured" while it is NULL, so a
 * customer can never cancel or move a booking. There is no place in the shop
 * dashboard to set it either. These tests pin the field rule (whole hours, 0 or
 * more) and the Owner-approved default (24h -- STATUS-HOUSE A-20, 2026-10-01)
 * that the screen must show while the column is unset.
 *
 * The module under test (lib/cancel-policy.ts) does not exist before this work
 * unit, so it is loaded dynamically inside its test: on the pre-fix tree that
 * test fails with an explicit "module missing" reason instead of crashing the
 * whole file before the other checks run.
 *
 * Round 2 (brief 23 update, same work unit) adds B6b and B10 on top:
 *   B6b — the reschedule window (customer_reschedule_before_hours) is NULL for
 *         every shop too, so reschedule fails for the same reason cancel does.
 *         Default 12 hours (Owner, 2026-10-01); the customer-facing error for a
 *         taken slot is PostgREST's raw 23P01 exclusion violation today.
 *   B10 — the "no-show" button was enabled for any confirmed booking, and
 *         local_service.set_booking_outcome has no appointment-time condition at
 *         all (proven by running the real function: it accepted no_show on a
 *         booking two days in the future).
 */

const read = (path: string) => readFileSync(path, 'utf8');

const readRequired = (path: string) => {
  assert.ok(existsSync(path), `${path} does not exist`);
  return read(path);
};

const DASHBOARD = 'apps/booking-admin/src/app/dashboard/page.tsx';
const ADMIN_SERVICE = 'apps/booking-admin/src/lib/admin-service.ts';
const CANCEL_POLICY = 'apps/booking-admin/src/lib/cancel-policy.ts';
const CATALOGUES = [
  'apps/booking-admin/messages/th.json',
  'apps/booking-admin/messages/en.json',
];

async function loadCancelPolicy() {
  try {
    return await import('../apps/booking-admin/src/lib/cancel-policy.ts');
  } catch (error) {
    assert.fail(
      `lib/cancel-policy.ts could not be loaded (${(error as Error).message}) -- `
      + 'the cancel-ahead window has no rule module, so the B6 defect is unfixed',
    );
  }
}

async function loadOutcomeGate() {
  try {
    return await import('../apps/booking-admin/src/lib/booking-outcome-gate.ts');
  } catch (error) {
    assert.fail(
      `lib/booking-outcome-gate.ts could not be loaded (${(error as Error).message}) -- `
      + 'the no-show action has no appointment-time gate, so the B10 defect is unfixed',
    );
  }
}

async function loadManageBookingError() {
  try {
    return await import('../apps/booking-consumer/src/lib/manage-booking-error.ts');
  } catch (error) {
    assert.fail(
      `lib/manage-booking-error.ts could not be loaded (${(error as Error).message}) -- `
      + 'raw server errors would reach the customer, so the B6b requirement is unfixed',
    );
  }
}

// ---------------------------------------------------------------------------
// B5 — the slip modal may not claim the amount was checked
// ---------------------------------------------------------------------------

test('the slip modal shows no verified/matched badge and no green "matches PromptPay" claim', () => {
  const source = read(DASHBOARD);

  // The badge itself: a green emerald container wrapping the amount claim.
  assert.doesNotMatch(
    source,
    /bg-emerald-500\/10 border border-emerald-500\/30 p-2 rounded text-\[10px\] text-emerald-400 font-medium/,
    'the emerald "amount matches" badge is back in the slip modal',
  );

  // The claim wording, in either locale's catalogue.
  for (const path of CATALOGUES) {
    const raw = read(path);
    assert.doesNotMatch(raw, /ตรงกับ PromptPay ร้าน/, `${path} still tells the shop the amount was matched`);
    assert.doesNotMatch(raw, /matches the shop PromptPay/i, `${path} still tells the shop the amount was matched`);
    assert.doesNotMatch(raw, /🛡️/, `${path} still renders a shield icon next to the slip amount`);
  }

  // And the modal must carry the neutral review instruction instead.
  assert.match(source, /t\('slipVerifyReminder'\)/);
  assert.match(source, /t\('slipAmountMatchesNote'\)/);
});

test('the slip modal never renders the slip amount as a verified figure', () => {
  const source = read(DASHBOARD);
  const modal = source.slice(source.indexOf('SLIP VERIFICATION MODAL'));
  assert.ok(modal.length > 0, 'the slip modal is not in the dashboard source');

  // The amount shown is the booking's configured deposit, labelled as such --
  // never as a value read from the slip image or confirmed by the system.
  assert.match(modal, /t\('slipAmountMatches', \{ amount: selectedSlipBooking\.depositPrice \}\)/);
  assert.doesNotMatch(modal, /slipAmountInSlip/);

  for (const path of CATALOGUES) {
    const messages = JSON.parse(read(path));
    const isThai = path.endsWith('/th.json');
    const configured = messages.dashboard.slipAmountMatches;
    assert.match(configured, isThai ? /ยอดมัดจำที่ระบบตั้งไว้/ : /configured for this booking/i);
    assert.doesNotMatch(configured, isThai ? /โอน|ตรงกับ/ : /transfer|match/i);

    const note = messages.dashboard.slipAmountMatchesNote;
    assert.match(note, isThai ? /ไม่ใช่ยอดที่อ่านได้จากสลิป/ : /not a value read from the slip/i);
    assert.match(note, isThai ? /ตรวจยอดจริงในแอปธนาคาร/ : /verify the real amount/i);

    const reminder = messages.dashboard.slipVerifyReminder;
    assert.match(reminder, isThai ? /ตรวจยอดและชื่อบัญชี/ : /check the amount and the account name/i);
    assert.match(reminder, isThai ? /แอปธนาคารของร้าน/ : /banking app/i);
    assert.match(reminder, isThai ? /ยังไม่ตรวจยอด/ : /does not verify/i);
  }
});

test('no admin catalogue or dashboard source asserts an amount was matched/verified', () => {
  // Repo-wide: the B5 claim is "the amount in this slip matches the shop
  // PromptPay". Wording that says a capability is NOT available (e.g. the Pro
  // auto-verification notes) is honest and deliberately not matched here.
  const CLAIM = /ตรงกับ\s*PromptPay|matches the (?:shop )?PromptPay|ยอดโอน[^\n]{0,40}ตรงกัน|transfer amount[^\n]{0,40}match/i;
  const files = [
    ...CATALOGUES,
    'apps/booking-consumer/messages/th.json',
    'apps/booking-consumer/messages/en.json',
    DASHBOARD,
  ];
  for (const path of files) {
    assert.doesNotMatch(read(path), CLAIM, `${path} still asserts the slip amount was matched`);
  }

  // The money stat may not say the money arrived: the dashboard knows the
  // booking is confirmed, never that the transfer landed.
  for (const path of CATALOGUES) {
    const messages = JSON.parse(read(path));
    const isThai = path.endsWith('/th.json');
    const stat = messages.dashboard.statDepositCollected;
    assert.doesNotMatch(stat, isThai ? /โอนแล้ว/ : /collected|received/i, `${path} claims the deposit arrived`);
    assert.match(stat, isThai ? /ยืนยันแล้ว/ : /confirmed/i, `${path} must name what is actually known`);
  }
});

// ---------------------------------------------------------------------------
// B6 — the cancel-ahead window: default 24h, whole hours >= 0
// ---------------------------------------------------------------------------

test('the default cancel-ahead window is the Owner-approved 24 hours', async () => {
  const policy = await loadCancelPolicy();
  assert.equal(
    policy.DEFAULT_CUSTOMER_CANCEL_BEFORE_HOURS,
    24,
    'the Owner approved 24 hours (STATUS-HOUSE A-20); the screen default must match',
  );
  assert.equal(typeof policy.DEFAULT_CUSTOMER_CANCEL_BEFORE_HOURS, 'number');
});

test('the cancel window field accepts whole hours from 0 upward and rejects everything else', async () => {
  const policy = await loadCancelPolicy();
  const { commitNumericField } = await import('../apps/booking-admin/src/lib/numeric-field.ts');
  const rules = policy.CANCEL_POLICY_HOURS_RULES;

  assert.equal(rules.min, 0);
  assert.equal(rules.integer, true);
  assert.equal(policy.CANCEL_POLICY_HOURS_INPUT_PROPS.min, 0);
  assert.equal(policy.CANCEL_POLICY_HOURS_INPUT_PROPS.step, 1);

  // Accepted.
  for (const raw of ['0', '1', '24', '168', ' 12 ']) {
    assert.deepEqual(
      commitNumericField(raw, rules),
      { value: Number(raw.trim()), error: null },
      `${raw} must be accepted`,
    );
  }

  // Rejected: empty (the field is required), negative, fractional, junk.
  assert.equal(commitNumericField('', rules).error, 'required');
  assert.equal(commitNumericField('   ', rules).error, 'required');
  assert.equal(commitNumericField('-1', rules).error, 'below-min');
  assert.equal(commitNumericField('2.5', rules).error, 'not-integer');
  assert.equal(commitNumericField('24h', rules).error, 'not-a-number');
  assert.equal(commitNumericField('', rules).value, null);
});

test('the dashboard writes the window through the existing owner-only settings RPC', () => {
  const service = read(ADMIN_SERVICE);

  // No shortcut around RLS: the only writer is update_shop_settings, which
  // raises unless local_service.is_shop_owner(p_shop_id) holds.
  assert.match(service, /rpc\('update_shop_settings'/);
  assert.match(service, /p_customer_cancel_before_hours: input\.customerCancelBeforeHours/);
  assert.match(service, /customerCancelBeforeHours: number;/);
  assert.doesNotMatch(service, /\.from\('shops'\)[\s\S]{0,200}\.update\(/);

  // The dashboard reads the column (via the typed shop field), validates the
  // field, and sends it.
  const page = readRequired(DASHBOARD);
  assert.match(page, /customerCancelBeforeHours/);
  assert.match(page, /commitNumericField\(cancelPolicyHours, CANCEL_POLICY_HOURS_RULES\)/);
  assert.match(page, /t\('cancelPolicyLeadTimeLabel'\)/);

  // The column itself is only ever touched in the service layer: selected on
  // the shop read and mapped to the typed DashboardShop field.
  assert.match(service, /customer_cancel_before_hours/);
  assert.match(service, /customer_reschedule_before_hours/);
  assert.match(service, /customerCancelBeforeHours: rawShop\.customer_cancel_before_hours == null/);
  assert.match(service, /customerRescheduleBeforeHours: rawShop\.customer_reschedule_before_hours == null/);
});

test('the window shown while the shop row is unset comes from the code default, not the database', () => {
  const page = readRequired(DASHBOARD);
  assert.match(
    page,
    /data\.shop\.customerCancelBeforeHours \?\? DEFAULT_CUSTOMER_CANCEL_BEFORE_HOURS/,
  );

  for (const path of CATALOGUES) {
    const messages = JSON.parse(read(path));
    const isThai = path.endsWith('/th.json');
    assert.match(messages.dashboard.cancelPolicyDefaultNote, /24/);
    assert.match(
      messages.dashboard.cancelPolicyDefaultNote,
      isThai ? /เริ่มมีผลจริงหลัง migration/ : /only takes effect after the migration/i,
    );
  }
});

test('this work unit ships the window change as a spec only -- no migration is written here', () => {
  const dirs = ['supabase/migrations', 'supabase/bk01-migrations', 'supabase/rollback'];
  const offenders: string[] = [];
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.sql')) continue;
      const sql = readFileSync(join(dir, name), 'utf8');
      if (/customer_cancel_before_hours[\s\S]{0,200}DEFAULT\s+24/i.test(sql)) {
        offenders.push(join(dir, name));
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'the default change belongs to the controller-owned migration, not to this branch',
  );
});

// ---------------------------------------------------------------------------
// B6b — the reschedule window: default 12h, same field rule, plain-language errors
// ---------------------------------------------------------------------------

test('the default reschedule-ahead window is the Owner-approved 12 hours', async () => {
  const policy = await loadCancelPolicy();
  assert.equal(
    policy.DEFAULT_CUSTOMER_RESCHEDULE_BEFORE_HOURS,
    12,
    'the Owner approved 12 hours (2026-10-01); the screen default must match',
  );
  assert.equal(typeof policy.DEFAULT_CUSTOMER_RESCHEDULE_BEFORE_HOURS, 'number');
});

test('the reschedule window is a real field beside the cancel window, on the same rule', () => {
  const page = readRequired(DASHBOARD);
  assert.match(page, /t\('reschedulePolicyLeadTimeLabel'\)/);
  assert.match(page, /setReschedulePolicyHours/);
  assert.match(page, /DEFAULT_CUSTOMER_RESCHEDULE_BEFORE_HOURS/);
  assert.match(page, /customerRescheduleBeforeHours/);
  assert.match(page, /commitNumericField\(reschedulePolicyHours, CANCEL_POLICY_HOURS_RULES\)/);

  // Written through the same owner-only RPC as the cancel window.
  const service = read(ADMIN_SERVICE);
  assert.match(service, /customer_reschedule_before_hours'/);
  assert.match(service, /p_customer_reschedule_before_hours: input\.customerRescheduleBeforeHours/);
  assert.match(service, /customerRescheduleBeforeHours: number;/);

  for (const path of CATALOGUES) {
    const messages = JSON.parse(read(path));
    const isThai = path.endsWith('/th.json');
    assert.match(messages.dashboard.reschedulePolicyDefaultNote, /12/);
    assert.match(messages.dashboard.reschedulePolicyRequired, isThai ? /จำนวนเต็ม/ : /whole hours/i);
  }
});

test('the customer sees a plain-language message instead of a raw exclusion violation', async () => {
  const mod = await loadManageBookingError();
  const { classifyManageBookingError, manageBookingErrorMessage, OVERLAP_CONSTRAINT } = mod;
  // The message PostgREST returns for the overlapping-booking constraint
  // (reproduced on a throwaway PostgreSQL cluster: SQLSTATE 23P01).
  const raw = {
    code: '23P01',
    message: `conflicting key value violates exclusion constraint "${OVERLAP_CONSTRAINT}"`,
  };
  assert.equal(classifyManageBookingError(raw), 'slot_taken');

  // Bare constraint name without a code is still recognised.
  assert.equal(
    classifyManageBookingError({ message: `conflicting key value violates exclusion constraint "${OVERLAP_CONSTRAINT}"` }),
    'slot_taken',
  );

  // The other messages the real functions raise (verbatim from the migration).
  assert.equal(classifyManageBookingError({ message: 'Requested time is outside staff availability' }), 'outside_availability');
  assert.equal(classifyManageBookingError({ message: 'Requested date is closed' }), 'date_closed');
  assert.equal(classifyManageBookingError({ message: 'Assigned staff is no longer active' }), 'staff_inactive');
  assert.equal(classifyManageBookingError({ message: 'Reschedule policy window has closed' }), 'policy_closed');
  assert.equal(classifyManageBookingError({ message: 'Cancellation policy window has closed' }), 'policy_closed');
  assert.equal(classifyManageBookingError({ message: 'Customer reschedule policy is not configured' }), 'policy_closed');
  assert.equal(classifyManageBookingError({ message: 'Invalid or expired booking recovery token' }), 'invalid_link');

  const messages = {
    slotTaken: 'SLOT', outsideAvailability: 'OUTSIDE', dateClosed: 'CLOSED', staffInactive: 'STAFF',
    policyClosed: 'POLICY', invalidLink: 'LINK', outcomeFailed: 'GENERIC',
  };
  assert.equal(manageBookingErrorMessage(raw, messages), 'SLOT');
  // Anything unrecognised returns the caller's generic message, never the raw text.
  assert.equal(manageBookingErrorMessage({ code: 'XX000', message: 'some internal detail' }, messages), 'GENERIC');
});

test('the manage-booking page maps errors and never prints the raw server message', () => {
  const page = read('apps/booking-consumer/src/app/manage-booking/page.tsx');
  assert.match(page, /manageBookingErrorMessage/);
  assert.match(page, /from '@\/lib\/manage-booking-error'/);
  assert.doesNotMatch(page, /setMessage\(error\?\.message/);
  assert.doesNotMatch(page, /setMessage\(error\.message/);

  for (const path of ['apps/booking-consumer/messages/th.json', 'apps/booking-consumer/messages/en.json']) {
    const messages = JSON.parse(read(path));
    const isThai = path.endsWith('/th.json');
    assert.match(messages.manageBooking.slotTaken, isThai ? /ถูกจองไปแล้ว/ : /taken/i);
    assert.match(messages.manageBooking.slotTaken, isThai ? /เลือกเวลาอื่น/ : /another time/i);
    assert.match(messages.manageBooking.policyClosed, isThai ? /เลยเวลา/ : /window/i);
    assert.match(messages.manageBooking.outcomeFailed, isThai ? /ลองใหม่/ : /try again/i);
  }
});

// ---------------------------------------------------------------------------
// B10 — "no-show" only after the appointment time
// ---------------------------------------------------------------------------

test('the no-show gate opens only once the appointment start has passed', async () => {
  const { appointmentStartMs, hasAppointmentStarted } = await loadOutcomeGate();
  // 2026-10-03 10:00 Asia/Bangkok (+07:00) = 03:00Z
  const moment = { date: '2026-10-03', time: '10:00' };
  const startMs = appointmentStartMs(moment);
  assert.equal(startMs, Date.parse('2026-10-03T10:00:00+07:00'));

  assert.equal(hasAppointmentStarted(moment, startMs - 60_000), false, 'a minute before: closed');
  assert.equal(hasAppointmentStarted(moment, startMs), true, 'exactly at the appointment: open');
  assert.equal(hasAppointmentStarted(moment, startMs + 60_000), true, 'after the appointment: open');

  // Unusable input keeps the gate closed (fail-closed), never open.
  for (const bad of [{ date: '', time: '10:00' }, { date: '2026-10-03', time: '' }, { date: 'nope', time: '10:00' }, { date: '2026-10-03', time: '99:99' }]) {
    assert.equal(appointmentStartMs(bad), null, `${JSON.stringify(bad)} must not parse`);
    assert.equal(hasAppointmentStarted(bad, Number.MAX_SAFE_INTEGER), false, `${JSON.stringify(bad)} must stay closed`);
  }
});

test('the dashboard gates the no-show button and the handler on the appointment time', () => {
  const page = readRequired(DASHBOARD);
  assert.match(page, /hasAppointmentStarted/);
  assert.match(page, /from '@\/lib\/booking-outcome-gate'/);

  // The button branch: the no-show action sits inside the "started" arm, with a
  // disabled span otherwise. Exactly one no-show call site may exist, and it must
  // be downstream of the gate.
  assert.match(page, /<\/button>\s*\{\/\* B10[\s\S]{0,160}hasAppointmentStarted\(\{ date: b\.date, time: b\.time \}, nowMs\) \? \(/);
  assert.equal(
    (page.match(/handleBookingOutcome\(b\.id, 'no_show'\)/g) ?? []).length,
    1,
    'exactly one no-show call site, inside the gate',
  );
  const gateIndex = page.indexOf("hasAppointmentStarted({ date: b.date, time: b.time }, nowMs)");
  const noShowIndex = page.indexOf("handleBookingOutcome(b.id, 'no_show')");
  assert.ok(gateIndex > -1 && noShowIndex > gateIndex, 'the no-show button must be gated by the appointment time');

  // The handler refuses early, before the mutation flag is set.
  assert.match(page, /outcome === 'no_show'[\s\S]{0,400}hasAppointmentStarted\([\s\S]{0,200}setBookingError\(t\('noShowNotYetAllowed'\)\)/);

  for (const path of CATALOGUES) {
    const messages = JSON.parse(read(path));
    const isThai = path.endsWith('/th.json');
    assert.match(messages.dashboard.noShowNotYetAllowed, isThai ? /ยังไม่ถึงเวลานัด/ : /has not arrived yet/i);
    assert.match(messages.dashboard.noShowAfterAppointment, isThai ? /หลังเวลานัด/ : /after the appointment/i);
  }
});

test('nothing in this work unit changes a booking automatically', () => {
  const page = readRequired(DASHBOARD);
  // The outcome still travels only through the merchant's own click handler.
  assert.doesNotMatch(page, /set_booking_outcome/);
  assert.doesNotMatch(page, /\.rpc\('set_booking_outcome'/);
  assert.match(page, /await setBookingOutcome\(bookingId, outcome\)/);
});
