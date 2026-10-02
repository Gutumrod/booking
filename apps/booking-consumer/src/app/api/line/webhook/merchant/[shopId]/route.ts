import { NextRequest, NextResponse } from 'next/server';

import { handleLineWebhook } from '@/lib/line-webhook';
import { resolveMerchantLineChannel } from '@/lib/merchant-line-config';

/**
 * The merchant LINE webhook. The handler moved to `lib/line-webhook.ts` when the
 * route modules were restricted to HTTP-method exports (Next 16.3.6 / TS2344).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ shopId: string }> },
) {
  const { shopId } = await params;
  try {
    return await handleLineWebhook(req, resolveMerchantLineChannel(shopId), shopId);
  } catch (error) {
    console.error('Merchant LINE configuration unavailable', {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Merchant LINE channel is not configured' }, { status: 503 });
  }
}
