import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { mountTurnstileWidget } from '../apps/booking-consumer/src/lib/turnstile-widget.ts';

/**
 * BK01 D2 (report HOUSE-BK01-PRIVACY-SMOKE-2026-10-02, defect D2 — P0).
 *
 * THE MEASURED DEFECT. The booking page's Turnstile effect had `[]` dependencies, so it
 * ran once at mount — while step 1 was on screen and the widget's container did not
 * exist yet. When the script's `load` event finally fired, the effect's `render()` saw a
 * null ref and did nothing, and because nothing ever re-ran the effect, no widget was
 * ever rendered and no token was ever produced. In the browser the step-2 form was
 * complete and the button was enabled, but `POST /api/bookings/hold` answered
 * `400 {"error":"Challenge response is required"}` (evidence:
 * `runtime/trial/screenshots/bk01fix-d2-before.json`). Booking was impossible for every
 * customer, silently.
 *
 * WHAT THIS FILE PINS. The lifecycle, not the page: given a container that appears AFTER
 * the script has already loaded, and given a script that loads AFTER the container
 * appeared, a widget is rendered and a token reaches the caller exactly once per mount —
 * and leaving the step removes the widget and drops the token. Both orderings were
 * possible in production (script cached or not) and only the second one was ever
 * exercised by the old code, which is why it looked fine in a warm browser and was broken
 * for a cold visitor.
 *
 * The second test is the wiring guard: the page must hand the lifecycle a container that
 * only exists while the widget may exist, keyed on the step, so the effect cannot go back
 * to running once-at-mount.
 *
 * The server-side challenge check is NOT softened by any of this and this file does not
 * touch it: `lib/booking-ingress.ts` still refuses a missing token, and the tests that
 * pin that behaviour (`house-p0-app-booking-ingress.test.ts`) are unchanged.
 */

type RenderCall = { container: unknown; options: Record<string, unknown> };

function createWidgetApi() {
  const renders: RenderCall[] = [];
  const removals: string[] = [];
  let nextId = 1;
  return {
    renders,
    removals,
    api: {
      render(container: HTMLElement, options: Record<string, unknown>) {
        renders.push({ container, options });
        return `widget-${nextId++}`;
      },
      reset() {},
      remove(widgetId?: string) {
        removals.push(String(widgetId));
      },
    },
  };
}

/**
 * A minimal stand-in for the browser surface the lifecycle actually uses. It is a fake
 * on purpose: the real DOM is exercised end-to-end by the Playwright proof on the trial
 * stack (`bk01fix-d2-proof.mjs`), while this harness is what makes both load orderings
 * and the teardown deterministic and repeatable in CI.
 */
function createFakeBrowser({ apiAlreadyLoaded, scriptTagPresent }: { apiAlreadyLoaded: boolean; scriptTagPresent: boolean }) {
  const { api, renders, removals } = createWidgetApi();
  const listeners = new Set<() => void>();
  let appendedScripts = 0;
  const scriptElement = {
    src: '',
    addEventListener(type: string, listener: () => void) {
      if (type === 'load') listeners.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      if (type === 'load') listeners.delete(listener);
    },
  };
  const win: Record<string, unknown> = apiAlreadyLoaded ? { turnstile: api } : {};
  const doc = {
    querySelector: () => (scriptTagPresent ? scriptElement : null),
    createElement: () => scriptElement,
    head: { appendChild: () => { appendedScripts += 1; } },
  };
  return {
    win,
    doc,
    renders,
    removals,
    scriptElement,
    appendedScripts: () => appendedScripts,
    /** The browser reaches the script now; the listeners attached before hear it. */
    fireLoad: () => {
      win.turnstile = api;
      for (const listener of Array.from(listeners)) listener();
    },
    listenerCount: () => listeners.size,
  };
}

const CONTAINER = { id: 'turnstile-container' } as unknown as HTMLElement;

test('a container that appears after the script already loaded still gets a widget', () => {
  // The cached-script case of the measured defect: `window.turnstile` is already there at
  // the moment step 2 mounts, and the old effect had already given up on an earlier tick.
  const browser = createFakeBrowser({ apiAlreadyLoaded: true, scriptTagPresent: true });
  const tokens: string[] = [];
  const unmount = mountTurnstileWidget({
    window: browser.win,
    document: browser.doc,
    container: CONTAINER,
    sitekey: 'test-sitekey',
    scriptSrc: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    onToken: (token) => tokens.push(token),
  });

  assert.equal(browser.renders.length, 1, 'the widget must render immediately when the API is already on the page');
  assert.equal(browser.renders[0].container, CONTAINER, 'the widget must render into the container it was given');
  assert.equal(browser.renders[0].options.sitekey, 'test-sitekey');
  assert.equal(typeof browser.renders[0].options.callback, 'function', 'the token callback must be wired');
  assert.equal(browser.appendedScripts(), 0, 'an already-loaded script tag must not be injected a second time');

  (browser.renders[0].options.callback as (token: string) => void)('token-from-cached-script');
  assert.deepEqual(tokens, ['token-from-cached-script']);

  unmount();
  assert.deepEqual(browser.removals, ['widget-1'], 'leaving the step must remove the widget it created');
  assert.deepEqual(tokens, ['token-from-cached-script', ''], 'leaving the step must drop the token');
});

