/**
 * The signup's starter-services preview, read from the database view
 * `local_service.app_business_type_starter_services` (review finding F-13).
 *
 * WHY THIS MODULE EXISTS. Until F-13 the preview came from `BUSINESS_PATTERNS`, a
 * table of starter services hardcoded in the app (`./business-type-catalogue.ts`),
 * while `provision_owner_shop` built a new shop's real services from
 * `business_types.starter_pattern` in the database. The customer was shown one set and
 * given another — the app's barber pattern offered five services while the Free plan
 * allows three. `BUSINESS_PATTERNS` and the code that existed only to serve it are
 * therefore DELETED, and this module reads the same data the provisioning function
 * consumes.
 *
 * THE READ SURFACE. One VIEW, named by the migration lane:
 *
 *     local_service.app_business_type_starter_services
 *     columns: type_code, service_order, service_name, duration_minutes
 *
 * It is sourced from `business_types.starter_pattern -> 'services'` walked with
 * `jsonb_array_elements`, in JSON array order, restricted to active types, and ordered
 * `display_order ASC, type_code ASC, ordinality ASC`. It is granted to `anon`, because
 * the signup reads it BEFORE any account exists.
 *
 * The columns selected here are exactly those four and nothing else — in particular no
 * `price`, no `deposit_amount`, no `staff_role_label` and not the raw
 * `starter_pattern` JSONB column. `STARTER_SERVICES_COLUMNS` is the only column list
 * this module can send, and `tests/signup-business-type.test.ts` pins it, so the price
 * and deposit values the seed happens to carry cannot reach the preview.
 *
 * WHAT THE DATA REALLY HOLDS, stated rather than filled in. The seeded
 * `starter_pattern` carries, per service, a single Thai service NAME and a duration in
 * minutes. There is NO English service name and NO opening-hours data anywhere in the
 * seed, and `provision_owner_shop` creates no opening hours. So this module carries no
 * per-language starter copy, no weekday data and no fallback for either: it shows the
 * service name exactly as stored, and its duration. The absence of those two fields is
 * a database/Owner decision, reported in the signup copy and in
 * `docs/house-swarm-1/WUD-UI-TYPES.md` — not something the app may invent.
 *
 * DURATIONS ARE NOT RE-VALIDATED BEYOND THE DATABASE'S OWN CONTRACT. The removed app
 * table required whole minutes in multiples of 15; that was a rule about the app's own
 * placeholders. The database imposes no such rule on `starter_pattern` or
 * `services.duration_minutes`, so this module accepts any positive whole number of
 * minutes and never rejects a row the database legitimately holds.
 *
 * THE CLIENT IS A PARAMETER, NEVER AN IMPORT: this module has no import statement at
 * all, for the reason recorded in `./business-type-view.ts` — the node test runner
 * loads these files as real ESM, where an extensionless specifier does not resolve,
 * and an explicit `.ts` specifier is rejected by the app's `moduleResolution: bundler`.
 * The signup page creates the client (`lib/supabase/client.ts`, default schema
 * `local_service`) and passes it in.
 *
 * Honest degradation: a client error, a rejected read, a non-array response or ANY
 * malformed row makes the list `unavailable` with zero rows; a well-formed response
 * with no row for the selected type is `empty` with zero rows. Both are reported to
 * the visitor. There is no embedded starter set to fall back to, by construction.
 */

/** The view name inside the client's default schema. */
export const STARTER_SERVICES_VIEW = 'app_business_type_starter_services';

/** The fully qualified read surface, as the migration names it. */
export const STARTER_SERVICES_VIEW_QUALIFIED =
  'local_service.app_business_type_starter_services';

/**
 * Exactly the view's four columns, in the view's order. No other column is selected:
 * the price, the deposit amount and the staff role label are in the seed and are
 * deliberately not part of this projection or of this read.
 */
export const STARTER_SERVICES_COLUMNS =
  'type_code,service_order,service_name,duration_minutes' as const;

/**
 * The shape of the one read this module makes, so it can be exercised without a
 * browser or a network. Structurally satisfied by the app's Supabase client. The
 * reader needs no session, no cookie and no user: an anonymous visitor is its normal
 * caller.
 */
export interface StarterServicesReader {
  from(relation: string): {
    select(columns: string): PromiseLike<{ data: unknown; error: unknown }>;
  };
}

/** One row of the projection, as the view returns it. */
export interface StarterServiceRow {
  /** `app_business_type_starter_services.type_code` — the code the database owns. */
  typeCode: string;
  /** `service_order` — the position in the type's `starter_pattern` JSON array. */
  serviceOrder: number;
  /** `service_name` — the STORED name (Thai today), shown exactly as stored. */
  serviceName: string;
  /** `duration_minutes` — the stored duration, defaulted by the view exactly as `provision_owner_shop` defaults it. */
  durationMinutes: number;
}

