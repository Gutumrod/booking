/**
 * Business-type starter-pattern catalogue (BK01 signup, WU-A3).
 *
 * Business types and their starter patterns are declared here as DATA, never as
 * conditionals scattered through the signup page. Adding a new business type is
 * one entry in `BUSINESS_TYPES` plus its Thai/English copy under the
 * `businessType` message namespace — no signup-page edit is required (L-12).
 *
 * The starter pattern is what the shop is prefilled with at signup and may then
 * edit: example services with durations, and opening hours per weekday
 * (`dayOfWeek` 0 = Sunday, matching `DashboardScheduleDay` and
 * `dashboard.dayNames`).
 *
 * Deliberate omissions:
 * - No prices and no deposit amounts. Pricing is an Owner decision, so a pattern
 *   never carries money.
 * - No server persistence. The pattern is applied on the client at signup only;
 *   saving it to the database is server/SQL work that is NOT APPLIED.
 *
 * Durations are integers and multiples of 15 minutes so a later server write can
 * satisfy the existing duration contract without a rewrite.
 */

export const BUSINESS_TYPE_PATTERN_VERSION = 1;

export type BusinessTypeId = 'hair_barber' | 'beauty_salon' | 'nail_salon' | 'other';

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

export interface BusinessTypePattern {
  services: readonly PatternService[];
  openingHours: readonly PatternOpeningHours[];
}

export interface BusinessTypeDefinition {
  id: BusinessTypeId;
  /** i18n path under the `businessType` namespace, e.g. `hairBarber`. */
  messageKey: string;
  pattern: BusinessTypePattern;
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
 * Builds a full Monday..Sunday opening-hours pattern for a type. `openDays`
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
 * The main groups named in the product README (hair/barber, beauty, nail) plus
 * an `other` catch-all, in the order the signup offers them.
 */
export const BUSINESS_TYPES: readonly BusinessTypeDefinition[] = [
  {
    id: 'hair_barber',
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
  {
    id: 'beauty_salon',
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
  {
    id: 'nail_salon',
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
  {
    id: 'other',
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
];

export function listBusinessTypes(): readonly BusinessTypeDefinition[] {
  return BUSINESS_TYPES;
}

export function isBusinessTypeId(value: unknown): value is BusinessTypeId {
  return typeof value === 'string' && BUSINESS_TYPES.some((type) => type.id === value);
}

/**
 * Resolves a business type id to its definition, or null for an unknown value
 * (unknown ids are rejected rather than silently defaulted).
 */
export function getBusinessType(value: unknown): BusinessTypeDefinition | null {
  return isBusinessTypeId(value)
    ? BUSINESS_TYPES.find((type) => type.id === value) ?? null
    : null;
}

/** Stable, versioned identity of a type's pattern, recorded on the signup payload. */
export function getPatternId(type: BusinessTypeDefinition): string {
  return `${type.id}.v${BUSINESS_TYPE_PATTERN_VERSION}`;
}

export function totalPatternDurationMinutes(type: BusinessTypeDefinition): number {
  return type.pattern.services.reduce((total, service) => total + service.durationMinutes, 0);
}

/** Every message path a type requires, used to keep TH/EN copy in step. */
export function businessTypeMessagePaths(type: BusinessTypeDefinition): readonly string[] {
  return [
    `${type.messageKey}.label`,
    `${type.messageKey}.description`,
    ...type.pattern.services.map((service) => `${type.messageKey}.services.${service.key}`),
  ];
}

/**
 * Renders the weekday lines of a pattern for display in the active locale.
 * Labels are passed in so this stays locale-agnostic and unit-testable.
 */
export function summarizeOpeningHours(
  pattern: BusinessTypePattern,
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
 * The pattern is applied on the client at signup only. Persisting it to real
 * services/opening hours in the database is server/SQL work that is
 * NOT APPLIED (see docs/house-swarm-1/WUA3-SIGNUP-TYPE.md).
 * ------------------------------------------------------------------------- */

export type SignupPlanId = 'free_trial' | 'basic_490' | 'pro_990';

/**
 * Analysis record for the chosen starter pattern. Keys are stable snake_case so
 * a future server/analytics write can consume them unchanged.
 */
export interface SignupPatternSelection {
  business_type: BusinessTypeId;
  business_type_key: string;
  pattern_id: string;
  pattern_version: number;
  pattern_service_count: number;
  pattern_total_duration_minutes: number;
  pattern_service_keys: string[];
  pattern_working_days: number[];
}

export interface SignupIntentInput {
  businessType: unknown;
  selectedPlan: SignupPlanId;
}

export interface SignupIntent {
  businessType: BusinessTypeDefinition;
  pattern: SignupPatternSelection;
  selectedPlan: SignupPlanId;
}

export function buildSignupPatternSelection(
  type: BusinessTypeDefinition,
): SignupPatternSelection {
  return {
    business_type: type.id,
    business_type_key: type.messageKey,
    pattern_id: getPatternId(type),
    pattern_version: BUSINESS_TYPE_PATTERN_VERSION,
    pattern_service_count: type.pattern.services.length,
    pattern_total_duration_minutes: totalPatternDurationMinutes(type),
    pattern_service_keys: type.pattern.services.map((service) => service.key),
    pattern_working_days: type.pattern.openingHours
      .filter((day) => day.isOpen)
      .map((day) => day.dayOfWeek)
      .sort((left, right) => left - right),
  };
}

/**
 * Builds the signup intent for a chosen business type. Returns null when the
 * type is missing or unknown — the signup must ask for a valid type rather than
 * guess one.
 */
export function buildSignupIntent({ businessType, selectedPlan }: SignupIntentInput): SignupIntent | null {
  const type = getBusinessType(businessType);
  if (!type) return null;

  return {
    businessType: type,
    pattern: buildSignupPatternSelection(type),
    selectedPlan,
  };
}

export interface CatalogueIssue {
  where: string;
  problem: string;
}

/**
 * Structural completeness check for the catalogue. Returns an empty array when
 * every type carries a complete, editable starter pattern; each remaining issue
 * names the exact type/service/day that is invalid.
 */
export function validateBusinessTypeCatalogue(
  types: readonly BusinessTypeDefinition[] = BUSINESS_TYPES,
): readonly CatalogueIssue[] {
  const issues: CatalogueIssue[] = [];
  const seenIds = new Set<string>();
  const seenMessageKeys = new Set<string>();

  if (types.length === 0) {
    issues.push({ where: 'catalogue', problem: 'no business types defined' });
    return issues;
  }

  for (const type of types) {
    const where = type.id;

    if (seenIds.has(type.id)) {
      issues.push({ where, problem: 'duplicate business type id' });
    }
    seenIds.add(type.id);

    if (!/^[a-z][a-z0-9_]*$/.test(type.id)) {
      issues.push({ where, problem: 'business type id must be snake_case' });
    }

    if (!type.messageKey || !/^[a-z][a-zA-Z0-9]*$/.test(type.messageKey)) {
      issues.push({ where, problem: 'messageKey must be lowerCamelCase' });
    }
    if (seenMessageKeys.has(type.messageKey)) {
      issues.push({ where, problem: 'duplicate messageKey' });
    }
    seenMessageKeys.add(type.messageKey);

    const services = type.pattern.services;
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

    const hours = type.pattern.openingHours;
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
