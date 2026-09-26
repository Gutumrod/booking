/**
 * Starter-pattern catalogue for the BK01 signup (WU-A3), reduced to pattern data
 * only by H1-WUD-UI-TYPES (review finding N-4 / Addendum D).
 *
 * The business TYPE LIST is deliberately NOT in this file any more. N-4 ruled that
 * the database is the single source of type codes: the signup reads the list — and
 * with it every label, emoji and the display order — from the view
 * `local_service.app_business_types` through the app's Supabase client (see
 * `./business-type-view.ts`). The app therefore cannot disagree with the seeded
 * codes, because it no longer carries any.
 *
 * What remains here is the one mapping that is still held in the app: a stored type
 * code to the starter pattern the signup previews, in `BUSINESS_PATTERNS`. That
 * table is documented in `docs/house-swarm-1/WUD-UI-TYPES.md`. A code the view
 * returns that has no entry there simply has no bundled pattern, and the signup says
 * so rather than inventing one.
 *
 * The starter pattern is what the shop is prefilled with at signup and may then
 * edit: example services with durations, and opening hours per weekday
 * (`dayOfWeek` 0 = Sunday, matching `DashboardScheduleDay` and `dashboard.dayNames`).
 *
 * Deliberate omissions:
 * - No prices and no deposit amounts. Pricing is an Owner decision, so a pattern
 *   never carries money. (`local_service.business_types.starter_pattern` does carry
 *   sample prices; the signup does not read that column and invents no price.)
 * - No type codes beyond the mapping keys in `BUSINESS_PATTERNS`.
 * - No server persistence. The pattern is applied on the client at signup only;
 *   saving it to the database is server/SQL work that is NOT APPLIED.
 *
 * Durations are integers and multiples of 15 minutes so a later server write can
 * satisfy the existing duration contract without a rewrite.
 *
 * Every pattern value below is a changeable UI placeholder (the `*` of the brief's
 * still-unlocked list), not an Owner-answered fact.
 */

export const BUSINESS_PATTERN_VERSION = 1;

export interface PatternService {
  /** i18n key under `businessType.<messageKey>.services`, e.g. `haircut`. */
  key: string;
  /** Whole minutes, multiple of 15. */
  durationMinutes: number;
}

export interface PatternOpeningHours {
  /** 0 = Sunday ... 6 = Saturday. */
  dayOfWeek: number;
  isOpen: boolean;
  /** `HH:MM` when open, `null` when closed. */
  open: string | null;
  close: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface BusinessPattern {
  services: readonly PatternService[];
  openingHours: readonly PatternOpeningHours[];
}

export interface BusinessPatternEntry {
  /**
   * i18n path under the `businessType` namespace holding this pattern's copy.
   * Pattern copy only — the type's own label and emoji come from the database view.
   */
  messageKey: string;
  pattern: BusinessPattern;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function closedDay(dayOfWeek: number): PatternOpeningHours {
  return { dayOfWeek, isOpen: false, open: null, close: null, breakStart: null, breakEnd: null };
}

function openDay(
  dayOfWeek: number,
  open: string,
  close: string,
  breakStart: string,
  breakEnd: string,
): PatternOpeningHours {
  return { dayOfWeek, isOpen: true, open, close, breakStart, breakEnd };
}

/**
 * Builds a full Sunday..Saturday opening-hours pattern for a type. `openDays`
 * lists the working weekdays; every other weekday is closed.
 */
function weeklyHours(
  openDays: readonly number[],
  open: string,
  close: string,
  breakStart: string,
  breakEnd: string,
): readonly PatternOpeningHours[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) =>
    openDays.includes(dayOfWeek)
      ? openDay(dayOfWeek, open, close, breakStart, breakEnd)
      : closedDay(dayOfWeek),
  );
}

const MON_TO_SAT = [1, 2, 3, 4, 5, 6] as const;
const TUE_TO_SUN = [2, 3, 4, 5, 6, 0] as const;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * THE ONLY place in this app where a stored business type code is mapped to
 * anything. Keys are the codes the database owns (`business_types.type_code`, the
 * codes this view returns); values carry the starter pattern the signup previews
 * and the i18n path of that pattern's copy. Documented, with the current mapping
 * table, in `docs/house-swarm-1/WUD-UI-TYPES.md`.
 *
 * Adding a type is a database change (`is_active`), not an entry here. Adding a
 * pattern for a code is one entry here plus its copy — and a code with no entry
 * here is offered with an honest "no starter pattern yet" state.
 */
