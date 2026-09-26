import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_PATTERN_VERSION,
  businessTypeMessagePaths,
  buildSignupIntent,
  getBusinessType,
  getPatternId,
  isBusinessTypeId,
  listBusinessTypes,
  summarizeOpeningHours,
  validateBusinessTypeCatalogue,
} from '../apps/booking-admin/src/lib/business-type-catalogue.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const MESSAGES = ['apps/booking-admin/messages/th.json', 'apps/booking-admin/messages/en.json'];

function readJsonPath(source: unknown, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object' && key in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

test('every defined business type carries a complete starter pattern', () => {
  assert.deepEqual(validateBusinessTypeCatalogue(), []);
  assert.ok(BUSINESS_TYPES.length >= 4, 'the README main groups plus an other category');

  for (const type of listBusinessTypes()) {
    // Services: at least three example services, each with a usable duration.
    assert.ok(type.pattern.services.length >= 3, `${type.id} needs example services`);
    for (const service of type.pattern.services) {
      assert.ok(service.key.length > 0, `${type.id} service key`);
      assert.ok(Number.isInteger(service.durationMinutes), `${type.id}/${service.key} duration`);
      assert.ok(service.durationMinutes > 0, `${type.id}/${service.key} duration > 0`);
      assert.equal(service.durationMinutes % 15, 0, `${type.id}/${service.key} multiple of 15`);
    }

    // Opening hours: exactly one entry per weekday, closed days carry no times.
    assert.equal(type.pattern.openingHours.length, 7, `${type.id} must define all 7 weekdays`);
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      const day = type.pattern.openingHours.find((entry) => entry.dayOfWeek === dayOfWeek);
      assert.ok(day, `${type.id} weekday ${dayOfWeek}`);
      if (day.isOpen) {
        assert.match(day.open ?? '', /^\d{2}:\d{2}$/, `${type.id} weekday ${dayOfWeek} open`);
        assert.match(day.close ?? '', /^\d{2}:\d{2}$/, `${type.id} weekday ${dayOfWeek} close`);
        assert.ok((day.open ?? '') < (day.close ?? ''), `${type.id} weekday ${dayOfWeek} close after open`);
      } else {
        assert.equal(day.open, null, `${type.id} weekday ${dayOfWeek} closed has no open time`);
        assert.equal(day.close, null, `${type.id} weekday ${dayOfWeek} closed has no close time`);
      }
    }

    // Pattern identity is versioned so a later pattern edit stays analysable.
    assert.equal(getPatternId(type), `${type.id}.v${BUSINESS_TYPE_PATTERN_VERSION}`);
  }
});

test('the catalogue names the README main groups plus an other category', () => {
  assert.deepEqual(
    listBusinessTypes().map((type) => type.id),
    ['hair_barber', 'beauty_salon', 'nail_salon', 'other'],
  );
});

test('an unknown or missing business type is rejected, never defaulted', () => {
  assert.equal(getBusinessType('car_care'), null);
  assert.equal(getBusinessType(''), null);
  assert.equal(getBusinessType(undefined), null);
  assert.equal(getBusinessType(42), null);
  assert.equal(isBusinessTypeId('hair_barber'), true);
  assert.equal(isBusinessTypeId('nope'), false);
});

