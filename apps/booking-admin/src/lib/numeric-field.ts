// Numeric form-field editing state (KMO-08 / R4-2).
//
// The dashboard's numeric inputs used to hold a `number` and wrap every
// keystroke in `Number(e.target.value)`, so clearing a field to retype it
// snapped the value to 0 and the field could never show empty. These helpers
// let the editing value be a raw string (empty allowed while typing) and parse
// / validate only at blur and submit.
//
// Pure and framework-free so it can be unit-tested from `tests/`. Error codes
// are strings the caller maps to its own i18n.

export interface NumericFieldRules {
  min?: number;
  max?: number;
  integer?: boolean;
}

export type NumericFieldError =
  | 'required'
  | 'not-a-number'
  | 'not-integer'
  | 'below-min'
  | 'above-max';

export interface NumericFieldResult {
  /** Parsed number, or null when the input is empty or invalid. */
  value: number | null;
  error: NumericFieldError | null;
}

/**
 * Parse a raw input string while the user is still editing.
 * Empty / whitespace-only is allowed and yields `{ value: null, error: null }`.
 */
export function parseNumericField(raw: string, rules: NumericFieldRules = {}): NumericFieldResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: null, error: null };

  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: null, error: 'not-a-number' };
  if (rules.integer && !Number.isInteger(n)) return { value: null, error: 'not-integer' };
  if (rules.min != null && n < rules.min) return { value: null, error: 'below-min' };
  if (rules.max != null && n > rules.max) return { value: null, error: 'above-max' };
  return { value: n, error: null };
}

/**
 * Validate at blur / submit. Unlike {@link parseNumericField}, an empty string
 * is rejected here (`required`) because these are required fields.
 */
export function commitNumericField(raw: string, rules: NumericFieldRules = {}): NumericFieldResult {
  if (raw.trim() === '') return { value: null, error: 'required' };
  return parseNumericField(raw, rules);
}