export type StarterServiceListStatus = 'loaded' | 'empty' | 'unavailable';

export interface StarterServiceListResult {
  status: StarterServiceListStatus;
  /** Empty unless `status` is `loaded`; never an invented row. */
  services: readonly StarterServiceRow[];
}

/** The plan identifiers the signup offers. */
export type SignupPlanId = 'free_trial' | 'basic_490' | 'pro_990';

/**
 * The database plan code a signup plan resolves to: the free trial is the free plan's
 * entitlements (an expired trial falls back to free, it never closes the shop), and
 * the two paid tiers keep their own codes.
 */
export const SIGNUP_PLAN_DB_CODE: Readonly<Record<SignupPlanId, string>> = {
  free_trial: 'free',
  basic_490: 'basic_490',
  pro_990: 'pro_990',
};

/**
 * The service allowance `provision_owner_shop` caps the starter set at, per plan.
 *
 * These three numbers are MIRRORS of `local_service.entitlement_plans.services_limit`
 * as seeded by the migration lane — `free` reads **5** (Owner decision A-21 of
 * 2026-10-01 raised it from 3, and the P0 SQL set — finding G34 / X7 — makes the
 * database agree), `basic_490` 50, `pro_990` 100 (Pro is not
 * sold; its 100 is the unapproved C2 proposal marked *). The mirror exists only because
 * the signup reads the preview as `anon` and the database exposes NO anon-readable
 * plan-limit surface: `entitlement_plans` is restricted to the privileged database role, `get_tier_limits` is
 * `authenticated` only and does not return `services_limit`, and `bk01_shop_limits` is
 * a per-shop privileged database function. An anon-readable plan-cap surface is a
 * database/Owner decision; until it exists, a change to `services_limit` must be
 * mirrored here, and that coupling is recorded in
 * `docs/house-swarm-1/WUD-UI-TYPES.md`.
 *
 * The mirror follows the CONTRACT the shop is sold on, and the SQL set that makes the
 * database agree is part of the same release candidate (brief 28 §5: the SQL and the
 * app merge together, never one without the other). `tests/ui-truth.test.ts` pins
 * both numbers so they cannot drift apart silently.
 */
export const SIGNUP_PLAN_SERVICES_LIMIT: Readonly<Record<SignupPlanId, number>> = {
  free_trial: 5,
  basic_490: 50,
  pro_990: 100,
};

/**
 * The service allowance for `plan`, or 0 when the plan is not one the signup offers.
 * 0 is the fail-closed direction: an unknown plan previews nothing rather than
 * everything.
 */
export function resolvePlanServicesLimit(plan: unknown): number {
  return typeof plan === 'string' && Object.prototype.hasOwnProperty.call(SIGNUP_PLAN_SERVICES_LIMIT, plan)
    ? SIGNUP_PLAN_SERVICES_LIMIT[plan as SignupPlanId]
    : 0;
}

