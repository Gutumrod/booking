import { handleStripeWebhook } from '../../../../lib/stripe-webhook';

/**
 * The App Router entry point for the Stripe webhook.
 *
 * The handler lives in `lib/stripe-webhook.ts` because Next 16.3.6 asserts that a
 * route module exports nothing but the HTTP methods and the documented config
 * symbols (`export async function handleStripeWebhook` failed the build as
 * TS2344). The signature-before-database ordering and the event journal are
 * documented on the handler; this module only delegates, with the same defaults.
 */

export async function POST(req: Request) {
  return handleStripeWebhook(req);
}
