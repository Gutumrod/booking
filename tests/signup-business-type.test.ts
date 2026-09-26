import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BUSINESS_PATTERNS,
  BUSINESS_PATTERN_VERSION,
  buildSignupIntent,
  findBusinessPattern,
  businessPatternMessagePaths,
  getPatternId,
  summarizeOpeningHours,
  validateBusinessPatternCatalogue,
} from '../apps/booking-admin/src/lib/business-type-catalogue.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const MESSAGES = ['apps/booking-admin/messages/th.json', 'apps/booking-admin/messages/en.json'];

/** A row shaped exactly like `local_service.app_business_types` returns one. */
const DB_ROW = {
  typeCode: 'barber',
  emoji: '💈',
  labelTh: 'ร้านตัดผม / บาร์เบอร์',
  labelEn: 'Barber shop / Salon',
  displayOrder: 1,
} as const;

function readJsonPath(source: unknown, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object' && key in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

test('every bundled starter pattern is complete', () => {
  assert.deepEqual(validateBusinessPatternCatalogue(), []);
  assert.ok(Object.keys(BUSINESS_PATTERNS).length >= 1);

  for (const [typeCode, entry] of Object.entries(BUSINESS_PATTERNS)) {
    // Services: at least three example services, each with a usable duration.
    assert.ok(entry.pattern.services.length >= 3, `${typeCode} needs example services`);
    for (const service of entry.pattern.services) {
      assert.ok(service.key.length > 0, `${typeCode} service key`);
      assert.ok(Number.isInteger(service.durationMinutes), `${typeCode}/${service.key} duration`);
      assert.ok(service.durationMinutes > 0, `${typeCode}/${service.key} duration > 0`);
      assert.equal(service.durationMinutes % 15, 0, `${typeCode}/${service.key} multiple of 15`);
    }

    // Opening hours: exactly one entry per weekday, closed days carry no times.
    assert.equal(entry.pattern.openingHours.length, 7, `${typeCode} must define all 7 weekdays`);
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      const day = entry.pattern.openingHours.find((row) => row.dayOfWeek === dayOfWeek);
      assert.ok(day, `${typeCode} weekday ${dayOfWeek}`);
      if (day.isOpen) {
        assert.match(day.open ?? '', /^\d{2}:\d{2}$/, `${typeCode} weekday ${dayOfWeek} open`);
        assert.match(day.close ?? '', /^\d{2}:\d{2}$/, `${typeCode} weekday ${dayOfWeek} close`);
        assert.ok((day.open ?? '') < (day.close ?? ''), `${typeCode} weekday ${dayOfWeek} close after open`);
      } else {
        assert.equal(day.open, null, `${typeCode} weekday ${dayOfWeek} closed has no open time`);
        assert.equal(day.close, null, `${typeCode} weekday ${dayOfWeek} closed has no close time`);
      }
    }

    // Pattern identity is versioned so a later pattern edit stays analysable.
    assert.equal(getPatternId(typeCode), `${typeCode}.v${BUSINESS_PATTERN_VERSION}`);
  }
});

test('the bundled patterns are keyed by stored type codes, never by app-invented ids', () => {
  // N-4: the codes belong to the database. Whatever this mapping is keyed by must
  // be a stored code shape, and the app must not offer a list of its own.
  for (const typeCode of Object.keys(BUSINESS_PATTERNS)) {
    assert.match(typeCode, /^[a-z][a-z0-9_]*$/, `${typeCode} must be a stored-code shape`);
  }

  // The catch-all is the seeded 'other', not the WU-A3 ids this work removed.
  assert.ok(BUSINESS_PATTERNS.other, "the seeded catch-all 'other' has a bundled pattern");

  // The retired WU-A3 codes must be gone: codes the database does not seed.
  for (const retired of ['hair_barber', 'beauty_salon', 'nail_salon']) {
    assert.equal(
      findBusinessPattern(retired),
      null,
      `${retired} is not a seeded code and must not resolve to a pattern`,
    );
  }
});

test('a database code with no bundled pattern resolves to null, never to a guessed pattern', () => {
  assert.equal(findBusinessPattern('spa_massage'), null);
  assert.equal(findBusinessPattern('studio'), null);
  assert.equal(findBusinessPattern(''), null);
  assert.equal(findBusinessPattern(undefined), null);
  assert.equal(findBusinessPattern(42), null);
  assert.equal(findBusinessPattern('nope'), null);
  assert.ok(findBusinessPattern('barber'));
});

