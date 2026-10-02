import assert from 'node:assert/strict';
import test from 'node:test';

/*
 * N2 recurrence guard (HOUSE-BK01-P0-APP, independent review 2026-10-02, opencode
 * and Qwen reported the same finding).
 *
 * `tests/r2-review-probe.mjs` maps the dispatcher's arguments by the parameter
 * NAMES it parses out of `handler.toString()`. The real signature of
 * `handleNotificationDispatch` carries a parameter-list comment
 * (`// The REAL production defaults (PART A item 5): ...`), and the original
 * non-greedy match `/^[^(]*\(([\s\S]*?)\)/` stopped at the `)` inside that comment:
 * it recovered only `req, runtimeProvider, send, quotaTransport`, so the three
 * injected transports `alertTransport`, `resolvePushUsage` and `pushAlertSink` were
 * never passed. The production alert path stayed ABSENT and the probe printed
 * `alerts:0` and `ledgerCalls:0` — a probe that cannot inject looks like a source
 * defect.
 *
 * THIS LOCK IS HERMETIC. It imports ONLY the pure parser module
 * (`tests/lib/handler-parameter-names.mjs`) and the real handler. It deliberately
 * does NOT import `tests/r2-review-probe.mjs`: that probe is an executable script
 * whose top level runs the whole dispatch and mutates `process.env`, and under
 * `--experimental-test-isolation=none` importing it shared one process with
 * `tests/bk01-wuc-routes.integration.test.ts` and made its dispatch case fail. It
 * sets no `process.env` variable and starts no dispatcher.
 */

// The real handler, imported for its source text only. Importing the module is
// side-effect free: it defines functions and types and reads no environment variable
// at module scope (the integration test imports it the same way and runs clean).
const { handleNotificationDispatch } = await import('../apps/booking-consumer/src/lib/notification-dispatch.ts');
// The real parser, from the pure module — not from the probe.
const { parseHandlerParameterNames, PROBE_PARAMETER_NAMES } = await import('./lib/handler-parameter-names.mjs');

const handlerSource = String(handleNotificationDispatch);

test('N2 the parser recovers every injected dispatcher parameter, in order', () => {
  assert.deepEqual(
    parseHandlerParameterNames(handlerSource),
    [...PROBE_PARAMETER_NAMES],
    'the dispatcher parameter names must be recovered exactly, so every injected transport is passed',
  );
});

test('N2 every one of the seven injected parameters is present by name', () => {
  const names = parseHandlerParameterNames(handlerSource);
  assert.equal(names.length, PROBE_PARAMETER_NAMES.length);
  for (const required of PROBE_PARAMETER_NAMES) {
    assert.ok(names.includes(required), `injected parameter ${required} must be recovered from the signature`);
  }
});

test('N2 the real signature still carries the (PART A item 5) comment', () => {
  // The comment must still be in the source, otherwise this lock would not exercise
  // the hazard it defends against. The comment-blind regex stops at the `)` inside
  // it, which is exactly why the stripping parser is required.
  assert.ok(
    handlerSource.includes('(PART A item 5)'),
    'the parameter-list comment must still be present for this lock to be meaningful',
  );
  const legacy = (handlerSource.match(/^[^(]*\(([\s\S]*?)\)/) ?? [null, ''])[1]
    .split(',')
    .map((part) => part.trim().split(/[=:\s]/)[0])
    .filter(Boolean);
  assert.ok(
    legacy.length < PROBE_PARAMETER_NAMES.length,
    `the comment must still defeat the comment-blind parser (legacy ${legacy.length} vs ${PROBE_PARAMETER_NAMES.length})`,
  );
  assert.ok(
    PROBE_PARAMETER_NAMES.every((name) => parseHandlerParameterNames(handlerSource).includes(name)),
    'every injected parameter must survive comment stripping',
  );
});
