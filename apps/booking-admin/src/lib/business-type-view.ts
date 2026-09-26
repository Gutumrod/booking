/**
 * The signup's business-type list, read from the database (review finding N-4,
 * Addendum D: the database is the single source of type codes).
 *
 * This module holds NO list of type codes. It reads the view
 * `local_service.app_business_types` — defined in the migration lane at
 * `supabase/bk01-migrations/20260926120000_bk01_entitlement_packs.sql` (view
 * definition around line 327) — through a Supabase client the caller injects. That
 * client's default schema is already `local_service` (`lib/supabase/client.ts`,
 * `db: { schema: 'local_service' }`). It selects the view's five columns and nothing
 * else, and returns them as `BusinessTypeListItem` rows:
 *
 *     type_code TEXT · emoji TEXT · label_th TEXT · label_en TEXT · display_order INTEGER
 *
 * The client is a PARAMETER, never an import: this module does not import
 * `lib/supabase/client.ts`. The node test runner loads these files as real ESM, where an
 * extensionless specifier does not resolve, and an explicit `.ts` specifier is rejected
 * by the app's `moduleResolution: bundler` without `allowImportingTsExtensions`. The
 * signup page imports the client itself and passes it in.
 *
 * The view already returns only the active types, ordered by `display_order` then
 * `type_code`, so the app neither filters nor re-sorts and cannot disagree with the
 * seeded codes.
 *
 * The only mapping kept in code is `BUSINESS_TYPE_LABEL_COLUMN`: which stored label
 * column is shown for each locale. It is documented in
 * `docs/house-swarm-1/WUD-UI-TYPES.md`.
 *
 * Honest degradation: when the list cannot be read (no client configuration, a
 * privilege error, a malformed row, a response that is not an array) the result is
 * `unavailable`; a well-formed but empty view is `empty`. Both carry zero rows. The
 * module never falls back to an embedded list — inventing codes here is exactly the
 * drift N-4 removed — and the signup shows the explanatory state instead.
 *
 * The view is granted to `authenticated` only (anon is deliberately not granted), so
 * an anonymous visitor sees the explanatory state rather than a list.
 */

/** The view name inside the client's default schema. */
export const BUSINESS_TYPE_VIEW = 'app_business_types';

/** The fully qualified read surface, as the migration names it. */
export const BUSINESS_TYPE_VIEW_QUALIFIED = 'local_service.app_business_types';

/** Exactly the view's columns, in the view's order. No other column is selected. */
export const BUSINESS_TYPE_COLUMNS = 'type_code,emoji,label_th,label_en,display_order' as const;

/**
 * The shape of the one read this module makes, so it can be exercised without a
 * browser or a network. `readBusinessTypes` is bound to it below.
 */
export interface BusinessTypeReader {
  from(relation: string): {
    select(columns: string): PromiseLike<{ data: unknown; error: unknown }>;
  };
}

/**
 * The only read in this module: the five columns, from the view, nothing else. Both
 * the promise rejection and the returned `error` become `unavailable`, never a throw
 * the signup would have to catch.
 */
export async function readBusinessTypes(client: BusinessTypeReader): Promise<BusinessTypeListResult> {
  let data: unknown;
  let error: unknown;

  try {
    ({ data, error } = await client.from(BUSINESS_TYPE_VIEW).select(BUSINESS_TYPE_COLUMNS));
  } catch (clientError) {
    error = clientError;
  }

  return parseBusinessTypeRows(data, error);
}

/**
 * The read the signup calls, with the client the caller supplies. The client is passed
 * in rather than imported here, so this module has no module-scope specifier to resolve
 * (see the module note above) and stays testable without a browser or a network. The
 * ready-made client is `createClient()` from `lib/supabase/client.ts`; the signup page
 * creates it and passes it. The tests exercise `readBusinessTypes` directly with a stub.
 */
export async function loadBusinessTypes(client: BusinessTypeReader): Promise<BusinessTypeListResult> {
  return readBusinessTypes(client);
}

/**
 * The one mapping that remains in the app: the active locale to the stored label
 * column that locale is shown from. The view stores both languages; nothing else
 * about a type is mapped in code.
 */