export const BUSINESS_PATTERNS: Readonly<Record<string, BusinessPatternEntry>> = {
  // barber barber/salon pattern, from the product README main group hair/barber.
  barber: {
    messageKey: 'hairBarber',
    pattern: {
      services: [
        { key: 'haircut', durationMinutes: 30 },
        { key: 'haircutWash', durationMinutes: 45 },
        { key: 'beardTrim', durationMinutes: 15 },
        { key: 'washSet', durationMinutes: 30 },
        { key: 'colorShort', durationMinutes: 90 },
      ],
      // Barbers commonly close on Monday.
      openingHours: weeklyHours(TUE_TO_SUN, '10:00', '20:00', '13:00', '14:00'),
    },
  },
  beauty_clinic: {
    messageKey: 'beautySalon',
    pattern: {
      services: [
        { key: 'facialBasic', durationMinutes: 60 },
        { key: 'facialPremium', durationMinutes: 90 },
        { key: 'browShape', durationMinutes: 30 },
        { key: 'lashExtension', durationMinutes: 120 },
        { key: 'makeupEvent', durationMinutes: 75 },
      ],
      openingHours: weeklyHours(MON_TO_SAT, '10:00', '19:00', '12:00', '13:00'),
    },
  },
  nail_lash: {
    messageKey: 'nailSalon',
    pattern: {
      services: [
        { key: 'manicure', durationMinutes: 45 },
        { key: 'pedicure', durationMinutes: 60 },
        { key: 'gelPolish', durationMinutes: 75 },
        { key: 'nailArt', durationMinutes: 90 },
        { key: 'extensionSet', durationMinutes: 120 },
      ],
      openingHours: weeklyHours(EVERY_DAY, '10:00', '20:00', '12:00', '13:00'),
    },
  },
  other: {
    messageKey: 'other',
    pattern: {
      services: [
        { key: 'consultation', durationMinutes: 30 },
        { key: 'standardService', durationMinutes: 60 },
        { key: 'servicePackage', durationMinutes: 90 },
        { key: 'followUp', durationMinutes: 30 },
      ],
      openingHours: weeklyHours(MON_TO_SAT, '09:00', '18:00', '12:00', '13:00'),
    },
  },
};

/** The codes this app bundles a starter pattern for (never a claim about what exists). */
export function bundledPatternCodes(): readonly string[] {
  return Object.keys(BUSINESS_PATTERNS);
}

/**
 * Resolves a type code to the pattern this app bundles for it, or null when the
 * database code has no bundled pattern — the signup then offers the type without a
 * pattern preview instead of inventing one.
 */
export function findBusinessPattern(typeCode: unknown): BusinessPatternEntry | null {
  return typeof typeCode === 'string' && Object.prototype.hasOwnProperty.call(BUSINESS_PATTERNS, typeCode)
    ? BUSINESS_PATTERNS[typeCode]
    : null;
}

/** Stable, versioned identity of the bundled pattern, recorded on the signup payload. */
export function getPatternId(typeCode: string): string {
  return `${typeCode}.v${BUSINESS_PATTERN_VERSION}`;
}

export function totalPatternDurationMinutes(entry: BusinessPatternEntry): number {
  return entry.pattern.services.reduce((total, service) => total + service.durationMinutes, 0);
}

/** Sorted working weekdays (0 = Sunday) of a bundled pattern. */
export function patternWorkingDays(entry: BusinessPatternEntry): readonly number[] {
  return entry.pattern.openingHours
    .filter((day) => day.isOpen)
    .map((day) => day.dayOfWeek)
    .sort((left, right) => left - right);
}

/** Every message path a pattern requires, used to keep TH/EN copy in step. */
export function businessPatternMessagePaths(entry: BusinessPatternEntry): readonly string[] {
  return [
    `${entry.messageKey}.description`,
    ...entry.pattern.services.map((service) => `${entry.messageKey}.services.${service.key}`),
  ];
}

/**
 * Renders the weekday lines of a pattern for display in the active locale.
 * Labels are passed in so this stays locale-agnostic and unit-testable.
 */
