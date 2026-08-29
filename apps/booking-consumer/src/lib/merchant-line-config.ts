import 'server-only';

import { resolveLineChannelConfig } from './line-channel-config';

type MerchantChannelRecord = Record<string, { channelSecret?: string; accessToken?: string }>;

export function resolveMerchantLineChannel(shopId: string) {
  let records: MerchantChannelRecord;
  try {
    records = JSON.parse(process.env.LINE_MERCHANT_CHANNELS_JSON ?? '{}') as MerchantChannelRecord;
  } catch {
    throw new Error('Merchant LINE configuration is invalid JSON');
  }
  const record = records[shopId];
  return resolveLineChannelConfig({
    mode: 'paid',
    merchantSecret: record?.channelSecret,
    merchantAccessToken: record?.accessToken,
  });
}