test('signup records the type the database returned, with its pattern and plan', () => {
  const intent = buildSignupIntent({
    type: DB_ROW,
    label: DB_ROW.labelEn,
    source: 'local_service.app_business_types',
    selectedPlan: 'free_trial',
  });

  assert.ok(intent);
  assert.equal(intent.businessType.typeCode, 'barber');
  assert.equal(intent.selectedPlan, 'free_trial');

  // The chosen type, its database-provided presentation, the read surface and the plan travel together.
  assert.equal(intent.pattern.business_type, 'barber');
  assert.equal(intent.pattern.business_type_label, 'Barber shop / Salon');
  assert.equal(intent.pattern.business_type_emoji, '💈');
  assert.equal(intent.pattern.business_type_display_order, 1);
  assert.equal(intent.pattern.business_type_source, 'local_service.app_business_types');
  assert.equal(intent.pattern.pattern_id, `barber.v${BUSINESS_PATTERN_VERSION}`);
  assert.equal(intent.pattern.pattern_version, BUSINESS_PATTERN_VERSION);
  assert.equal(intent.pattern.pattern_source, 'bundled-starter-pattern');

  const entry = BUSINESS_PATTERNS.barber;
  assert.equal(intent.pattern.pattern_service_count, entry.pattern.services.length);
  assert.deepEqual(
    intent.pattern.pattern_service_keys,
    entry.pattern.services.map((service) => service.key),
  );
  assert.equal(
    intent.pattern.pattern_total_duration_minutes,
    entry.pattern.services.reduce((total, service) => total + service.durationMinutes, 0),
  );
  assert.deepEqual(
    intent.pattern.pattern_working_days,
    entry.pattern.openingHours.filter((day) => day.isOpen).map((day) => day.dayOfWeek).sort((a, b) => a - b),
  );

  // The plan is recorded for each paid tier too, not only the trial.
  for (const plan of ['free_trial', 'basic_490', 'pro_990'] as const) {
    const paid = buildSignupIntent({
      type: DB_ROW,
      label: DB_ROW.labelEn,
      source: 'local_service.app_business_types',
      selectedPlan: plan,
    });
    assert.equal(paid?.selectedPlan, plan);
    assert.equal(paid?.pattern.pattern_id, intent.pattern.pattern_id);
  }
});

test('a database code with no bundled pattern is accepted and says so on the payload', () => {
  const intent = buildSignupIntent({
    type: { typeCode: 'spa_massage', emoji: '🧘', displayOrder: 5 },
    label: 'สปา / นวดแผนไทย / ดีท็อกซ์',
    source: 'local_service.app_business_types',
    selectedPlan: 'basic_490',
  });

  assert.ok(intent, 'a code the database returned must be selectable');
  assert.equal(intent.pattern.business_type, 'spa_massage');
  assert.equal(intent.pattern.pattern_source, 'none');
  assert.equal(intent.pattern.pattern_id, null);
  assert.equal(intent.pattern.pattern_service_count, 0);
  assert.deepEqual(intent.pattern.pattern_service_keys, []);
  assert.deepEqual(intent.pattern.pattern_working_days, []);
});

test('signup refuses a missing or unusable type instead of defaulting', () => {
  const base = { label: 'x', source: 'local_service.app_business_types', selectedPlan: 'free_trial' } as const;

  assert.equal(buildSignupIntent({ ...base, type: null }), null);
  assert.equal(buildSignupIntent({ ...base, type: undefined }), null);
  assert.equal(
    buildSignupIntent({ ...base, type: { typeCode: '', emoji: 'x', displayOrder: 1 } }),
    null,
  );
  assert.equal(
    buildSignupIntent({ ...base, type: { typeCode: 'Hair Barber', emoji: 'x', displayOrder: 1 } }),
    null,
  );

  // The rule the lines above state is about the SHAPE of the code, not about which code
  // it is: a missing, empty or malformed code is refused. 'other' is NOT a refusal — it
  // is one of the nine codes the migration lane genuinely seeds (display_order 9), so a
  // signup that chooses it must be accepted. This assertion used to require null here,
  // which was the test's error rather than an implementation rule; it is corrected to
  // assert acceptance, matching the other seeded code asserted in the test above.
  const other = buildSignupIntent({
    type: {
      typeCode: 'other',
      emoji: '🏪',
      displayOrder: 9,
    },
    label: 'อื่น ๆ',
    source: 'local_service.app_business_types',
    selectedPlan: 'free_trial',
  });
  assert.ok(other, "the seeded catch-all 'other' must be selectable, not refused");
  assert.equal(other.businessType.typeCode, 'other');
  assert.equal(other.pattern.business_type, 'other');
  assert.equal(other.pattern.business_type_source, 'local_service.app_business_types');
});