export const BUSINESS_TYPE_LABEL_COLUMN = {
  th: 'label_th',
  en: 'label_en',
} as const;

export type BusinessTypeLabelLocale = keyof typeof BUSINESS_TYPE_LABEL_COLUMN;

/** Reads each mapped label column off a view row. The mapping's only consumers. */
const LABEL_READER: Readonly<Record<BusinessTypeLabelLocale, (item: BusinessTypeListItem) => string>> = {
  th: (item) => item.labelTh,
  en: (item) => item.labelEn,
};

export interface BusinessTypeListItem {
  /** `app_business_types.type_code` — the code the database owns. */
  typeCode: string;
  /** `app_business_types.emoji`. */
  emoji: string;
  /** `app_business_types.label_th`. */
  labelTh: string;
  /** `app_business_types.label_en`. */
  labelEn: string;
  /** `app_business_types.display_order`, as returned by the view's ordering. */
  displayOrder: number;
}

/** Normalises an app locale to one the mapping covers; anything but `en` is `th`. */
export function resolveBusinessTypeLabelLocale(locale: unknown): BusinessTypeLabelLocale {
  return typeof locale === 'string' && locale in BUSINESS_TYPE_LABEL_COLUMN
    ? (locale as BusinessTypeLabelLocale)
    : 'th';
}

/** The label to display for `locale`, from the stored column that locale maps to. */
export function businessTypeLabel(item: BusinessTypeListItem, locale: unknown): string {
  return LABEL_READER[resolveBusinessTypeLabelLocale(locale)](item);
}

export type BusinessTypeListStatus = 'loaded' | 'empty' | 'unavailable';

export interface BusinessTypeListResult {
  status: BusinessTypeListStatus;
  /** Empty unless `status` is `loaded`; never an invented row. */
  types: readonly BusinessTypeListItem[];
}

function withoutTypes(status: 'empty' | 'unavailable'): BusinessTypeListResult {
  return { status, types: [] };
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Parses one view row. Returns null for anything that is not a complete row, so a
 * malformed response is reported instead of being rendered as a type.
 */
function parseBusinessTypeRow(row: unknown): BusinessTypeListItem | null {
  if (!row || typeof row !== 'object') return null;

  const {
    type_code: typeCode,
    emoji,
    label_th: labelTh,
    label_en: labelEn,
    display_order: displayOrder,
  } = row as Record<string, unknown>;

  if (!isNonEmptyText(typeCode) || !/^[a-z][a-z0-9_]*$/.test(typeCode)) return null;
  if (!isNonEmptyText(emoji) || !isNonEmptyText(labelTh) || !isNonEmptyText(labelEn)) return null;
  if (typeof displayOrder !== 'number' || !Number.isInteger(displayOrder)) return null;

  return { typeCode, emoji, labelTh, labelEn, displayOrder };
}

/**
 * Turns a raw view response into the list result. All-or-nothing: one malformed row
 * makes the whole list `unavailable`, because a half-parsed list would be a broken
 * list. Never called with anything but the view's rows.
 */
export function parseBusinessTypeRows(data: unknown, error: unknown): BusinessTypeListResult {
  if (error || !Array.isArray(data)) return withoutTypes('unavailable');
  if (data.length === 0) return withoutTypes('empty');

  const types: BusinessTypeListItem[] = [];
  for (const row of data) {
    const parsed = parseBusinessTypeRow(row);
    if (!parsed) return withoutTypes('unavailable');
    types.push(parsed);
  }

  return { status: 'loaded', types };
}

/** True when `code` is one of the codes the view returned. */
export function isBusinessTypeCode(types: readonly BusinessTypeListItem[], code: unknown): boolean {
  return typeof code === 'string' && types.some((type) => type.typeCode === code);
}

/**
 * Resolves a code to the row the view returned for it, or null. A code the view did
 * not return resolves to null — the signup has nothing to record for it.
 */
export function findBusinessType(
  types: readonly BusinessTypeListItem[],
  code: unknown,
): BusinessTypeListItem | null {
  return typeof code === 'string'
    ? types.find((type) => type.typeCode === code) ?? null
    : null;
}
