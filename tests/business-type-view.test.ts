import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BUSINESS_TYPE_COLUMNS,
  BUSINESS_TYPE_LABEL_COLUMN,
  BUSINESS_TYPE_VIEW,
  BUSINESS_TYPE_VIEW_QUALIFIED,
  businessTypeLabel,
  findBusinessType,
  isBusinessTypeCode,
  parseBusinessTypeRows,
  readBusinessTypes,
  resolveBusinessTypeLabelLocale,
  type BusinessTypeReader,
} from '../apps/booking-admin/src/lib/business-type-view.ts';

const read = (path: string) => readFileSync(path, 'utf8');

const VIEW_MODULE = 'apps/booking-admin/src/lib/business-type-view.ts';
const CLIENT_MODULE = 'apps/booking-admin/src/lib/supabase/client.ts';

/** The nine codes the migration lane seeds, in the view's own order. */
const SEEDED_CODES = [
  'barber',
  'car_care',
  'nail_lash',
  'beauty_clinic',
  'spa_massage',
  'studio',
  'sport_court',
  'pet_grooming',
  'other',
] as const;

/** Rows exactly as the migration lane seeds them (label_th/label_en/display_order). */
const SEEDED_ROWS = [
  { type_code: 'barber', emoji: '💈', label_th: 'ร้านตัดผม / บาร์เบอร์', label_en: 'Barber shop / Salon', display_order: 1 },
  { type_code: 'car_care', emoji: '🚗', label_th: 'คาร์แคร์ / ล้างรถ / เคลือบแก้ว', label_en: 'Car care / Car wash / Coating', display_order: 2 },
  { type_code: 'nail_lash', emoji: '💅', label_th: 'ร้านทำเล็บ / ต่อขนตา / สปามือเท้า', label_en: 'Nail salon / Lash extensions / Foot spa', display_order: 3 },
  { type_code: 'beauty_clinic', emoji: '🏥', label_th: 'คลินิกเสริมความงาม / ทันตกรรม', label_en: 'Beauty clinic / Dental clinic', display_order: 4 },
  { type_code: 'spa_massage', emoji: '🧘', label_th: 'สปา / นวดแผนไทย / ดีท็อกซ์', label_en: 'Spa / Thai massage / Detox', display_order: 5 },
  { type_code: 'studio', emoji: '📸', label_th: 'สตูดิโอถ่ายภาพ / สตูดิโอซ้อมดนตรี', label_en: 'Photo studio / Rehearsal studio', display_order: 6 },
  { type_code: 'sport_court', emoji: '🏸', label_th: 'สนามแบดมินตัน / สนามฟุตซอล', label_en: 'Badminton court / Futsal court', display_order: 7 },
  { type_code: 'pet_grooming', emoji: '🐾', label_th: 'อาบน้ำตัดขนสัตว์เลี้ยง (Pet Grooming)', label_en: 'Pet grooming', display_order: 8 },
  { type_code: 'other', emoji: '🏪', label_th: 'อื่น ๆ', label_en: 'Other', display_order: 9 },
] as const;