export function summarizeOpeningHours(
  pattern: BusinessPattern,
  labels: { dayNames: readonly string[]; closedLabel: string },
): readonly string[] {
  return [...pattern.openingHours]
    .sort((left, right) => left.dayOfWeek - right.dayOfWeek)
    .map((day) => {
      const dayName = labels.dayNames[day.dayOfWeek] ?? String(day.dayOfWeek);
      if (!day.isOpen || !day.open || !day.close) {
        return `${dayName}: ${labels.closedLabel}`;
      }
      const hours = day.breakStart && day.breakEnd
        ? `${day.open}-${day.close} (${day.breakStart}-${day.breakEnd})`
        : `${day.open}-${day.close}`;
      return `${dayName}: ${hours}`;
    });
}

/* ---------------------------------------------------------------------------
 * Signup intent
 *
 * What the BK01 signup records about the chosen business type, its starter
 * pattern and the selected plan. Kept in this module so the signup has exactly
 * one dependency-free source of truth, and so it is unit-testable without a
 * browser or a bundler.
 *
 * The type fields recorded here are the values the database view returned for the
 * chosen code — the code itself, its label in the active locale, its emoji, its
 * display order and the surface they came from — so the payload shows where the
 * type came from instead of repeating an app-owned list.
 *
 * The pattern is applied on the client at signup only. Persisting it to real
 * services/opening hours in the database is server/SQL work that is
 * NOT APPLIED (see docs/house-swarm-1/WUD-UI-TYPES.md).
 * ------------------------------------------------------------------------- */

export type SignupPlanId = 'free_trial' | 'basic_490' | 'pro_990';

/**
 * The part of a type-list row the signup intent records. Structurally satisfied by
 * `BusinessTypeListItem` from `./business-type-view.ts`, so the intent can be built
 * from a row the database returned without this module importing the client.
 */
export interface SignupBusinessType {
  /** The code the database owns. */
  typeCode: string;
  emoji: string;
  displayOrder: number;
}

/**
 * Analysis record for the chosen type and its starter pattern. Keys are stable
 * snake_case so a future server/analytics write can consume them unchanged.
 */
export interface SignupPatternSelection {
  business_type: string;
  business_type_label: string;
  business_type_emoji: string;
  business_type_display_order: number;
  business_type_source: string;
  /** `null` when the chosen code has no bundled pattern. */
  pattern_id: string | null;
  pattern_version: number;
  pattern_source: 'bundled-starter-pattern' | 'none';
  pattern_service_count: number;
  pattern_total_duration_minutes: number;
  pattern_service_keys: string[];
  pattern_working_days: number[];
}

export interface SignupIntentInput {
  /** The row the database view returned for the chosen code. */
  type: SignupBusinessType | null | undefined;
  /** The type's label in the active locale, as returned by the view. */
  label: string;
  /** The read surface the type came from, e.g. `local_service.app_business_types`. */
  source: string;
  selectedPlan: SignupPlanId;
}

export interface SignupIntent {
  businessType: SignupBusinessType;
  pattern: SignupPatternSelection;
  selectedPlan: SignupPlanId;
}

/**
 * Builds the signup intent for a chosen type row. Returns null when there is no
 * valid type — the signup must have a code the database returned rather than guess
 * one. A code without a bundled pattern is accepted, and the record says so.
 */
export function buildSignupIntent({ type, label, source, selectedPlan }: SignupIntentInput): SignupIntent | null {
  if (!type || typeof type.typeCode !== 'string' || !/^[a-z][a-z0-9_]*$/.test(type.typeCode)) return null;

  const entry = findBusinessPattern(type.typeCode);

  return {
    businessType: type,
    pattern: {
      business_type: type.typeCode,
      business_type_label: label,
      business_type_emoji: type.emoji,
      business_type_display_order: type.displayOrder,
      business_type_source: source,
      pattern_id: entry ? getPatternId(type.typeCode) : null,
      pattern_version: BUSINESS_PATTERN_VERSION,
      pattern_source: entry ? 'bundled-starter-pattern' : 'none',
      pattern_service_count: entry ? entry.pattern.services.length : 0,
      pattern_total_duration_minutes: entry ? totalPatternDurationMinutes(entry) : 0,
      pattern_service_keys: entry ? entry.pattern.services.map((service) => service.key) : [],
      pattern_working_days: entry ? [...patternWorkingDays(entry)] : [],
    },
    selectedPlan,
  };
}