/** The database plan code for `plan`, or null when the plan is not one the signup offers. */
export function resolvePlanDbCode(plan: unknown): string | null {
  return typeof plan === 'string' && Object.prototype.hasOwnProperty.call(SIGNUP_PLAN_DB_CODE, plan)
    ? SIGNUP_PLAN_DB_CODE[plan as SignupPlanId]
    : null;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Parses one projection row. Returns null for anything that is not a complete row, so a
 * malformed response is reported instead of being rendered as a service.
 */
function parseStarterServiceRow(row: unknown): StarterServiceRow | null {
  if (!row || typeof row !== 'object') return null;

  const {
    type_code: typeCode,
    service_order: serviceOrder,
    service_name: serviceName,
    duration_minutes: durationMinutes,
  } = row as Record<string, unknown>;

  if (!isNonEmptyText(typeCode) || !/^[a-z][a-z0-9_]*$/.test(typeCode)) return null;
  if (!Number.isInteger(serviceOrder) || (serviceOrder as number) < 0) return null;
  if (!isNonEmptyText(serviceName)) return null;
  if (!Number.isInteger(durationMinutes) || (durationMinutes as number) <= 0) return null;

  return {
    typeCode,
    serviceOrder: serviceOrder as number,
    serviceName,
    durationMinutes: durationMinutes as number,
  };
}

/**
 * Turns a raw projection response into the list result. All-or-nothing: one malformed
 * row makes the whole list `unavailable`, because a half-parsed list would be a broken
 * list. Never called with anything but the projection's rows.
 */
export function parseStarterServiceRows(data: unknown, error: unknown): StarterServiceListResult {
  if (error || !Array.isArray(data)) return { status: 'unavailable', services: [] };
  if (data.length === 0) return { status: 'empty', services: [] };

  const services: StarterServiceRow[] = [];
  for (const row of data) {
    const parsed = parseStarterServiceRow(row);
    if (!parsed) return { status: 'unavailable', services: [] };
    services.push(parsed);
  }

  return { status: 'loaded', services };
}

/**
 * The one read in this module: the four columns, from the projection, nothing else.
 * Both a promise rejection and a returned `error` become `unavailable`, never a throw
 * the signup would have to catch. No session, no cookie and no user is involved.
 */
export async function readStarterServices(
  client: StarterServicesReader,
): Promise<StarterServiceListResult> {
  let data: unknown;
  let error: unknown;

  try {
    ({ data, error } = await client.from(STARTER_SERVICES_VIEW).select(STARTER_SERVICES_COLUMNS));
  } catch (clientError) {
    error = clientError;
  }

  return parseStarterServiceRows(data, error);
}

/**
 * The read the signup calls, with the client the caller supplies. The ready-made client
 * is `createClient()` from `lib/supabase/client.ts`; the signup page creates it and
 * passes it, so this module has no module-scope specifier to resolve and stays
 * testable without a browser or a network.
 */
export async function loadStarterServices(
  client: StarterServicesReader,
): Promise<StarterServiceListResult> {
  return readStarterServices(client);
}

/** How many starter-service rows the projection holds for `typeCode`. */
export function countStarterServicesForType(
  services: readonly StarterServiceRow[],
  typeCode: unknown,
): number {
  return typeof typeCode === 'string'
    ? services.filter((service) => service.typeCode === typeCode).length
    : 0;
}

export type StarterServicesPreviewStatus = 'loaded' | 'empty' | 'unavailable';

/**
 * What the signup previews for one business type on one plan.
 *
 * `services` is the set `provision_owner_shop` would create: the projection's rows for
 * this type, in the projection's own order (its `service_order`, which is the JSON
 * array position the provisioning loop walks), cut to at most `planLimit` rows. A type
 * the projection holds no row for is `empty` with zero services — no fallback set and
 * no invented service.
 */
export interface StarterServicesPreview {
  status: StarterServicesPreviewStatus;
  typeCode: string;
  /** The service allowance applied, as `SIGNUP_PLAN_SERVICES_LIMIT` holds it for the plan. */
  planLimit: number;
  /** Rows the projection holds for this type (0 when the type is unknown or the read failed). */
  availableCount: number;
  /** The capped set, in the projection's own order. Never a fabricated row. */
  services: readonly StarterServiceRow[];
}

/**
 * `provision_owner_shop` applies a type's starter services in the order the JSON array
 * holds them and stops at the plan's allowance. That is this function: filter the
 * projection's rows to the type, order them by `service_order` (the projection already
 * returns them in that order — ordering by it explicitly keeps the two in step if a
 * client ever returns them unordered), then take at most `planLimit`.
 *
 * A negative or non-integer `planLimit` yields no rows, which is the fail-closed
 * direction.
 */
export function starterServicesForType(
  services: readonly StarterServiceRow[],
  typeCode: unknown,
  planLimit: number,
  status: StarterServiceListStatus = 'loaded',
): StarterServicesPreview {
  const resolvedTypeCode = typeof typeCode === 'string' ? typeCode : '';

  if (status !== 'loaded') {
    return { status, typeCode: resolvedTypeCode, planLimit, availableCount: 0, services: [] };
  }

  const forType = services
    .filter((service) => service.typeCode === resolvedTypeCode)
    .sort((left, right) => left.serviceOrder - right.serviceOrder);

  if (forType.length === 0) {
    return { status: 'empty', typeCode: resolvedTypeCode, planLimit, availableCount: 0, services: [] };
  }

  const limit = Number.isInteger(planLimit) && planLimit > 0 ? planLimit : 0;

  return {
    status: 'loaded',
    typeCode: resolvedTypeCode,
    planLimit,
    availableCount: forType.length,
    services: forType.slice(0, limit),
  };
}

/* ---------------------------------------------------------------------------
 * Signup intent
 *
 * What the BK01 signup records about the chosen business type, the starter services the
 * database says the shop will be created with, and the selected plan. Kept here, beside
 * the projection it is built from, so the signup has exactly one dependency-free source
 * of truth and so it is unit-testable without a browser or a bundler.
 *
 * The type fields are the values `local_service.app_business_types` returned for the
 * chosen code. The starter fields are the values
 * `local_service.app_business_type_starter_services` returned, capped by the plan's
 * allowance — the set `provision_owner_shop` would create. Nothing here is money and
 * nothing here is a language the database does not store: per starter service the only
 * two fields recorded are the STORED name and the duration, exactly as the projection
 * returns them.
 *
 * Persisting the starter set to real services/opening hours is `provision_owner_shop`'s
 * job at signup; this record only describes it.
 * ------------------------------------------------------------------------- */

/**
 * The part of a type-list row the signup intent records. Structurally satisfied by
 * `BusinessTypeListItem` from `./business-type-view.ts`, so the intent can be built
 * from a row the database returned without this module importing anything.
 */
export interface SignupBusinessType {
  /** The code the database owns. */
  typeCode: string;
  emoji: string;
  displayOrder: number;
}

/**
 * One starter service as the database holds it. TWO fields and no more: the stored name
 * (Thai today — there is no `name_en` in the seed) and the duration in minutes. The
 * `price` and `deposit_amount` the seed also carries are NOT recorded, because they are
 * not an Owner decision and are not part of the projection this module reads.
 */
export interface SignupStarterService {
  /** `app_business_type_starter_services.service_name`, shown exactly as stored. */
  name: string;
  /** `app_business_type_starter_services.duration_minutes`. */
  duration_minutes: number;
}

/**
 * The starter-set record for the chosen type and plan. Keys are stable snake_case so a
 * future server/analytics write can consume them unchanged.
 */
export interface SignupStarterSelection {
  business_type: string;
  business_type_label: string;
  business_type_emoji: string;
  business_type_display_order: number;
  /** The read surface the type row came from, e.g. `local_service.app_business_types`. */
  business_type_source: string;
  /** The read surface the starter set came from. */
  starter_source: string;
  /** `loaded`, `empty` (the type has no starter service) or `unavailable` (the read failed). */
  starter_status: StarterServicesPreviewStatus;
  /** Services `provision_owner_shop` would create for this plan — the capped count. */
  starter_service_count: number;
  /** Services the projection holds for the type, before the plan's cap. */
  starter_available_service_count: number;
  /** The cap applied, as `SIGNUP_PLAN_SERVICES_LIMIT` holds it for the plan. */
  starter_plan_limit: number;
  /** Sum of the recorded durations; 0 when the preview is not loaded. */
  starter_total_duration_minutes: number;
  /** The capped set, in the projection's own order, with only the two stored fields. */
  starter_services: SignupStarterService[];
}

export interface SignupIntentInput {
  /** The row the database view returned for the chosen code. */
  type: SignupBusinessType | null | undefined;
  /** The type's label in the active locale, as returned by the type view. */
  label: string;
  /** The read surface the type row came from. */
  source: string;
  /** The preview built from the starter-services projection for the selected plan. */
  preview: StarterServicesPreview;
  selectedPlan: SignupPlanId;
}

export interface SignupIntent {
  businessType: SignupBusinessType;
  starter: SignupStarterSelection;
  selectedPlan: SignupPlanId;
}

/**
 * Builds the signup intent for a chosen type row and its preview. Returns null when
 * there is no valid type, or when the plan is not one the signup offers — the signup
 * must have a code the database returned and a plan the database knows rather than
 * guess either.
 *
 * A type the projection holds no starter service for is ACCEPTED: the record says
 * `starter_status: 'empty'` with zero services, which is exactly what
 * `provision_owner_shop` would create for it. Nothing is invented to fill the gap.
 */
export function buildSignupIntent({
  type,
  label,
  source,
  preview,
  selectedPlan,
}: SignupIntentInput): SignupIntent | null {
  if (!type || typeof type.typeCode !== 'string' || !/^[a-z][a-z0-9_]*$/.test(type.typeCode)) {
    return null;
  }

  if (!resolvePlanDbCode(selectedPlan)) return null;

  const starterServices: SignupStarterService[] = preview.status === 'loaded'
    ? preview.services.map((service) => ({
      name: service.serviceName,
      duration_minutes: service.durationMinutes,
    }))
    : [];

  return {
    businessType: type,
    starter: {
      business_type: type.typeCode,
      business_type_label: label,
      business_type_emoji: type.emoji,
      business_type_display_order: type.displayOrder,
      business_type_source: source,
      starter_source: STARTER_SERVICES_VIEW_QUALIFIED,
      starter_status: preview.status,
      starter_service_count: starterServices.length,
      starter_available_service_count: preview.availableCount,
      starter_plan_limit: preview.planLimit,
      starter_total_duration_minutes: starterServices.reduce(
        (total, service) => total + service.duration_minutes,
        0,
      ),
      starter_services: starterServices,
    },
    selectedPlan,
  };
}
