/**
 * Merchant e-mail transport (BK01 brief 23, part B3(ข)).
 *
 * One adapter: Resend. The key and the sender are read from the environment and
 * are never defaulted, logged or echoed. With no key there is NO fallback to any
 * other channel -- the adapter reports `EMAIL_NOT_CONFIGURED` and the caller
 * records "not configured yet" against the outbox row. Owner decision A-20 is
 * explicit that the shop is reached by e-mail and NOT by LINE or Telegram, so a
 * silent fallback would be a policy violation, not a convenience.
 */

export const EMAIL_NOT_CONFIGURED = 'EMAIL_NOT_CONFIGURED';

export interface MerchantEmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MerchantEmailTransport {
  send(message: MerchantEmailMessage): Promise<{ ok: boolean; status: number; error?: string }>;
}

export interface MerchantEmailConfig {
  apiKey: string | null;
  from: string | null;
}

/** Reads the two env names the brief fixed. Never returns them to a caller that logs. */
export function readMerchantEmailConfig(env: Record<string, string | undefined>): MerchantEmailConfig {
  const apiKey = env.RESEND_API_KEY?.trim() ?? '';
  const from = env.EMAIL_FROM?.trim() ?? '';
  return {
    apiKey: apiKey.length > 0 ? apiKey : null,
    from: from.length > 0 ? from : null,
  };
}

export function isMerchantEmailConfigured(config: MerchantEmailConfig): boolean {
  return config.apiKey !== null && config.from !== null;
}

/**
 * The Resend adapter. `fetch` is injected so tests can prove the call happened
 * with the right payload; the real runtime passes the platform fetch.
 */
export function createResendTransport(
  config: MerchantEmailConfig,
  fetchImpl: typeof fetch = fetch,
): MerchantEmailTransport {
  return {
    async send(message) {
      if (!isMerchantEmailConfigured(config)) {
        // Fail closed. No SMTP, no LINE, no Telegram -- the outbox row is marked
        // as an error and the operator sees "not configured yet".
        return { ok: false, status: 0, error: EMAIL_NOT_CONFIGURED };
      }
      try {
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        });
        if (response.ok) return { ok: true, status: response.status };
        return { ok: false, status: response.status, error: `Resend responded with HTTP ${response.status}` };
      } catch {
        return { ok: false, status: 0, error: 'Resend transport is unavailable' };
      }
    },
  };
}