export interface PatternCatalogueIssue {
  where: string;
  problem: string;
}

/**
 * Structural completeness check for the bundled patterns. Returns an empty array
 * when every entry carries a complete, editable starter pattern; each remaining
 * issue names the exact entry/service/day that is invalid.
 */
export function validateBusinessPatternCatalogue(
  entries: Readonly<Record<string, BusinessPatternEntry>> = BUSINESS_PATTERNS,
): readonly PatternCatalogueIssue[] {
  const issues: PatternCatalogueIssue[] = [];
  const codes = Object.keys(entries);

  if (codes.length === 0) {
    issues.push({ where: 'patterns', problem: 'no bundled starter patterns defined' });
    return issues;
  }

  const seenMessageKeys = new Set<string>();

  for (const typeCode of codes) {
    const where = typeCode;
    const entry = entries[typeCode];

    if (!/^[a-z][a-z0-9_]*$/.test(typeCode)) {
      issues.push({ where, problem: 'pattern key must be a snake_case type code' });
    }

    if (!entry.messageKey || !/^[a-z][a-zA-Z0-9]*$/.test(entry.messageKey)) {
      issues.push({ where, problem: 'messageKey must be lowerCamelCase' });
    }
    if (seenMessageKeys.has(entry.messageKey)) {
      issues.push({ where, problem: 'duplicate messageKey' });
    }
    seenMessageKeys.add(entry.messageKey);

    const services = entry.pattern.services;
    if (services.length < 3) {
      issues.push({ where, problem: 'pattern needs at least 3 example services' });
    }
    const seenServiceKeys = new Set<string>();
    for (const service of services) {
      if (!service.key || !/^[a-z][a-zA-Z0-9]*$/.test(service.key)) {
        issues.push({ where, problem: `invalid service key "${service.key}"` });
      }
      if (seenServiceKeys.has(service.key)) {
        issues.push({ where, problem: `duplicate service key "${service.key}"` });
      }
      seenServiceKeys.add(service.key);
      if (!Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0) {
        issues.push({ where, problem: `service "${service.key}" needs a positive whole-minute duration` });
      } else if (service.durationMinutes % 15 !== 0) {
        issues.push({ where, problem: `service "${service.key}" duration must be a multiple of 15 minutes` });
      }
    }

    const hours = entry.pattern.openingHours;
    if (hours.length !== 7) {
      issues.push({ where, problem: 'opening hours must cover all 7 weekdays' });
    }
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      const matches = hours.filter((day) => day.dayOfWeek === dayOfWeek);
      if (matches.length !== 1) {
        issues.push({ where, problem: `weekday ${dayOfWeek} must appear exactly once` });
        continue;
      }
      const day = matches[0];
      if (!day.isOpen) {
        if (day.open || day.close) {
          issues.push({ where, problem: `closed weekday ${dayOfWeek} must not carry hours` });
        }
        continue;
      }
      if (!day.open || !day.close || !TIME_PATTERN.test(day.open) || !TIME_PATTERN.test(day.close)) {
        issues.push({ where, problem: `weekday ${dayOfWeek} needs HH:MM open and close times` });
        continue;
      }
      if (day.open >= day.close) {
        issues.push({ where, problem: `weekday ${dayOfWeek} close time must be after open time` });
      }
      const hasBreakStart = day.breakStart !== null;
      const hasBreakEnd = day.breakEnd !== null;
      if (hasBreakStart !== hasBreakEnd) {
        issues.push({ where, problem: `weekday ${dayOfWeek} break needs both start and end` });
      } else if (hasBreakStart && hasBreakEnd) {
        if (!TIME_PATTERN.test(day.breakStart as string) || !TIME_PATTERN.test(day.breakEnd as string)) {
          issues.push({ where, problem: `weekday ${dayOfWeek} break times must be HH:MM` });
        } else if (day.breakStart! <= day.open || day.breakEnd! >= day.close || day.breakStart! >= day.breakEnd!) {
          issues.push({ where, problem: `weekday ${dayOfWeek} break must sit inside opening hours` });
        }
      }
    }
  }

  return issues;
}
