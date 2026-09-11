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

// --- service duration contract (R4-9 / Amendment A1 / Codex F5, NEW-F10) ---
//
// Any positive integer minute is valid on the client. The native input must not
// add a stricter rule: `step={5}` made the browser block e.g. 37 as a step
// mismatch before the commit guard ever ran. The pre-R7 server multiple-of-15
// rule is surfaced separately as a transparent error, never enforced here.

export const DURATION_RULES = { min: 1, integer: true } as const satisfies NumericFieldRules;

/** Spread onto the duration <input>; step 1 so every positive integer is submittable. */
export const DURATION_INPUT_PROPS = { type: 'number', min: 1, step: 1, inputMode: 'numeric' } as const;

/**
 * Mirror of the HTML number-input constraint check (rangeUnderflow +
 * stepMismatch, step base = min) -- true when the browser would let the form
 * submit this value.
 */
export function nativeNumberInputAccepts(value: number, props: { min: number; step: number }): boolean {
  return value >= props.min && Number.isInteger((value - props.min) / props.step);
}
