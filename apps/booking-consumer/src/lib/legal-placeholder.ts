/**
 * BK01 P0 — G32 (council finding): the customer legal pages rendered the raw
 * `[[OWNER INPUT: …]]` placeholders from the message catalogues straight onto the
 * screen, where a paying customer could read them.
 *
 * The facts behind those placeholders do not exist yet: the Owner has not supplied
 * them and a qualified legal reviewer has not passed the wording. So the catalogue
 * values MUST keep their placeholders — that is what
 * `scripts/check-owner-input-placeholders.mjs --enforce` still fails on, deliberately,
 * and deleting a placeholder to make that gate green would both invent a fact and
 * destroy the record of what is still missing.
 *
 * The fix therefore lives at RENDER time, not in the copy: every customer-visible
 * string is passed through `renderNeutralPlaceholders` with the catalogue's neutral
 * "not yet confirmed" value before it reaches the screen. The placeholder stays in the
 * catalogue and out of the DOM.
 *
 * Pure and dependency-free on purpose — no React, no next-intl, no I/O — so the
 * render-time behaviour is provable in a plain Node test and cannot drag a client
 * bundle in with it.
 */

/**
 * Every `[[…]]` run in a string.
 *
 * `[\s\S]` instead of `.` so a placeholder that spans a line break is still matched.
 * `?` (lazy) so two placeholders on one line are two runs rather than one match from
 * the first `[[` to the last `]]`. Global so `replace`/`match` see every run.
 */
export const OWNER_INPUT_PATTERN = /\[\[[\s\S]*?\]\]/g;

/** How many `[[…]]` runs the text carries. */
export function countOwnerInputPlaceholders(text: string): number {
  const matches = text.match(OWNER_INPUT_PATTERN);
  return matches === null ? 0 : matches.length;
}

/** True when the text carries at least one `[[…]]` run. */
export function containsOwnerInputPlaceholder(text: string): boolean {
  return countOwnerInputPlaceholders(text) > 0;
}

/**
 * Replace every `[[…]]` run with `pendingValue`.
 *
 * The replacement is passed as a function so that a `$&`-style sequence inside
 * `pendingValue` is inserted literally rather than expanded as a substitution pattern.
 */
export function renderNeutralPlaceholders(text: string, pendingValue: string): string {
  return text.replace(OWNER_INPUT_PATTERN, () => pendingValue);
}
