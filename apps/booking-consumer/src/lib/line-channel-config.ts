type LineChannelConfigInput = {
  mode: 'trial' | 'paid';
  centralSecret?: string;
  centralAccessToken?: string;
  merchantSecret?: string;
  merchantAccessToken?: string;
};

export type ResolvedLineChannelConfig = {
  mode: 'central' | 'merchant';
  channelSecret: string;
  accessToken: string;
};

export function resolveLineChannelConfig(input: LineChannelConfigInput): ResolvedLineChannelConfig {
  if (input.mode === 'trial') {
    if (!input.centralSecret || !input.centralAccessToken) {
      throw new Error('Central LINE credentials are not configured');
    }
    return { mode: 'central', channelSecret: input.centralSecret, accessToken: input.centralAccessToken };
  }

  if (!input.merchantSecret || !input.merchantAccessToken) {
    throw new Error('Merchant LINE credentials are not configured');
  }
  return { mode: 'merchant', channelSecret: input.merchantSecret, accessToken: input.merchantAccessToken };
}

