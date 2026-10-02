import { resolveLineChannelConfig } from '../../../../lib/line-channel-config';
import { handleLineWebhook } from '../../../../lib/line-webhook';

/**
 * The central LINE webhook (the trial OA). The handler and the signature check live
 * in `lib/line-webhook.ts` because Next 16.3.6 asserts that a route module exports
 * nothing but the HTTP methods and the documented config symbols — the exported
 * handler would fail the production build as TS2344. The merchant route imports the
 * same handler from the library module.
 */

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

export async function POST(req: Request) {
  try {
    const config = resolveLineChannelConfig({ mode: 'trial', centralSecret: LINE_CHANNEL_SECRET, centralAccessToken: LINE_CHANNEL_ACCESS_TOKEN });
    return handleLineWebhook(req, config);
  } catch {
    return Response.json({ error: 'LINE channel is not configured' }, { status: 503 });
  }
}