test('a script that loads after step 2 mounted still produces a token, exactly once', () => {
  // The cold-visitor case, and the one the old code could not survive: the container is
  // already there when the script arrives, so the load listener must render into it.
  const browser = createFakeBrowser({ apiAlreadyLoaded: false, scriptTagPresent: false });
  const tokens: string[] = [];
  mountTurnstileWidget({
    window: browser.win,
    document: browser.doc,
    container: CONTAINER,
    sitekey: 'test-sitekey',
    scriptSrc: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    onToken: (token) => tokens.push(token),
  });

  assert.equal(browser.renders.length, 0, 'nothing can render before the API exists');
  assert.equal(browser.appendedScripts(), 1, 'the script must be injected exactly once');
  assert.equal(browser.listenerCount(), 1, 'the load listener must be attached');

  browser.fireLoad();
  assert.equal(browser.renders.length, 1, 'the load event must render the widget into the container on screen');

  // A duplicate load (two script tags, or a retry) must not render a second widget: two
  // widgets in one container would fight over the token the form submits.
  browser.fireLoad();
  assert.equal(browser.renders.length, 1, 'a repeated load must not render a second widget');

  (browser.renders[0].options.callback as (token: string) => void)('token-after-load');
  assert.deepEqual(tokens, ['token-after-load'], 'the token produced after the late load must reach the caller');
});

test('an expired or failed challenge clears the token instead of leaving a stale one', () => {
  const browser = createFakeBrowser({ apiAlreadyLoaded: true, scriptTagPresent: true });
  const tokens: string[] = [];
  mountTurnstileWidget({
    window: browser.win,
    document: browser.doc,
    container: CONTAINER,
    sitekey: 'test-sitekey',
    scriptSrc: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    onToken: (token) => tokens.push(token),
  });

  const options = browser.renders[0].options as Record<string, (() => void) | undefined>;
  (options.callback as () => void)();
  (options['expired-callback'] as () => void)();
  (options['error-callback'] as () => void)();
  assert.deepEqual(tokens, ['', '', ''], 'a spent, expired, or failed challenge must clear the token');
});

test('teardown detaches the load listener so a removed step cannot render later', () => {
  const browser = createFakeBrowser({ apiAlreadyLoaded: false, scriptTagPresent: true });
  const unmount = mountTurnstileWidget({
    window: browser.win,
    document: browser.doc,
    container: CONTAINER,
    sitekey: 'test-sitekey',
    scriptSrc: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    onToken: () => {},
  });
  assert.equal(browser.listenerCount(), 1);
  unmount();
  assert.equal(browser.listenerCount(), 0, 'the listener must be detached on teardown');
  browser.fireLoad();
  assert.equal(browser.renders.length, 0, 'a load that arrives after teardown must not render into a gone container');
});

test('the booking page binds the widget lifecycle to the step, not to mount', () => {
  // The page-level half of the defect. The lifecycle above is only correct if the page
  // hands it a container that exists while step 2 is on screen and lets the effect re-run
  // when that changes; the old effect ran once with `[]`.
  const file = 'apps/booking-consumer/src/app/book/[slug]/page.tsx';
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const effectDepArrays: Array<string> = [];
  let mountsTheWidget = false;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect') {
      const body = node.arguments[0];
      const deps = node.arguments[1];
      if (body && body.getText(sourceFile).includes('mountTurnstileWidget(')) {
        mountsTheWidget = true;
        effectDepArrays.push(deps ? deps.getText(sourceFile).replace(/\s+/g, '') : 'NONE');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  assert.ok(mountsTheWidget, `${file} must mount the widget through the extracted lifecycle`);
  assert.equal(effectDepArrays.length, 1, `exactly one effect may mount the widget, found ${effectDepArrays.length}`);
  const deps = effectDepArrays[0];
  assert.match(deps, /^\[.*\bstep\b.*\]$/, `the widget effect must depend on the step, found dependencies ${deps}`);
  assert.match(deps, /turnstileContainer/, `the widget effect must depend on the container element, found dependencies ${deps}`);

  // The container must be attached through the callback ref that puts it into state, so
  // the effect can observe the element actually appearing.
  assert.match(source, /ref=\{setTurnstileContainer\}/, 'the widget container must use the callback ref');
  assert.doesNotMatch(source, /turnstileRef/, 'the old once-at-mount ref must be gone');
});
