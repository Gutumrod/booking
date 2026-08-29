export type AutoSlipProviderResult = {
  status: 'verified' | 'timeout' | 'unknown' | 'ambiguous' | 'provider_error';
  amountMatches?: boolean;
  recipientMatches?: boolean;
  transactionReference?: string;
};

export function classifyAutoSlipResult(result: AutoSlipProviderResult): 'verified' | 'manual_review' {
  return result.status === 'verified'
    && result.amountMatches === true
    && result.recipientMatches === true
    && Boolean(result.transactionReference?.trim())
    ? 'verified'
    : 'manual_review';
}
