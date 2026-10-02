import { handleNotificationDispatch } from '../../../../lib/notification-dispatch';

/**
 * The App Router entry point for the outbound LINE notification dispatcher.
 *
 * The handler lives in `lib/notification-dispatch.ts` because Next 16.3.6 asserts
 * that a route module exports nothing but the HTTP methods and the documented
 * config symbols (`export async function handleNotificationDispatch` failed the
 * build as TS2344). The dispatch rules — the central OA decision, the pack gate,
 * the push cap and the shared-OA breaker — are documented on the handler; this
 * module only delegates, with the same defaults.
 */

export async function POST(req: Request) {
  return handleNotificationDispatch(req);
}
