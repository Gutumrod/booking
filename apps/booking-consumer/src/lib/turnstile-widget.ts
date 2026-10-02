/**
 * The Turnstile widget lifecycle for the public booking page.
 *
 * WHY THIS IS ITS OWN MODULE (BK01 D2 — report
 * `vault/06-Agent-Logs/WSTERA-House/reports/REPORT-HERMES-HOUSE-BK01-PRIVACY-SMOKE-2026-10-02.md`).
 * The defect was not in the widget options, it was the lifecycle: the page's effect had
 * `[]` dependencies, so it ran once at mount — while step 1 was on screen and this
 * widget's container did not exist yet. When the script's `load` event finally fired, the
 * render call saw a null container and returned, and nothing ever re-ran the effect. The
 * customer saw a complete, enabled step-2 form; the server answered
 * `400 {"error":"Challenge response is required"}`. Booking was impossible for every cold
 * visitor and nothing on screen said so. Browser evidence of the broken state:
 * `runtime/trial/screenshots/bk01fix-d2-before.json`.
 *
 * The lifecycle lives here, not inline in the page, so that both load orderings (script
 * already on the page, script arriving later), the exactly-one-widget rule, and the
 * teardown are testable without a browser —
 * `tests/bk01fix-turnstile-widget.test.ts` fails on the old mount-once shape.
 *
 * THE SPLIT OF RESPONSIBILITY. This module owns the widget's life given a container. The
 * page owns WHEN a container exists: it renders the container only on step 2 and passes
 * it in, so the effect re-runs when the element appears and tears the widget down when the
 * step is left. `sitekey` is public by design (Cloudflare ships it in the page HTML); the
 * SECRET never appears here or anywhere in the client.
 *
 * FAIL-SOFT ON PURPOSE. If the script cannot load, no widget exists and the server decides
 * what that means: in production a missing or invalid challenge refuses the booking, in
 * local development the Cloudflare test secret lets it through. A page that refused to
 * render because an optional third-party script failed would take booking down for every
 * customer, which is the worse failure. Turning that into a client-side booking block
 * would be exactly the kind of softening the server check exists to prevent.
 */

/** The subset of the Turnstile browser API this module uses. */
export interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface MountTurnstileWidgetInput {
  /** The `window` the script writes its API onto. Passed in rather than reached for. */
  window: Window;
  /** Used to find an already-injected script tag, and to inject one when there is none. */
  document: Document;
  /** The element the widget renders into. Must already be in the document. */
  container: HTMLElement;
  /** The public sitekey. Never the secret. */
  sitekey: string;
  /** The script URL, matched exactly against any existing tag so it is never loaded twice. */
  scriptSrc: string;
  /**
   * Called with a fresh token, and called with `''` when the challenge is spent, expires,
   * errors, or the widget is removed — so the caller can never submit a stale token.
   */
  onToken: (token: string) => void;
}

/**
 * Render one widget into `container` and return the teardown.
 *
 * The two orderings that must both work, because a warm browser and a cold visitor take
 * different paths and the old code only survived one of them:
 *
 *   - the API is already on the page → render now;
 *   - the API arrives later → wait for the `load` event of the tag carrying it, creating
 *     the tag only when one is genuinely absent.
 *
 * Exactly one widget is rendered per call. A second render in the same container would
 * leave two widgets fighting over the token the form submits.
 */
export function mountTurnstileWidget(input: MountTurnstileWidgetInput): () => void {
  const { window: hostWindow, document: hostDocument, container, sitekey, scriptSrc, onToken } = input;

  let disposed = false;
  let widgetId: string | null = null;

  const render = (): void => {
    if (disposed || widgetId !== null) return;
    const api = hostWindow.turnstile;
    if (!api) return;
    widgetId = api.render(container, {
      sitekey,
      callback: (token: string) => {
        if (!disposed) onToken(typeof token === 'string' ? token : '');
      },
      'expired-callback': () => {
        if (!disposed) onToken('');
      },
      'error-callback': () => {
        if (!disposed) onToken('');
      },
    });
  };

  let script: HTMLScriptElement | null = null;

  if (hostWindow.turnstile) {
    render();
  } else {
    const existing = hostDocument.querySelector<HTMLScriptElement>(`script[src="${scriptSrc}"]`);
    script = existing;
    if (!script) {
      script = hostDocument.createElement('script');
      script.src = scriptSrc;
      script.async = true;
      script.defer = true;
      hostDocument.head.appendChild(script);
    }
    script.addEventListener('load', render);
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (script) script.removeEventListener('load', render);
    const api = hostWindow.turnstile;
    if (widgetId !== null && api) api.remove(widgetId);
    // The removed widget's token is gone with it: leaving step 2 must not leave a token
    // behind that a later submit could still send.
    if (widgetId !== null) onToken('');
  };
}
