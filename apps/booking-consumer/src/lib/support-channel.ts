// Written-only customer support channel resolution (L-13).
//
// Launch shape: written contact only (e-mail and/or LINE Official Account).
// A live call / telephone channel is explicitly out of scope, and no
// response-time or service-level commitment may be expressed here because
// none has been approved.
//
// The contact VALUES are configuration, never hard-coded: they are read from
// NEXT_PUBLIC_SUPPORT_EMAIL and NEXT_PUBLIC_SUPPORT_LINE_OA_ID. This module
// must never invent an address, an identifier or an endpoint. When a value is
// absent the channel is reported as unresolved and the caller renders the
// marked placeholder below instead of a fabricated value.
//
// NOTE for the Owner: the two values are deliberately NOT set anywhere in this
// repository. They are listed as OWNER INPUT REQUIRED in
// docs/house-swarm-1/WU4-SUPPORT.md.

export const SUPPORT_EMAIL_ENV_KEY = 'NEXT_PUBLIC_SUPPORT_EMAIL';
export const SUPPORT_LINE_OA_ENV_KEY = 'NEXT_PUBLIC_SUPPORT_LINE_OA_ID';

/** Marker token that identifies a value only the Owner can supply. */
export const OWNER_INPUT_REQUIRED_MARKER = 'OWNER_INPUT_REQUIRED';

export type SupportChannelKind = 'email' | 'line';

export interface SupportChannel {
  kind: SupportChannelKind;
  /** Configuration key holding the real contact value. */
  envKey: string;
  /** Resolved contact value, or null while the Owner has not supplied it. */
  value: string | null;
  /** Link to open the channel, or null while unresolved. */
  href: string | null;
  /** Marked placeholder shown while unresolved. */
  placeholder: string | null;
}

export type SupportEnv = Record<string, string | undefined>;

function placeholderFor(envKey: string): string {
  return `[[${OWNER_INPUT_REQUIRED_MARKER}: ${envKey}]]`;
}

function readValue(env: SupportEnv, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Normalize a LINE OA identifier to the `@handle` form used in LINE links. */
export function normalizeLineOaId(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

/** Standard LINE Official Account link for a given OA identifier. */
export function buildLineOaUrl(value: string): string {
  return `https://line.me/R/ti/p/${normalizeLineOaId(value)}`;
}

export interface ResolvedSupportChannels {
  email: SupportChannel;
  line: SupportChannel;
  /** Channels with a real configured value. */
  configured: SupportChannel[];
  /** Channels still waiting for an Owner-supplied value. */
  unresolved: SupportChannel[];
  /** True only when at least one channel can actually be used right now. */
  hasConfiguredChannel: boolean;
}

/**
 * Resolve the written support channels from configuration. Pure function so the
 * parity/placeholder contract can be tested without a runtime or a network.
 */
export function resolveSupportChannels(env: SupportEnv): ResolvedSupportChannels {
  const emailValue = readValue(env, SUPPORT_EMAIL_ENV_KEY);
  const lineValue = readValue(env, SUPPORT_LINE_OA_ENV_KEY);

  const email: SupportChannel = {
    kind: 'email',
    envKey: SUPPORT_EMAIL_ENV_KEY,
    value: emailValue,
    href: emailValue ? `mailto:${emailValue}` : null,
    placeholder: emailValue ? null : placeholderFor(SUPPORT_EMAIL_ENV_KEY),
  };

  const line: SupportChannel = {
    kind: 'line',
    envKey: SUPPORT_LINE_OA_ENV_KEY,
    value: lineValue ? normalizeLineOaId(lineValue) : null,
    href: lineValue ? buildLineOaUrl(lineValue) : null,
    placeholder: lineValue ? null : placeholderFor(SUPPORT_LINE_OA_ENV_KEY),
  };

  const all = [email, line];
  const configured = all.filter((channel) => channel.value !== null);
  const unresolved = all.filter((channel) => channel.value === null);

  return {
    email,
    line,
    configured,
    unresolved,
    hasConfiguredChannel: configured.length > 0,
  };
}

/** Every configuration key this channel set needs the Owner to supply. */
export const SUPPORT_OWNER_INPUT_KEYS: readonly string[] = [
  SUPPORT_EMAIL_ENV_KEY,
  SUPPORT_LINE_OA_ENV_KEY,
];
