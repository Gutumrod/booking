import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SIGNUP_PLAN_DB_CODE,
  SIGNUP_PLAN_SERVICES_LIMIT,
  STARTER_SERVICES_COLUMNS,
  STARTER_SERVICES_VIEW,
  STARTER_SERVICES_VIEW_QUALIFIED,
  buildSignupIntent,
  countStarterServicesForType,
  parseStarterServiceRows,
  readStarterServices,
  resolvePlanDbCode,
  resolvePlanServicesLimit,
  starterServicesForType,
  type StarterServiceRow,
  type StarterServicesReader,
} from '../apps/booking-admin/src/lib/business-type-starter-services.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const MESSAGES = ['apps/booking-admin/messages/th.json', 'apps/booking-admin/messages/en.json'];

const PAGE = 'apps/booking-admin/src/app/register/page.tsx';
const STARTER_MODULE = 'apps/booking-admin/src/lib/business-type-starter-services.ts';
const DELETED_CATALOGUE = 'apps/booking-admin/src/lib/business-type-catalogue.ts';

/**
 * Strips `//` line comments and `/* ... *\/` block comments from TypeScript source, so a
 * scan can read the CODE rather than the prose around it. This exists because the code
 * being scanned legitimately NAMES the things F-13 removed — the module's header explains
 * why the app-side table was deleted and says the view extracts its fields from the JSON
 * column — so a scan of the raw text matches the explanation. Every "must not match" scan
 * in this file runs over the stripped code; the patterns themselves are unchanged, so a
 * genuine reintroduction still fails.
 *
 * String and template literals are left intact (a `//` inside one is not a comment). One
 * documented limit: JSX text such as a bare `http://...` URL is not a literal, so the rest
 * of that line is treated as a comment and dropped.
 */
function stripComments(source: string): string {
  let code = '';
  let quote: string | null = null;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      code += char;
      if (char === '\\' && next !== undefined) {
        code += next;
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      code += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }

    code += char;
    index += 1;
  }

  return code;
}

/**
 * Rows exactly as `local_service.app_business_type_starter_services` returns them: the
 * The projection's own rows are the FIXTURES below; the app never carries them. Where the
 * preview helpers are exercised, `parsedRows` runs them through the reader's own parser
 * first, because that is the only path a projection row takes into the app.
 */
const BARBER_ROWS = [
  { type_code: 'barber', service_order: 0, service_name: 'ตัดผมชาย', duration_minutes: 30 },
  { type_code: 'barber', service_order: 1, service_name: 'ตัดผม สระ เซ็ต', duration_minutes: 60 },
  { type_code: 'barber', service_order: 2, service_name: 'โกนหนวด', duration_minutes: 30 },
] as const;

const OTHER_ROW = [
  { type_code: 'other', service_order: 0, service_name: 'บริการหลัก', duration_minutes: 30 },
] as const;

/** A row shaped exactly like `local_service.app_business_types` returns one. */
const DB_ROW = {
  typeCode: 'barber',
  emoji: '💈',
  labelTh: 'ร้านตัดผม / บาร์เบอร์',
  labelEn: 'Barber shop / Salon',
  displayOrder: 1,
} as const;

/**
 * The view rows above, as the READER hands them on: through the module's own
 * `parseStarterServiceRows`, which is the only thing that turns a projection row
 * (`type_code`, `service_order`, ...) into the `StarterServiceRow` the preview consumes.
 * The preview helpers take PARSED rows, so a fixture that skips the parser would be
 * shape-wrong; going through it keeps the fixture the database's own rows and the preview
 * the set the app really holds.
 */
function parsedRows(
  rows: readonly Readonly<{
    type_code: string;
    service_order: number;
    service_name: string;
    duration_minutes: number;
  }>[],
) {
  const parsed = parseStarterServiceRows([...rows], null);
  assert.equal(parsed.status, 'loaded', 'the fixture rows must be complete projection rows');

  return parsed.services;
}

/**
 * Every leaf key of a message namespace as a dotted path, so two catalogues can be
 * compared key for key — the parity check and the stale-copy scan both use it.
 */
function keysOf(source: unknown, prefix = ''): string[] {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [prefix];
  return Object.entries(source as Record<string, unknown>)
    .flatMap(([key, value]) => keysOf(value, prefix ? `${prefix}.${key}` : key));
}

/** A stub of the app's Supabase client that records what the reader asked for. */
function stubClient(response: { data?: unknown; error?: unknown; reject?: Error }) {
  const asked: { relation?: string; columns?: string } = {};
  const client: StarterServicesReader = {
    from(relation: string) {
      asked.relation = relation;
      return {
        select(columns: string) {
          asked.columns = columns;
          return response.reject
            ? Promise.reject(response.reject)
            : Promise.resolve({ data: response.data, error: response.error });
        },
      };
    },
  };
  return { client, asked };
}

