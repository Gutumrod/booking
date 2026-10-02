/**
 * The pure, side-effect-free home of the dispatcher parameter-name parser.
 *
 * WHY THIS FILE EXISTS (N2 seam fix): the parser used to live inline in
 * `tests/r2-review-probe.mjs`, and the lock test had to import that probe to reach
 * it. The probe is an executable SCRIPT — its top level runs the whole dispatch and
 * mutates `process.env`. Under `--experimental-test-isolation=none` every test file
 * shares ONE process, so importing the probe from a test dropped the probe's
 * top-level execution (and its `process.env` writes) into the same process as
 * `tests/bk01-wuc-routes.integration.test.ts` and made its dispatch case fail. The
 * parser is extracted here so a test can lock it without importing the probe.
 *
 * THIS MODULE IS PURE. Importing it has NO side effects whatsoever: no environment
 * read, no test execution, no top-level await, no I/O. It only defines the two
 * exported bindings below.
 */

/**
 * Recover a function's parameter NAMES from its own source text.
 *
 * The rendered source of `handleNotificationDispatch` carries a parameter-list
 * comment — `// The REAL production defaults (PART A item 5): ...` — and the original
 * non-greedy `/^[^(]*\(([\s\S]*?)\)/` stopped at the `)` inside that comment. Only
 * `req, runtimeProvider, send, quotaTransport` were recovered, the three injected
 * transports were never passed, the alert path stayed ABSENT and the probe printed
 * `alerts:0` / `ledgerCalls:0` — a probe that cannot inject looks like a source
 * defect.
 *
 * This function strips block comments and line comments from the source BEFORE
 * matching the parameter list, so a `(` or `)` inside a comment can never truncate
 * the signature again. Splitting on `,` after that is safe because a stripped
 * comment leaves no `,` behind.
 *
 * @param {string} handlerSource the function source, e.g. `String(handler)`
 * @returns {string[]} the plain parameter names, in declaration order
 */
export function parseHandlerParameterNames(handlerSource) {
  const source = String(handlerSource);
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/[^\n]*/g, ''); // line comments
  const match = code.match(/^[^(]*\(([\s\S]*?)\)/);
  return (match ? match[1] : '')
    .split(',')
    .map((part) => part.trim().split(/[=:\s]/)[0])
    .filter(Boolean);
}

/**
 * The exact dispatcher parameter names, in order, that both the probe and the lock
 * test expect. Frozen so a consumer cannot mutate the contract.
 */
export const PROBE_PARAMETER_NAMES = Object.freeze([
  'req',
  'runtimeProvider',
  'send',
  'quotaTransport',
  'alertTransport',
  'resolvePushUsage',
  'pushAlertSink',
]);
