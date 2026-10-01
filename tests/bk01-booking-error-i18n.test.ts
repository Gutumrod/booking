import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * S1 — HOUSE-BK01-BOOKING-ERROR-I18N.
 *
 * The customer booking page (`apps/booking-consumer/src/app/book/[slug]/page.tsx`)
 * called `createBookingHold`, and on failure printed `error.message` straight
 * from PostgREST, so the customer read the database's own English sentence.
 *
 * Two different paths produce that sentence, and only one of them was handled by
 * lib/manage-booking-error.ts (which recognised SQLSTATE 23P01 only):
 *
 *   1. the INSERT's EXCEPTION block catches the exclusion violation and re-raises
 *      it as the GENERIC code P0001 with the text below
 *      (supabase/migrations/20260807104205_phase_a_data_integrity_and_authorization.sql:265-273,
 *      active definition supabase/bk01-migrations/20260926120000_bk01_entitlement_packs.sql:1927);
 *   2. the pre-INSERT availability check raises the same sentence as a plain
 *      RAISE EXCEPTION (phase_a:231 / entitlement_packs:1877).
 *
 * P0001 cannot be the discriminator: it is what every bare `RAISE EXCEPTION`
 * uses, so the sentence is the only thing that separates "the slot was taken"
 * from any other refusal. These tests pin both halves plus the fallback rule
 * that no raw database text ever reaches the customer.
 */

const read = (path: string) => readFileSync(path, 'utf8');

const PAGE = 'apps/booking-consumer/src/app/book/[slug]/page.tsx';
const HELPER = 'apps/booking-consumer/src/lib/manage-booking-error.ts';
const PHASE_A = 'supabase/migrations/20260807104205_phase_a_data_integrity_and_authorization.sql';
const ACTIVE = 'supabase/bk01-migrations/20260926120000_bk01_entitlement_packs.sql';
const CATALOGUES = ['apps/booking-consumer/messages/th.json', 'apps/booking-consumer/messages/en.json'];

const SLOT_TAKEN_EN = 'Selected staff is unavailable during this time slot';
const SLOT_TAKEN_TH_HEAD = 'ช่วงเวลาที่เลือกถูกจองไปแล้ว';

async function loadManageBookingError() {
  try {
    return await import('../apps/booking-consumer/src/lib/manage-booking-error.ts');
  } catch (error) {
    assert.fail(
      `lib/manage-booking-error.ts could not be loaded (${(error as Error).message}) -- `
      + 'there is no error-mapping module for the customer pages',
    );
  }
}

const probe = {
  slotTaken: 'TAKEN',
  outsideAvailability: 'OUTSIDE',
  dateClosed: 'CLOSED',
  staffInactive: 'STAFF',
  policyClosed: 'POLICY',
  invalidLink: 'LINK',
  outcomeFailed: 'GENERIC',
};

test('S1 the P0001 taken-slot refusal maps to slot_taken, on the message not the code', async () => {
  const { classifyManageBookingError, manageBookingErrorMessage } = await loadManageBookingError();

  // What PostgREST returns when create_booking_hold catches the exclusion
  // violation: generic P0001 + the English sentence.
  assert.equal(classifyManageBookingError({ code: 'P0001', message: SLOT_TAKEN_EN }), 'slot_taken');
  assert.equal(manageBookingErrorMessage({ code: 'P0001', message: SLOT_TAKEN_EN }, probe), 'TAKEN');

  // The pre-INSERT path raises the same sentence with no explicit code at all.
  assert.equal(classifyManageBookingError({ message: SLOT_TAKEN_EN }), 'slot_taken');
  assert.equal(manageBookingErrorMessage({ message: SLOT_TAKEN_EN }, probe), 'TAKEN');

  // A blank/near-miss message must NOT be treated as taken: P0001 alone is not
  // evidence of anything (it is the generic raise code).
  assert.equal(classifyManageBookingError({ code: 'P0001', message: 'Booking date must be today or later' }), 'unknown');
});

test('S1 the 23P01 path still maps to slot_taken (regression guard)', async () => {
  const { classifyManageBookingError, manageBookingErrorMessage, OVERLAP_CONSTRAINT } = await loadManageBookingError();
  const raw = {
    code: '23P01',
    message: `conflicting key value violates exclusion constraint "${OVERLAP_CONSTRAINT}"`,
  };
  assert.equal(classifyManageBookingError(raw), 'slot_taken');
  assert.equal(manageBookingErrorMessage(raw, probe), 'TAKEN');

  // Bare constraint name without a code is still recognised.
  assert.equal(
    classifyManageBookingError({ message: `conflicting key value violates exclusion constraint "${OVERLAP_CONSTRAINT}"` }),
    'slot_taken',
  );
});