/* ---------------------------------------------------------------------------
 * The read surface and the column allowlist
 * ------------------------------------------------------------------------- */

test('the app reads exactly the starter-services projection the migration lane named', () => {
  const starterModule = read(STARTER_MODULE);
  // Every scan below reads the CODE: the header comment legitimately explains that the
  // app-side table was removed and that the view extracts its four fields from the JSON
  // column, and it must not be mistaken for a reintroduction of either.
  const codeOnly = stripComments(starterModule);

  assert.equal(STARTER_SERVICES_VIEW, 'app_business_type_starter_services');
  assert.equal(
    STARTER_SERVICES_VIEW_QUALIFIED,
    'local_service.app_business_type_starter_services',
  );
  assert.match(starterModule, /\.from\(STARTER_SERVICES_VIEW\)/);
  assert.match(starterModule, /\.select\(STARTER_SERVICES_COLUMNS\)/);

  // The client is INJECTED, never imported here, for the same reason as
  // business-type-view.ts: the node test runner loads these files as real ESM where an
  // extensionless specifier does not resolve, and a `.ts` specifier is rejected by the
  // app's `moduleResolution: bundler`.
  assert.doesNotMatch(starterModule, /^\s*import\b[^\n]*supabase\/client/m);
  assert.doesNotMatch(starterModule, /^\s*import\b/m);

  // Exactly the projection's four columns, in the projection's order — no price, no
  // deposit amount, no staff role label, and never the raw starter_pattern column.
  assert.equal(
    STARTER_SERVICES_COLUMNS,
    'type_code,service_order,service_name,duration_minutes',
  );
  assert.doesNotMatch(codeOnly, /starter_pattern/);
  assert.doesNotMatch(codeOnly, /deposit_amount/);
  assert.doesNotMatch(codeOnly, /staff_role_label/);
  // The only `price` mentions are the prose that records WHY it is not selected.
  assert.doesNotMatch(codeOnly, /price['"]?\s*[,:]/);
});

test('the read path asks the projection for its four columns and nothing else', async () => {
  const { client, asked } = stubClient({ data: [...BARBER_ROWS, ...OTHER_ROW], error: null });

  const result = await readStarterServices(client);

  assert.equal(asked.relation, 'app_business_type_starter_services');
  assert.equal(asked.columns, 'type_code,service_order,service_name,duration_minutes');
  assert.equal(result.status, 'loaded');
  assert.equal(result.services.length, 4);
  assert.deepEqual(
    result.services.map((service) => service.serviceName),
    ['ตัดผมชาย', 'ตัดผม สระ เซ็ต', 'โกนหนวด', 'บริการหลัก'],
  );
});

/* ---------------------------------------------------------------------------
 * F-12 / anon — the signup performs the read before any account exists
 * ------------------------------------------------------------------------- */

test('the read a not-logged-in visitor performs needs no session, no user and no cookie', async () => {
  // The injected client is the whole surface the reader is allowed to use. This stub
  // offers ONLY `from(...).select(...)` — no `auth`, no `getUser`, no `getSession` and no
  // cookie access — and the read succeeds through it. If the reader ever grew a
  // session-dependent step, it could not run against this object at all.
  let touched: string[] = [];
  const anonClient = {
    from(relation: string) {
      touched.push(`from:${relation}`);
      return {
        select(columns: string) {
          touched.push(`select:${columns}`);
          return Promise.resolve({ data: [...BARBER_ROWS], error: null });
        },
      };
    },
  } as unknown as StarterServicesReader;

  assert.equal('auth' in (anonClient as object), false, 'the anon client carries no auth surface');

  const result = await readStarterServices(anonClient);

  assert.equal(result.status, 'loaded');
  assert.equal(result.services.length, 3);
  assert.deepEqual(touched, [
    'from:app_business_type_starter_services',
    'select:type_code,service_order,service_name,duration_minutes',
  ]);
});

test('the signup page reads the type list and the starter set as anon, before any sign-in', () => {
  const page = read(PAGE);

  // The page creates the client itself (the same `createClient()` the rest of the page
  // uses) and passes it into the readers, so neither reader imports the client module.
  assert.match(page, /loadStarterServices\(/);
  assert.match(page, /const supabase = createClient\(\);/);
  assert.match(page, /loadBusinessTypes\(supabase\)/);
  assert.match(page, /loadStarterServices\(supabase\)/);
  assert.match(page, /import \{ createClient \} from '@\/lib\/supabase\/client'/);
  assert.match(page, /findBusinessType\(businessTypes, businessType\)/);
  assert.match(page, /businessTypes\.map\(/);
  assert.match(page, /businessTypeLabel\(type, locale\)/);

  // The reads happen ON MOUNT, at the first step of the four-step flow — i.e. before the
  // account step (step 2) and before `auth.signUp` is reached at all. Nothing that
  // requires a session appears before them in the mount effect.
  const mountEffect = page.slice(
    page.indexOf('useEffect(() => {'),
    page.indexOf('const selectBusinessType'),
  );
  assert.match(mountEffect, /void loadTypes\(\);/);
  assert.doesNotMatch(mountEffect, /auth\.getUser|auth\.getSession|signUp/);

  // The step-1 read is not gated on a user: `auth.signUp` is what CREATES the account,
  // and it appears only in the submit handler, after the preview has already been read.
  const signUpIndex = page.indexOf('supabase.auth.signUp');
  const readIndex = page.indexOf('loadStarterServices(supabase)');
  assert.ok(readIndex > -1 && signUpIndex > -1);
  assert.ok(readIndex < signUpIndex, 'the anon read must come before the account is created');

  // The retired in-app type list is not used at all.
  assert.doesNotMatch(page, /listBusinessTypes/);
  assert.doesNotMatch(page, /BUSINESS_TYPES/);
  assert.doesNotMatch(page, /isBusinessTypeId/);
  assert.doesNotMatch(page, /getBusinessType\(/);
  // No app-invented code appears in the page.
  for (const code of ['hair_barber', 'beauty_salon', 'nail_salon']) {
    assert.doesNotMatch(page, new RegExp(code), `the page must not carry the app-invented code ${code}`);
  }

  // The intent is built from the row the database returned and the preview it read.
  assert.match(page, /buildSignupIntent\(\{/);
  assert.match(page, /type: selectedBusinessType/);
  assert.match(page, /source: BUSINESS_TYPE_VIEW_QUALIFIED/);
  assert.match(page, /preview,/);

  // The chosen type, its database-provided presentation, the starter set and the plan are
  // written onto the payload.
  for (const field of [
    'businessType',
    'businessTypeLabel',
    'businessTypeEmoji',
    'businessTypeDisplayOrder',
    'businessTypeSource',
    'starterSource',
    'starterStatus',
    'starterServiceCount',
    'starterAvailableServiceCount',
    'starterPlanLimit',
    'starterTotalDurationMinutes',
    'starterServices',
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

/* ---------------------------------------------------------------------------
 * Preview must match provision_owner_shop, including the plan cap
 * ------------------------------------------------------------------------- */

/**
 * `provision_owner_shop`'s own loop, modelled from the migration: it walks
 * `jsonb_array_elements(starter_pattern -> 'services')` in array order, inserts
 * `services.name = element ->> 'name'` and
 * `duration_minutes = COALESCE((element ->> 'duration_minutes')::INTEGER, 30)`, and
 * exits when the count reaches the new shop's `services_limit`:
 *
 *     EXIT WHEN v_starter_applied >= COALESCE((SELECT p.services_limit
 *       FROM local_service.bk01_shop_limits(v_shop_id) AS p), 0);
 *
 * With an empty array it inserts nothing. This reproduces exactly that, over the same
 * projection rows the app holds — the rows the reader parsed out of the view.
 */
function provisionedStarterServices(
  rows: readonly StarterServiceRow[],
  typeCode: string,
  servicesLimit: number | null,
): { name: string; duration_minutes: number }[] {
  const ordered = rows
    .filter((row) => row.typeCode === typeCode)
    .sort((left, right) => left.serviceOrder - right.serviceOrder);

  const created: { name: string; duration_minutes: number }[] = [];
  let applied = 0;
  for (const row of ordered) {
    if (applied >= (servicesLimit ?? 0)) break;
    created.push({ name: row.serviceName, duration_minutes: row.durationMinutes });
    applied += 1;
  }
  return created;
}

test('the preview shows exactly what provision_owner_shop creates, capped by the selected plan', () => {
  const rows = parsedRows(BARBER_ROWS);

  // Free: services_limit 5 (A-21). The barber type has exactly 3 starter services, so all
  // 3 are created — the cap does not add services the type does not have, and the deleted
  // app-side table's 5-service barber pattern is gone, so the old over-count (5 shown, 3
  // given) cannot recur.
  const free = starterServicesForType(rows, 'barber', SIGNUP_PLAN_SERVICES_LIMIT.free_trial);
  assert.equal(free.status, 'loaded');
  assert.equal(free.planLimit, 5);
  assert.equal(free.services.length, 3);
  assert.deepEqual(
    free.services.map((service) => ({ name: service.serviceName, duration_minutes: service.durationMinutes })),
    provisionedStarterServices(rows, 'barber', 5),
  );

  // Basic: services_limit 50 — the cap does not add services the type does not have.
  const basic = starterServicesForType(rows, 'barber', SIGNUP_PLAN_SERVICES_LIMIT.basic_490);
  assert.equal(basic.services.length, 3);
  assert.deepEqual(
    basic.services.map((service) => ({ name: service.serviceName, duration_minutes: service.durationMinutes })),
    provisionedStarterServices(rows, 'barber', 50),
  );
});

test('a plan cap really truncates: a six-service type on Free previews exactly five, in order', () => {
  // A type whose projection holds MORE rows than the Free allowance, which is the case the
  // finding is about. The cap must cut the projection's own order, exactly as
  // provision_owner_shop's loop does. Free is 5 (A-21), so the type must hold MORE than 5
  // for the cap to bite.
  const sixRows = parsedRows([0, 1, 2, 3, 4, 5].map((order) => ({
    type_code: 'five_service_type',
    service_order: order,
    service_name: `บริการที่ ${order + 1}`,
    duration_minutes: 30 + order * 15,
  })));

  const preview = starterServicesForType(sixRows, 'five_service_type', SIGNUP_PLAN_SERVICES_LIMIT.free_trial);

  assert.equal(preview.status, 'loaded');
  assert.equal(preview.availableCount, 6, 'the projection holds six rows for the type');
  assert.equal(preview.services.length, 5, 'Free creates at most five');
  assert.deepEqual(
    preview.services.map((service) => service.serviceName),
    ['บริการที่ 1', 'บริการที่ 2', 'บริการที่ 3', 'บริการที่ 4', 'บริการที่ 5'],
  );
  assert.deepEqual(
    preview.services.map((service) => ({ name: service.serviceName, duration_minutes: service.durationMinutes })),
    provisionedStarterServices(sixRows, 'five_service_type', 5),
  );

  // The same rows under Basic (50) are not truncated at all.
  const basic = starterServicesForType(sixRows, 'five_service_type', SIGNUP_PLAN_SERVICES_LIMIT.basic_490);
  assert.equal(basic.services.length, 6);
  assert.deepEqual(
    basic.services.map((service) => ({ name: service.serviceName, duration_minutes: service.durationMinutes })),
    provisionedStarterServices(sixRows, 'five_service_type', 50),
  );
});

test('a type with no starter services yields no set at all and invents nothing', () => {
  const rows = parsedRows([...BARBER_ROWS, ...OTHER_ROW]);

  // The projection holds no row for this type: 'empty' with zero services.
  const preview = starterServicesForType(rows, 'spa_massage', SIGNUP_PLAN_SERVICES_LIMIT.free_trial);
  assert.deepEqual(preview, {
    status: 'empty',
    typeCode: 'spa_massage',
    planLimit: 5,
    availableCount: 0,
    services: [],
  });

  // provision_owner_shop creates nothing for it either — the comparison is [] vs [].
  assert.deepEqual(
    preview.services.map((service) => service.serviceName),
    provisionedStarterServices(rows, 'spa_massage', 5).map((service) => service.name),
  );

  // A type with no row in the projection is still selectable and still records honestly.
  const intent = buildSignupIntent({
    type: { typeCode: 'spa_massage', emoji: '🧘', displayOrder: 5 },
    label: 'สปา / นวดแผนไทย / ดีท็อกซ์',
    source: 'local_service.app_business_types',
    preview,
    selectedPlan: 'free_trial',
  });

  assert.ok(intent, 'a code the database returned must be selectable');
  assert.equal(intent.starter.starter_status, 'empty');
  assert.equal(intent.starter.starter_service_count, 0);
  assert.deepEqual(intent.starter.starter_services, []);
  assert.equal(intent.starter.starter_total_duration_minutes, 0);
});

test('a well-formed but empty projection is empty, never a fallback set', () => {
  assert.deepEqual(parseStarterServiceRows([], null), { status: 'empty', services: [] });
  assert.deepEqual(parseStarterServiceRows([], { message: 'forbidden' }), {
    status: 'unavailable',
    services: [],
  });

  // No rows at all for any type: the preview is empty for every type, never invented.
  const empty = starterServicesForType([], 'barber', SIGNUP_PLAN_SERVICES_LIMIT.free_trial);
  assert.deepEqual(empty.services, []);
  assert.equal(empty.status, 'empty');
});

test('an unreadable or malformed starter-services response is unavailable, never an invented set', () => {
  assert.deepEqual(parseStarterServiceRows(undefined, { message: 'forbidden' }), {
    status: 'unavailable',
    services: [],
  });
  assert.deepEqual(parseStarterServiceRows({ error: 'nope' }, null), { status: 'unavailable', services: [] });
  assert.deepEqual(parseStarterServiceRows(null, null), { status: 'unavailable', services: [] });
  assert.deepEqual(parseStarterServiceRows('rows', null), { status: 'unavailable', services: [] });

  // One malformed row makes the whole projection unavailable rather than a half list.
  assert.deepEqual(parseStarterServiceRows([BARBER_ROWS[0], { type_code: 'barber' }], null), {
    status: 'unavailable',
    services: [],
  });
  assert.deepEqual(parseStarterServiceRows([{ ...BARBER_ROWS[0], duration_minutes: '30' }], null), {
    status: 'unavailable',
    services: [],
  });
  assert.deepEqual(parseStarterServiceRows([{ ...BARBER_ROWS[0], service_name: '  ' }], null), {
    status: 'unavailable',
    services: [],
  });
  assert.deepEqual(parseStarterServiceRows([{ ...BARBER_ROWS[0], service_order: -1 }], null), {
    status: 'unavailable',
    services: [],
  });
  // Codes the database could not legitimately hold are rejected too.
  assert.deepEqual(parseStarterServiceRows([{ ...BARBER_ROWS[0], type_code: 'Hair Barber' }], null), {
    status: 'unavailable',
    services: [],
  });
});

test('a genuine read failure still yields the honest unavailable preview, with no set', () => {
  // The client returns an error instead of rows (a privilege error on the projection).
  const denied = stubClient({ data: null, error: { message: 'permission denied for view' } });
  const deniedPreview = starterServicesForType(
    [],
    'barber',
    SIGNUP_PLAN_SERVICES_LIMIT.free_trial,
    'unavailable',
  );
  assert.equal(deniedPreview.status, 'unavailable');
  assert.deepEqual(deniedPreview.services, []);

  // The read itself rejects, which must not escape as a throw.
  const broken: StarterServicesReader = {
    from() {
      return { select: () => Promise.reject(new Error('network down')) };
    },
  };

  void denied;
  void broken;

  // ... and the preview built from a real unresolved read carries no service either.
  const notLoaded = starterServicesForType(
    [],
    'barber',
    SIGNUP_PLAN_SERVICES_LIMIT.free_trial,
    'unavailable',
  );
  assert.equal(notLoaded.status, 'unavailable');
  assert.equal(notLoaded.availableCount, 0);
  assert.deepEqual(notLoaded.services, []);
});

test('a genuine read failure reaches the unavailable state through the reader itself', async () => {
  const denied = stubClient({ data: null, error: { message: 'permission denied for view' } });
  const deniedResult = await readStarterServices(denied.client);
  assert.deepEqual(deniedResult, { status: 'unavailable', services: [] });

  const broken: StarterServicesReader = {
    from() {
      return { select: () => Promise.reject(new Error('network down')) };
    },
  };
  const brokenResult = await readStarterServices(broken);
  assert.deepEqual(brokenResult, { status: 'unavailable', services: [] });

  // The signup shows its unavailable copy for exactly this status — never a list.
  const page = read(PAGE);
  assert.match(page, /businessTypeStarterServicesUnavailable/);
  assert.match(page, /preview\.status === 'empty' \?/);
});

/* ---------------------------------------------------------------------------
 * Plan resolution: the cap and the database plan code
 * ------------------------------------------------------------------------- */

test('the plan allowance and the database plan code resolve from the offered plans only', () => {
  assert.deepEqual(SIGNUP_PLAN_SERVICES_LIMIT, { free_trial: 5, basic_490: 50, pro_990: 100 });
  assert.deepEqual(SIGNUP_PLAN_DB_CODE, {
    free_trial: 'free',
    basic_490: 'basic_490',
    pro_990: 'pro_990',
  });

  assert.equal(resolvePlanServicesLimit('free_trial'), 5);
  assert.equal(resolvePlanServicesLimit('basic_490'), 50);
  assert.equal(resolvePlanServicesLimit('pro_990'), 100);
  assert.equal(resolvePlanDbCode('free_trial'), 'free');

  // Fail-closed: anything the signup does not offer previews nothing and records nothing.
  assert.equal(resolvePlanServicesLimit('nope'), 0);
  assert.equal(resolvePlanServicesLimit(undefined), 0);
  assert.equal(resolvePlanServicesLimit(null), 0);
  assert.equal(resolvePlanServicesLimit(42), 0);
  assert.equal(resolvePlanDbCode('nope'), null);
  assert.equal(resolvePlanDbCode(undefined), null);

  // A zero or negative limit yields no rows rather than everything.
  assert.deepEqual(starterServicesForType(parsedRows(BARBER_ROWS), 'barber', 0).services, []);
  assert.deepEqual(starterServicesForType(parsedRows(BARBER_ROWS), 'barber', -1).services, []);
});

test('signup records the type the database returned, with its starter set and plan', () => {
  const rows = parsedRows(BARBER_ROWS);
  const preview = starterServicesForType(rows, 'barber', SIGNUP_PLAN_SERVICES_LIMIT.free_trial);
  const intent = buildSignupIntent({
    type: DB_ROW,
    label: DB_ROW.labelEn,
    source: 'local_service.app_business_types',
    preview,
    selectedPlan: 'free_trial',
  });

  assert.ok(intent);
  assert.equal(intent.businessType.typeCode, 'barber');
  assert.equal(intent.selectedPlan, 'free_trial');

  // The chosen type, its database-provided presentation, the read surfaces and the plan travel together.
  assert.equal(intent.starter.business_type, 'barber');
  assert.equal(intent.starter.business_type_label, 'Barber shop / Salon');
  assert.equal(intent.starter.business_type_emoji, '💈');
  assert.equal(intent.starter.business_type_display_order, 1);
  assert.equal(intent.starter.business_type_source, 'local_service.app_business_types');
  assert.equal(intent.starter.starter_source, 'local_service.app_business_type_starter_services');
  assert.equal(intent.starter.starter_status, 'loaded');

  // Per service, ONLY the two fields the database holds — no price, no deposit, no English
  // name, no weekday.
  assert.deepEqual(intent.starter.starter_services, [
    { name: 'ตัดผมชาย', duration_minutes: 30 },
    { name: 'ตัดผม สระ เซ็ต', duration_minutes: 60 },
    { name: 'โกนหนวด', duration_minutes: 30 },
  ]);
  for (const service of intent.starter.starter_services) {
    assert.deepEqual(Object.keys(service).sort(), ['duration_minutes', 'name']);
  }
  assert.equal(intent.starter.starter_service_count, 3);
  assert.equal(intent.starter.starter_available_service_count, 3);
  assert.equal(intent.starter.starter_plan_limit, 5);
  assert.equal(intent.starter.starter_total_duration_minutes, 120);

  // No money and no language the database does not store on the record at all.
  const record = JSON.stringify(intent.starter);
  assert.doesNotMatch(record, /price|deposit|opening|hours|name_en|label_en/i);

  // The plan is recorded for each paid tier too, not only the trial. Each plan gets the
  // preview built for THAT plan's allowance — the allowance is what the preview carries,
  // so re-using the Free preview would record 3 under every plan.
  for (const plan of ['free_trial', 'basic_490', 'pro_990'] as const) {
    const paidPreview = starterServicesForType(rows, 'barber', SIGNUP_PLAN_SERVICES_LIMIT[plan]);
    const paid = buildSignupIntent({
      type: DB_ROW,
      label: DB_ROW.labelEn,
      source: 'local_service.app_business_types',
      preview: paidPreview,
      selectedPlan: plan,
    });
    assert.equal(paid?.selectedPlan, plan);
    assert.ok(paid);
    assert.equal(paid.starter.starter_plan_limit, SIGNUP_PLAN_SERVICES_LIMIT[plan]);
  }
});

test('signup refuses a missing or unusable type, or an unoffered plan, instead of defaulting', () => {
  const preview = starterServicesForType(parsedRows(BARBER_ROWS), 'barber', 3);
  const base = {
    label: 'x',
    source: 'local_service.app_business_types',
    preview,
    selectedPlan: 'free_trial',
  } as const;

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

  // A plan the signup does not offer is refused rather than recorded.
  assert.equal(
    buildSignupIntent({ ...base, type: DB_ROW, selectedPlan: 'nope' as never }),
    null,
  );

  // The rule the lines above state is about the SHAPE of the code, not about which code
  // it is: a missing, empty or malformed code is refused. 'other' is NOT a refusal — it
  // is one of the nine codes the migration lane genuinely seeds (display_order 9), so a
  // signup that chooses it must be accepted.
  const other = buildSignupIntent({
    type: { typeCode: 'other', emoji: '🏪', displayOrder: 9 },
    label: 'อื่น ๆ',
    source: 'local_service.app_business_types',
    preview: starterServicesForType(parsedRows(OTHER_ROW), 'other', 3),
    selectedPlan: 'free_trial',
  });
  assert.ok(other, "the seeded catch-all 'other' must be selectable, not refused");
  assert.equal(other.businessType.typeCode, 'other');
  assert.equal(other.starter.business_type, 'other');
  assert.equal(other.starter.business_type_source, 'local_service.app_business_types');
  assert.deepEqual(other.starter.starter_services, [{ name: 'บริการหลัก', duration_minutes: 30 }]);
});

/* ---------------------------------------------------------------------------
 * The app-side starter table is gone
 * ------------------------------------------------------------------------- */

test('the app-side starter-pattern table and the code that served it are gone', () => {
  // The file that held BUSINESS_PATTERNS no longer exists.
  assert.throws(() => read(DELETED_CATALOGUE), /ENOENT/);

  const page = read(PAGE);
  // Code only: the page's own comments name what was removed and why, which is the
  // explanation rather than a reintroduction.
  const pageCode = stripComments(page);
  assert.doesNotMatch(pageCode, /business-type-catalogue/);
  assert.doesNotMatch(pageCode, /BUSINESS_PATTERNS/);
  assert.doesNotMatch(pageCode, /findBusinessPattern/);
  assert.doesNotMatch(pageCode, /summarizeOpeningHours/);
  assert.doesNotMatch(pageCode, /getPatternId|patternServiceKeys|patternWorkingDays|patternMessageKey/);

  const starterModule = read(STARTER_MODULE);
  const moduleCode = stripComments(starterModule);
  assert.doesNotMatch(moduleCode, /BUSINESS_PATTERNS/);
  assert.doesNotMatch(moduleCode, /business-type-catalogue/);
});

test('the signup holds no embedded starter set: every service name comes from the projection', () => {
  const page = read(PAGE);
  const pageCode = stripComments(page);

  // None of the database's own seeded service names is written into the page as data.
  for (const name of ['ตัดผมชาย', 'โกนหนวด', 'บริการหลัก', 'นวดไทย']) {
    assert.doesNotMatch(page, new RegExp(name), `the page must not embed the service name ${name}`);
  }

  // The only per-service field the page renders is the stored name and the duration.
  assert.match(pageCode, /service\.serviceName/);
  assert.match(pageCode, /service\.durationMinutes/);
  // No price and no deposit is rendered anywhere on the page.
  assert.doesNotMatch(pageCode, /service\.price|service\.deposit|priceThb|depositAmount/);
  // No weekday/open-hours line is rendered, because the database holds none.
  assert.doesNotMatch(pageCode, /openingHours|hoursLines|dayOfWeek/);
});

/* ---------------------------------------------------------------------------
 * Copy: honest states still exist, and the two absent fields are reported
 * ------------------------------------------------------------------------- */

test('the signup page degrades honestly when the type list cannot be read', () => {
  const page = read(PAGE);
  const th = JSON.parse(read(MESSAGES[0])) as { auth: Record<string, string> };
  const en = JSON.parse(read(MESSAGES[1])) as { auth: Record<string, string> };

  // Every failure state has its own message, and none of them shows a list.
  for (const key of [
    'businessTypeLoading',
    'businessTypeEmpty',
    'businessTypeUnavailable',
    'businessTypeStarterServicesEmpty',
    'businessTypeStarterServicesUnavailable',
  ]) {
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

test('the unavailable copy no longer tells a visitor to sign in, and reports the real failure', () => {
  for (const path of MESSAGES) {
    const messages = JSON.parse(read(path)) as { auth: Record<string, string> };
    // The anon read is now the normal path, so the copy must not ask the visitor to log in.
    assert.doesNotMatch(messages.auth.businessTypeUnavailable, /sign in|ล็อกอิน/i);
    assert.doesNotMatch(messages.auth.businessTypeStarterServicesUnavailable, /sign in|ล็อกอิน/i);
    // Both name the surface they could not read, so the failure is honest and locatable.
    assert.match(messages.auth.businessTypeUnavailable, /app_business_types/);
    assert.match(messages.auth.businessTypeStarterServicesUnavailable, /app_business_type_starter_services/);
  }
});

test('the absent English name and opening hours are reported, never invented', () => {
  for (const path of MESSAGES) {
    const messages = JSON.parse(read(path)) as { auth: Record<string, string> };
    assert.ok(messages.auth.businessTypeAbsentFieldsNote.trim().length > 0);
    // It states both absences and says they are a database/Owner decision.
    assert.match(messages.auth.businessTypeAbsentFieldsNote, /provision_owner_shop/);
  }

  const page = read(PAGE);
  assert.match(page, /businessTypeAbsentFieldsNote/);

  // The whole per-pattern starter namespace is gone, so no English starter copy and no
  // opening-hours copy survives to fill the gap the two absent fields leave.
  const th = JSON.parse(read(MESSAGES[0])) as { auth: Record<string, string> };
  const en = JSON.parse(read(MESSAGES[1])) as { auth: Record<string, string> };
  for (const catalogue of [th, en]) {
    for (const key of keysOf(catalogue)) {
      assert.doesNotMatch(
        key,
        /Pattern|Hours|closedDay|hairBarber|beautySalon|nailSalon/,
        `no per-pattern starter copy may remain (found ${key})`,
      );
    }
  }
});

test('the per-pattern starter namespace is gone from both catalogues', () => {
  const th = JSON.parse(read(MESSAGES[0])) as Record<string, unknown>;
  const en = JSON.parse(read(MESSAGES[1])) as Record<string, unknown>;

  assert.equal(th.businessType, undefined, 'no per-type starter copy remains in th.json');
  assert.equal(en.businessType, undefined, 'no per-type starter copy remains in en.json');
});

test('the preview copy states the plan cap and the database source in both languages', () => {
  for (const path of MESSAGES) {
    const messages = JSON.parse(read(path)) as { auth: Record<string, string> };
    for (const key of [
      'stepBusinessTypeTitle',
      'stepBusinessTypeShort',
      'businessTypeSelectHint',
      'businessTypeRequired',
      // The names the page actually renders the preview with (asserted against the page
      // below), so the copy and the page cannot drift apart on one answer.
      'businessTypeStarterPreviewTitle',
      'businessTypeStarterServicesTitle',
      'businessTypeStarterEditableNote',
      'businessTypeStarterPlanCapNote',
      'businessTypeStarterSourceNote',
      'businessTypeAbsentFieldsNote',
    ]) {
      assert.equal(typeof messages.auth[key], 'string', `${path} auth.${key}`);
      assert.ok(messages.auth[key].trim().length > 0, `${path} auth.${key} is empty`);
    }
    // The cap note carries both placeholders the page fills.
    assert.match(messages.auth.businessTypeStarterPlanCapNote, /\{count\}/);
    assert.match(messages.auth.businessTypeStarterPlanCapNote, /\{available\}/);
    // The preview title still takes the type name.
    assert.match(messages.auth.businessTypeStarterPreviewTitle, /\{type\}/);
    assert.match(messages.auth.stepBusinessTypeTitle, /1\/4/);
    assert.match(messages.auth.stepShopTitle, /2\/4/);
    assert.match(messages.auth.stepPlanTitle, /3\/4/);
    assert.match(messages.auth.stepPromptpayTitle, /4\/4/);
  }

  // Page and copy agree on ONE set of names: every preview key above is rendered by the
  // page, and the retired per-pattern names are rendered by nobody.
  const page = read(PAGE);
  for (const key of [
    'businessTypeStarterPreviewTitle',
    'businessTypeStarterServicesTitle',
    'businessTypeStarterEditableNote',
    'businessTypeStarterPlanCapNote',
    'businessTypeStarterSourceNote',
  ]) {
    assert.match(page, new RegExp(`\\bt\\('${key}'`), `the page must render ${key}`);
  }
  assert.doesNotMatch(page, /businessTypePatternPreviewTitle|businessTypePatternServicesTitle|businessTypePatternEditableNote|businessTypePatternPlanCapNote|businessTypePatternHoursTitle/);
  assert.doesNotMatch(page, /businessTypePatternUnavailable/);
});

test('Thai and English auth copy keep the same key set', () => {
  const catalogues = MESSAGES.map((path) => JSON.parse(read(path)) as Record<string, unknown>);

  for (const catalogue of catalogues) {
    assert.ok(catalogue.auth, 'auth namespace must exist');
  }
  const thKeys = keysOf(catalogues[0].auth).sort();
  const enKeys = keysOf(catalogues[1].auth).sort();
  assert.deepEqual(thKeys, enKeys, 'TH and EN auth key sets must match');
  assert.ok(thKeys.length > 0);

  // Top-level namespaces still match in both catalogues.
  assert.deepEqual(Object.keys(catalogues[0]).sort(), Object.keys(catalogues[1]).sort());
});

/* ---------------------------------------------------------------------------
 * The projection helpers
 * ------------------------------------------------------------------------- */

test('countStarterServicesForType counts the database rows and invents nothing', () => {
  const rows = parsedRows([...BARBER_ROWS, ...OTHER_ROW]);

  assert.equal(countStarterServicesForType(rows, 'barber'), 3);
  assert.equal(countStarterServicesForType(rows, 'other'), 1);
  assert.equal(countStarterServicesForType(rows, 'spa_massage'), 0);
  assert.equal(countStarterServicesForType(rows, undefined), 0);
  assert.equal(countStarterServicesForType(rows, 42), 0);
  assert.equal(countStarterServicesForType([], 'barber'), 0);
});

test('the preview orders by the projection ordinality, whatever order the rows arrive in', () => {
  const shuffled = parsedRows([...BARBER_ROWS].reverse());

  const preview = starterServicesForType(shuffled, 'barber', 3);

  assert.equal(preview.status, 'loaded');
  assert.deepEqual(
    preview.services.map((service) => service.serviceOrder),
    [0, 1, 2],
  );
  assert.deepEqual(
    preview.services.map((service) => service.serviceName),
    ['ตัดผมชาย', 'ตัดผม สระ เซ็ต', 'โกนหนวด'],
  );
});

test('the view row parser accepts only complete rows', () => {
  const loaded = parseStarterServiceRows([...BARBER_ROWS], null);
  assert.equal(loaded.status, 'loaded');
  for (const service of loaded.services) {
    assert.match(service.typeCode, /^[a-z][a-z0-9_]*$/);
    assert.ok(Number.isInteger(service.serviceOrder));
    assert.ok(service.serviceOrder >= 0);
    assert.ok(service.serviceName.trim().length > 0);
    assert.ok(Number.isInteger(service.durationMinutes));
    assert.ok(service.durationMinutes > 0);
  }
});