test('the signup page renders the type list from the database view, not from an embedded list', () => {
  const page = read('apps/booking-admin/src/app/register/page.tsx');

  // The list is read through the app's Supabase client surface and nothing else. The
  // client is created by the page (it already imports `createClient`) and passed INTO
  // the reader, so the reader itself needs no module-scope client import.
  assert.match(page, /loadBusinessTypes\(createClient\(\)\)/);
  assert.match(page, /import \{ createClient \} from '@\/lib\/supabase\/client'/);
  assert.match(page, /findBusinessType\(businessTypes, businessType\)/);
  assert.match(page, /businessTypes\.map\(/);
  assert.match(page, /businessTypeLabel\(type, locale\)/);

  // The retired in-app type list is not used at all.
  assert.doesNotMatch(page, /listBusinessTypes/);
  assert.doesNotMatch(page, /BUSINESS_TYPES/);
  assert.doesNotMatch(page, /isBusinessTypeId/);
  assert.doesNotMatch(page, /getBusinessType\(/);
  // No app-invented code appears in the page.
  for (const code of ['hair_barber', 'beauty_salon', 'nail_salon']) {
    assert.doesNotMatch(page, new RegExp(code), `the page must not carry the app-invented code ${code}`);
  }

  // The intent is built from the row the database returned.
  assert.match(page, /buildSignupIntent\(\{/);
  assert.match(page, /type: selectedBusinessType/);
  assert.match(page, /source: BUSINESS_TYPE_VIEW_QUALIFIED/);

  // The chosen type, its database-provided presentation and the plan are written onto the payload.
  for (const field of [
    'businessType',
    'businessTypeLabel',
    'businessTypeEmoji',
    'businessTypeDisplayOrder',
    'businessTypeSource',
    'patternMessageKey',
    'patternSource',
    'patternId',
    'patternVersion',
    'patternServiceCount',
    'patternTotalDurationMinutes',
    'patternServiceKeys',
    'patternWorkingDays',
  ]) {
    assert.match(page, new RegExp(`${field}: `), `payload records ${field}`);
  }
  assert.match(page, /selectedPlan: intent\.selectedPlan/);

  // The business type is asked for before the rest of the flow.
  assert.match(page, /STEP 1: BUSINESS TYPE/);
  assert.match(page, /stepBusinessTypeTitle/);
  // A missing type blocks progress instead of silently defaulting.
  assert.match(page, /if \(currentStep === 1 && !businessType\)/);
  assert.match(page, /businessTypeRequired/);

  // The signup must not invent a per-type branch; the data owns the list.
  assert.doesNotMatch(page, /businessType === 'hair_barber'|businessType === 'beauty_salon'|businessType === 'nail_salon'/);
});

test('the signup page degrades honestly when the type list cannot be read', () => {
  const page = read('apps/booking-admin/src/app/register/page.tsx');
  const th = JSON.parse(read(MESSAGES[0])) as { auth: Record<string, string> };
  const en = JSON.parse(read(MESSAGES[1])) as { auth: Record<string, string> };

  // Every failure state has its own message, and none of them shows a list.
  for (const key of ['businessTypeLoading', 'businessTypeEmpty', 'businessTypeUnavailable', 'businessTypePatternUnavailable']) {
    assert.equal(typeof th.auth[key], 'string', `th auth.${key}`);
    assert.equal(typeof en.auth[key], 'string', `en auth.${key}`);
    assert.ok(th.auth[key].trim().length > 0);
    assert.ok(en.auth[key].trim().length > 0);
    assert.match(page, new RegExp(key), `the page must render ${key}`);
  }

  // The list block is drawn only from returned rows — an empty list renders no cards.
  assert.match(page, /\{businessTypes\.length > 0 && \(/);
  assert.match(page, /businessTypeStatus === 'unavailable'/);
  assert.match(page, /businessTypeStatus === 'empty'/);
});

test('Thai and English pattern copy exist with the same key set', () => {
  const catalogues = MESSAGES.map((path) => JSON.parse(read(path)) as Record<string, unknown>);

  for (const catalogue of catalogues) {
    assert.ok(catalogue.businessType, 'businessType namespace must exist');
  }

  // Every description and service label of every bundled pattern resolves in both languages.
  for (const entry of Object.values(BUSINESS_PATTERNS)) {
    for (const path of businessPatternMessagePaths(entry)) {
      for (const messageIndex of catalogues.keys()) {
        const value = readJsonPath(catalogues[messageIndex].businessType, path);
        assert.equal(typeof value, 'string', `missing businessType.${path} in ${MESSAGES[messageIndex]}`);
        assert.ok((value as string).trim().length > 0, `empty businessType.${path} in ${MESSAGES[messageIndex]}`);
      }
    }
  }

  for (const key of ['closedDay']) {
    for (const messageIndex of catalogues.keys()) {
      assert.equal(typeof readJsonPath(catalogues[messageIndex].businessType, key), 'string');
    }
  }

  // Matching key sets: no key exists in one catalogue and not the other.
  const collectKeys = (source: unknown, prefix = ''): string[] => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return [prefix];
    return Object.entries(source as Record<string, unknown>)
      .flatMap(([key, value]) => collectKeys(value, prefix ? `${prefix}.${key}` : key));
  };
  const thKeys = collectKeys(catalogues[0].businessType).sort();
  const enKeys = collectKeys(catalogues[1].businessType).sort();
  assert.deepEqual(thKeys, enKeys, 'TH and EN businessType key sets must match');
  assert.ok(thKeys.length > 0);

  // Copy still exists only for codes the app bundles a pattern for — nothing extra.
  const thPatternKeys = collectKeys(catalogues[0].businessType)
    .filter((key) => !key.startsWith('other.') || true)
    .filter((key) => key.split('.').length > 1 && !key.includes('services.'))
    .map((key) => key.split('.')[0]);
  for (const messageKey of new Set(thPatternKeys)) {
    assert.ok(
      Object.values(BUSINESS_PATTERNS).some((entry) => entry.messageKey === messageKey),
      `businessType.${messageKey} has copy but no bundled pattern`,
    );
  }
});

test('signup step copy states the four-step flow in both languages', () => {
  for (const path of MESSAGES) {
    const messages = JSON.parse(read(path)) as { auth: Record<string, string> };
    for (const key of [
      'stepBusinessTypeTitle',
      'stepBusinessTypeShort',
      'businessTypeSelectHint',
      'businessTypeRequired',
      'businessTypePatternServicesTitle',
      'businessTypePatternHoursTitle',
      'businessTypePatternEditableNote',
      'businessTypeSourceNote',
    ]) {
      assert.equal(typeof messages.auth[key], 'string', `${path} auth.${key}`);
    }
    assert.match(messages.auth.stepBusinessTypeTitle, /1\/4/);
    assert.match(messages.auth.stepShopTitle, /2\/4/);
    assert.match(messages.auth.stepPlanTitle, /3\/4/);
    assert.match(messages.auth.stepPromptpayTitle, /4\/4/);
  }
});

test('opening hours summarise in the active locale with a closed-day label', () => {
  const entry = findBusinessPattern('barber');
  assert.ok(entry);
  const lines = summarizeOpeningHours(entry.pattern, {
    dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    closedLabel: 'Closed',
  });

  assert.equal(lines.length, 7);
  assert.equal(lines[0], 'Sun: 10:00-20:00 (13:00-14:00)');
  assert.equal(lines[1], 'Mon: Closed');

  const thaiLines = summarizeOpeningHours(entry.pattern, {
    dayNames: ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'],
    closedLabel: 'หยุด',
  });
  assert.equal(thaiLines[1], 'จันทร์: หยุด');
});