test('S1 an unrecognised database message falls back to translated copy, never the raw text', async () => {
  const { manageBookingErrorMessage } = await loadManageBookingError();
  const unknown = { code: 'XX000', message: 'some internal detail from the database' };
  const out = manageBookingErrorMessage(unknown, probe);
  assert.equal(out, 'GENERIC');
  assert.doesNotMatch(out, /internal detail/, 'the database text must never be echoed');
});

test('S1 the booking page maps hold failures instead of printing the server message', () => {
  const page = read(PAGE);

  // The helper is imported and used on the hold path...
  assert.match(page, /import \{ manageBookingErrorMessage \} from '\.\.\/\.\.\/\.\.\/lib\/manage-booking-error';/);
  assert.match(page, /manageBookingErrorMessage\(/);
  // ...and the raw-message fallback the customer used to read is gone.
  assert.doesNotMatch(
    page,
    /setErrorMessage\(getErrorMessage\(err, t\('errors\.createHoldFailed'\)\)\)/,
    'the hold fallback still prints error.message',
  );

  // The entitlement refusals keep their behaviour: each still has its own
  // translated message and still re-reads the choices.
  assert.match(page, /refusal\.includes\('SERVICE_OUTSIDE_PLAN'\)/);
  assert.match(page, /refusal\.includes\('STAFF_OUTSIDE_PLAN'\)/);
  assert.match(page, /t\('errors\.serviceOutsidePlan'\)/);
  assert.match(page, /t\('errors\.staffOutsidePlan'\)/);
  assert.equal((page.match(/await reloadChoices\(\);/g) ?? []).length, 2, 'both refusal branches refresh the choices');

  // The page's own translated thrown sentence is not a database message and must
  // survive the mapping unchanged.
  assert.match(page, /throw new Error\(t\('errors\.invalidBookingStatus'\)\)/);
  assert.match(page, /refusal === t\('errors\.invalidBookingStatus'\) \? refusal : mapped/);
});

test('S1 both catalogues carry the taken-slot copy and stay key-identical', () => {
  const catalogues = CATALOGUES.map((path) => ({ path, messages: JSON.parse(read(path)) }));
  for (const { path, messages } of catalogues) {
    const isThai = path.endsWith('/th.json');
    const value = messages.booking.errors.slotTaken;
    assert.equal(typeof value, 'string', `${path} booking.errors.slotTaken must exist`);
    assert.ok(value.trim().length > 0, `${path} booking.errors.slotTaken must not be empty`);
    if (isThai) {
      // The Thai catalogue is the one that used to leak the database's English
      // sentence, so it must contain Thai customer copy and no Latin words.
      assert.ok(value.startsWith(SLOT_TAKEN_TH_HEAD), `${path} must read "${SLOT_TAKEN_TH_HEAD}..."`);
      assert.doesNotMatch(value, /[A-Za-z]{3,}/, `${path} must not carry raw English`);
    } else {
      assert.match(value, /taken/i, `${path} must say the slot is taken`);
    }
    // The two facts stay distinct: "outside the schedule" is not "someone took it".
    assert.notEqual(value, messages.booking.errors.slotUnavailable, `${path}: taken and outside-schedule must differ`);
  }

  // Key parity between the locales is enforced by tests/bk01-i18n.test.ts, but this
  // assertion keeps the new key from being added to only one side.
  const [th, en] = catalogues.map(({ messages }) => Object.keys(messages.booking.errors).sort());
  assert.deepEqual(en, th, 'booking.errors keys differ between th.json and en.json');
});

test('S1 the mapped sentence is the one the SQL actually raises (constant cannot drift)', async () => {
  const { SLOT_TAKEN_MESSAGE } = await loadManageBookingError();
  // The app constant is only useful if it is the sentence the live functions
  // raise; pin it against both definitions rather than trusting the comment.
  const phaseA = read(PHASE_A);
  const active = read(ACTIVE);
  for (const [path, source] of [[PHASE_A, phaseA], [ACTIVE, active]] as const) {
    assert.ok(
      source.includes(`MESSAGE = '${SLOT_TAKEN_MESSAGE}'`),
      `${path} no longer raises "${SLOT_TAKEN_MESSAGE}" as a P0001 -- the app constant drifted`,
    );
  }
  // And that raise really is the generic code, which is why the message carries
  // the meaning (see the module comment).
  assert.match(phaseA, /ERRCODE = 'P0001',\s*\n\s*MESSAGE = 'Selected staff is unavailable during this time slot'/);
});