test('the app reads exactly the view the migration lane named, on the local_service schema', () => {
  const viewModule = read(VIEW_MODULE);
  const clientModule = read(CLIENT_MODULE);

  // The read surface: the view name and the schema the client already talks to.
  assert.equal(BUSINESS_TYPE_VIEW, 'app_business_types');
  assert.equal(BUSINESS_TYPE_VIEW_QUALIFIED, 'local_service.app_business_types');
  assert.match(viewModule, /\.from\(BUSINESS_TYPE_VIEW\)/);
  assert.match(clientModule, /schema: 'local_service'/);

  // The client is INJECTED, never imported here: the view module must carry no import
  // statement reaching the client module, because the node test runner loads these
  // files as real ESM where that extensionless specifier does not resolve (and a `.ts`
  // specifier is rejected by the app's `moduleResolution: bundler`). The page creates
  // the client and passes it in; `local_service` is configured on the client module.
  assert.doesNotMatch(viewModule, /^\s*import\b[^\n]*supabase\/client/m);

  // Exactly the view's five columns, in the view's order — no other column, and never
  // the `business_types` table itself (starter_pattern, is_active, created_at, ...).
  assert.equal(BUSINESS_TYPE_COLUMNS, 'type_code,emoji,label_th,label_en,display_order');
  assert.match(viewModule, /\.select\(BUSINESS_TYPE_COLUMNS\)/);
  assert.doesNotMatch(viewModule, /starter_pattern|is_active|created_at|updated_at/);
  assert.doesNotMatch(viewModule, /from\(['"]business_types['"]\)/);
});

/** A stub of the app's Supabase client that records what the reader asked for. */
function stubClient(response: { data?: unknown; error?: unknown; reject?: Error }) {
  const asked: { relation?: string; columns?: string } = {};
  const client: BusinessTypeReader = {
    from(relation: string) {
      asked.relation = relation;
      return {
        select(columns: string) {
          asked.columns = columns;
          return response.reject
            ? { then: () => { throw response.reject; } }
            : Promise.resolve({ data: response.data, error: response.error });
        },
      };
    },
  };
  return { client, asked };
}

test('the read path asks the view for its five columns and carries no other column', async () => {
  const { client, asked } = stubClient({ data: SEEDED_ROWS, error: null });

  const result = await readBusinessTypes(client);

  assert.equal(asked.relation, 'app_business_types');
  assert.equal(asked.columns, 'type_code,emoji,label_th,label_en,display_order');
  assert.equal(result.status, 'loaded');
  assert.equal(result.types.length, SEEDED_CODES.length);
  assert.deepEqual(result.types.map((type) => type.typeCode), [...SEEDED_CODES]);
});

test('a failing read is unavailable through the same path, and never a partial list', async () => {
  // The client returns an error instead of rows (a privilege error on the view, say).
  const denied = stubClient({ data: null, error: { message: 'permission denied for view' } });
  assert.deepEqual(await readBusinessTypes(denied.client), { status: 'unavailable', types: [] });

  // The read itself rejects, which must not escape as a throw.
  const broken: BusinessTypeReader = {
    from() {
      return {
        select() {
          return Promise.reject(new Error('network down'));
        },
      };
    },
  };
  assert.deepEqual(await readBusinessTypes(broken), { status: 'unavailable', types: [] });
});

test('the app carries no business type code list', () => {
  const viewModule = read(VIEW_MODULE);

  // N-4: the codes belong to the database. The module must not contain any of them
  // as data, and must not filter or re-sort the list the view already ordered.
  for (const code of SEEDED_CODES) {
    assert.doesNotMatch(viewModule, new RegExp(`['"]${code}['"]`), `${code} must not be embedded`);
  }
  assert.doesNotMatch(viewModule, /BUSINESS_TYPES|listBusinessTypes/);
});

test('the one remaining code mapping is the locale to stored label column', () => {
  assert.deepEqual(BUSINESS_TYPE_LABEL_COLUMN, { th: 'label_th', en: 'label_en' });
  assert.equal(resolveBusinessTypeLabelLocale('th'), 'th');
  assert.equal(resolveBusinessTypeLabelLocale('en'), 'en');
  assert.equal(resolveBusinessTypeLabelLocale('fr'), 'th');
  assert.equal(resolveBusinessTypeLabelLocale(undefined), 'th');

  const item = { typeCode: 'barber', emoji: '💈', labelTh: 'ไทย', labelEn: 'English', displayOrder: 1 };
  assert.equal(businessTypeLabel(item, 'th'), 'ไทย');
  assert.equal(businessTypeLabel(item, 'en'), 'English');
  assert.equal(businessTypeLabel(item, 'fr'), 'ไทย');
});

test('the seeded database codes render through the read surface', () => {
  const result = parseBusinessTypeRows(SEEDED_ROWS, null);

  assert.equal(result.status, 'loaded');
  assert.deepEqual(result.types.map((type) => type.typeCode), [...SEEDED_CODES]);
  assert.deepEqual(result.types.map((type) => type.displayOrder), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // The view returns the label of either language, so both are kept on the row.
  assert.equal(result.types[0].labelTh, 'ร้านตัดผม / บาร์เบอร์');
  assert.equal(result.types[0].labelEn, 'Barber shop / Salon');
  assert.equal(result.types[8].typeCode, 'other');

  for (const code of SEEDED_CODES) {
    assert.equal(isBusinessTypeCode(result.types, code), true, `${code} from the view is a usable code`);
  }
  assert.equal(isBusinessTypeCode(result.types, 'hair_barber'), false);
  assert.equal(isBusinessTypeCode(result.types, 'nope'), false);
  assert.equal(isBusinessTypeCode(result.types, undefined), false);

  assert.deepEqual(findBusinessType(result.types, 'spa_massage')?.typeCode, 'spa_massage');
  assert.equal(findBusinessType(result.types, 'hair_barber'), null);
  assert.equal(findBusinessType(result.types, ''), null);
  assert.equal(findBusinessType(result.types, undefined), null);
});

test('an unreadable or malformed response is unavailable, never an invented list', () => {
  // A client error and a thrown/failed read both land here.
  assert.deepEqual(parseBusinessTypeRows(undefined, { message: 'forbidden' }), {
    status: 'unavailable',
    types: [],
  });
  // A response that is not an array of rows.
  assert.deepEqual(parseBusinessTypeRows({ error: 'nope' }, null), { status: 'unavailable', types: [] });
  assert.deepEqual(parseBusinessTypeRows(null, null), { status: 'unavailable', types: [] });
  assert.deepEqual(parseBusinessTypeRows('rows', null), { status: 'unavailable', types: [] });

  // One malformed row makes the whole list unavailable rather than a half list.
  assert.deepEqual(parseBusinessTypeRows([SEEDED_ROWS[0], { type_code: 'barber' }], null), {
    status: 'unavailable',
    types: [],
  });
  assert.deepEqual(parseBusinessTypeRows([{ ...SEEDED_ROWS[0], display_order: '1' }], null), {
    status: 'unavailable',
    types: [],
  });
  assert.deepEqual(parseBusinessTypeRows([{ ...SEEDED_ROWS[0], emoji: '' }], null), {
    status: 'unavailable',
    types: [],
  });
  // Codes the database could not legitimately hold are rejected too.
  assert.deepEqual(parseBusinessTypeRows([{ ...SEEDED_ROWS[0], type_code: 'Hair Barber' }], null), {
    status: 'unavailable',
    types: [],
  });

  // Either way the result carries no rows, so nothing can be invented from it.
  assert.equal(parseBusinessTypeRows(undefined, { message: 'forbidden' }).types.length, 0);
});

test('a well-formed but empty view is empty, not unavailable', () => {
  assert.deepEqual(parseBusinessTypeRows([], null), { status: 'empty', types: [] });
  assert.deepEqual(parseBusinessTypeRows([], { message: 'forbidden' }), {
    status: 'unavailable',
    types: [],
  });
});

test('the view row parser accepts only complete rows', () => {
  const loaded = parseBusinessTypeRows(SEEDED_ROWS, null);
  assert.equal(loaded.status, 'loaded');
  for (const type of loaded.types) {
    assert.match(type.typeCode, /^[a-z][a-z0-9_]*$/);
    assert.ok(type.emoji.length > 0);
    assert.ok(type.labelTh.trim().length > 0);
    assert.ok(type.labelEn.trim().length > 0);
    assert.ok(Number.isInteger(type.displayOrder));
  }
});