test('signup accepts every defined type and records the type, pattern and plan', () => {
  for (const type of listBusinessTypes()) {
    const intent = buildSignupIntent({ businessType: type.id, selectedPlan: 'free_trial' });

    assert.ok(intent, `${type.id} must be accepted`);
    assert.equal(intent.businessType.id, type.id);
    assert.equal(intent.selectedPlan, 'free_trial');

    // The chosen type, the chosen pattern and the selected plan travel together.
    assert.equal(intent.pattern.business_type, type.id);
    assert.equal(intent.pattern.business_type_key, type.messageKey);
    assert.equal(intent.pattern.pattern_id, `${type.id}.v${BUSINESS_TYPE_PATTERN_VERSION}`);
    assert.equal(intent.pattern.pattern_version, BUSINESS_TYPE_PATTERN_VERSION);
    assert.equal(intent.pattern.pattern_service_count, type.pattern.services.length);
    assert.deepEqual(
      intent.pattern.pattern_service_keys,
      type.pattern.services.map((service) => service.key),
    );
    assert.equal(
      intent.pattern.pattern_total_duration_minutes,
      type.pattern.services.reduce((total, service) => total + service.durationMinutes, 0),
    );
    assert.deepEqual(
      intent.pattern.pattern_working_days,
      type.pattern.openingHours.filter((day) => day.isOpen).map((day) => day.dayOfWeek).sort((a, b) => a - b),
    );

    // The plan is recorded for each paid tier too, not only the trial.
    for (const plan of ['free_trial', 'basic_490', 'pro_990'] as const) {
      const paid = buildSignupIntent({ businessType: type.id, selectedPlan: plan });
      assert.equal(paid?.selectedPlan, plan, `${type.id}/${plan}`);
      assert.equal(paid?.pattern.pattern_id, intent.pattern.pattern_id);
    }
  }
});

test('signup refuses a missing or unknown business type', () => {
  assert.equal(buildSignupIntent({ businessType: '', selectedPlan: 'free_trial' }), null);
  assert.equal(buildSignupIntent({ businessType: 'hair_barber_v2', selectedPlan: 'free_trial' }), null);
  assert.equal(buildSignupIntent({ businessType: undefined, selectedPlan: 'basic_490' }), null);
});

test('the signup page drives the type and pattern from catalogue data, not from conditionals', () => {
  const page = read('apps/booking-admin/src/app/register/page.tsx');

  // The type list is read from the data module.
  assert.match(page, /listBusinessTypes\(\)/);
  assert.match(page, /getBusinessType\(businessType\)/);
  assert.match(page, /buildSignupIntent\(\{ businessType, selectedPlan \}\)/);

  // The chosen type, pattern and plan are all written onto the payload.
  for (const field of [
    'businessType',
    'businessTypeKey',
    'patternId',
    'patternVersion',
    'patternServiceCount',
    'patternTotalDurationMinutes',
    'patternServiceKeys',
    'patternWorkingDays',
  ]) {
    assert.match(page, new RegExp(`${field}: intent\\.pattern\\.`), `payload records ${field}`);
  }
  assert.match(page, /selectedPlan: intent\.selectedPlan/);

  // The business type is asked for before the rest of the flow.
  assert.match(page, /STEP 1: BUSINESS TYPE/);
  assert.match(page, /stepBusinessTypeTitle/);
  // A missing type blocks progress instead of silently defaulting.
  assert.match(page, /if \(currentStep === 1 && !businessType\)/);
  assert.match(page, /businessTypeRequired/);

  // The signup must not invent a per-type branch; the catalogue owns the data.
  assert.doesNotMatch(page, /businessType === 'hair_barber'|businessType === 'beauty_salon'|businessType === 'nail_salon'/);
});

test('Thai and English business-type copy exist with the same key set', () => {
  const catalogues = MESSAGES.map((path) => JSON.parse(read(path)) as Record<string, unknown>);

  for (const catalogue of catalogues) {
    assert.ok(catalogue.businessType, 'businessType namespace must exist');
  }

  // Every type, description and service label resolves in both languages.
  for (const type of listBusinessTypes()) {
    for (const path of businessTypeMessagePaths(type)) {
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
  const type = getBusinessType('hair_barber');
  assert.ok(type);
  const lines = summarizeOpeningHours(type.pattern, {
    dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    closedLabel: 'Closed',
  });

  assert.equal(lines.length, 7);
  assert.equal(lines[0], 'Sun: 10:00-20:00 (13:00-14:00)');
  assert.equal(lines[1], 'Mon: Closed');

  const thaiLines = summarizeOpeningHours(type.pattern, {
    dayNames: ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'],
    closedLabel: 'หยุด',
  });
  assert.equal(thaiLines[1], 'จันทร์: หยุด');
});
