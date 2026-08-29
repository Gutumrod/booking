import { NextRequest, NextResponse } from 'next/server';

import { handleLineWebhook } from '../../route';
import { resolveMerchantLineChannel } from '@/lib/merchant-line-config';

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
