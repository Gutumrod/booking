// Public Claim — customer-facing contract + fail-closed reference adapter.
//
// Claim is NOT a new lifecycle engine. The existing Ticket/Case domain
// (TICKET_MIGRATION_HANDOFF.md) stays authoritative. This module defines the
// customer-visible shape of a public claim, the mapping into the canonical
// Ticket type/status enums WITHOUT changing them, the server-boundary
// validation (pure, reused by the future live adapter), and a production
// adapter that is fail-closed: it validates shape/authority and then truthfully
// reports CLAIM_RUNTIME_NOT_ENABLED. It never fabricates an id or a success.
//
// Single standalone module on purpose — no sibling relative imports — so the
// pure logic runs under the repo's `node --test` runner as-is. The post-gate
// live adapter goes in its own file and implements `PublicClaimAdapter`.
//
// Source of truth: docs/order/03_PUBLIC_PORTAL_CLAIM_AND_PARALLEL_EXECUTION_DECISION_2026-09-08.md

/** Truthful signal returned everywhere the live Claim runtime is not wired up. */
export const CLAIM_RUNTIME_NOT_ENABLED = 'CLAIM_RUNTIME_NOT_ENABLED' as const;

// --- Customer categories -> canonical Ticket type -----------------------------

export const CLAIM_CATEGORIES = ['product', 'service', 'recheck', 'refund', 'other'] as const;
export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];

// Canonical Ticket `type` enum — mirror of local_service.create_ticket
// validation. Do NOT edit here; kept only to prove the mapping stays in range.
export const CANONICAL_TICKET_TYPES = [
  'ProductClaim',
  'ServiceIssue',
  'RecheckRequest',
  'RefundRequest',
  'Other',
] as const;
export type CanonicalTicketType = (typeof CANONICAL_TICKET_TYPES)[number];

const CATEGORY_TO_TICKET_TYPE: Record<ClaimCategory, CanonicalTicketType> = {
  product: 'ProductClaim',
  service: 'ServiceIssue',
  recheck: 'RecheckRequest',
  refund: 'RefundRequest',
  other: 'Other',
};

export function claimCategoryToTicketType(category: ClaimCategory): CanonicalTicketType {
  return CATEGORY_TO_TICKET_TYPE[category] ?? 'Other';
}

export function isClaimCategory(value: unknown): value is ClaimCategory {
  return typeof value === 'string' && (CLAIM_CATEGORIES as readonly string[]).includes(value);
}

// --- Claim origin ------------------------------------------------------------

export type ClaimOrigin =
  | { kind: 'booking'; manageToken: string }
  | { kind: 'order'; trackingToken: string }
  | { kind: 'standalone' };

export type ClaimOriginKind = ClaimOrigin['kind'];

// --- Customer-submitted input ----------------------------------------------

export type PublicClaimInput = {
  shopSlug: string;
  origin: ClaimOrigin;
  customerName: string;
  customerPhone: string;
  contactChannel?: string;
  /** Free text for the product/service when there is no verified reference. */
  relatedProductService?: string;
  category: ClaimCategory;
  description: string;
  occurredAt?: string | null;
  /** Client-generated idempotency key; retries must reuse the same value. */
  idempotencyKey: string;
};

/**
 * Internal Ticket fields the customer must NEVER control. The public adapter
 * strips anything under these keys before it reaches the Ticket authority; the
 * future live RPC path sets them from server-side defaults only.
 */
export const CUSTOMER_FORBIDDEN_TICKET_FIELDS = [
  'priority',
  'dueAt',
  'due_at',
  'assignedTo',
  'assigned_to',
  'assignee',
  'status',
  'resolution',
  'receivedAt',
  'received_at',
  'shopId',
  'shop_id',
  'bookingId',
  'booking_id',
  'serviceId',
  'service_id',
  'normalizedPhone',
  'normalized_phone',
] as const;

export function stripForbiddenClaimFields<T extends Record<string, unknown>>(raw: T): Partial<T> {
  const forbidden = CUSTOMER_FORBIDDEN_TICKET_FIELDS as readonly string[];
  const out: Partial<T> = {};
  for (const key of Object.keys(raw)) {
    if (forbidden.includes(key)) continue;
    out[key as keyof T] = raw[key] as T[keyof T];
  }
  return out;
}

// --- Reference / token plausibility (client-side gate only) ------------------

const RAW_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_RE = /^[+()\d][\d\s()+-]{5,19}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** A raw DB row id (UUID) is never sufficient claim authority on its own. */
export function isRawUuid(value: string): boolean {
  return RAW_UUID_RE.test(value.trim());
}

export function looksLikePhone(value: string): boolean {
  const v = value.trim();
  if (!PHONE_RE.test(v)) return false;
  const digits = v.replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 15;
}

/**
 * Client-side plausibility gate for a customer-held reference token
 * (booking manage token, order tracking token, or claim tracking token).
 * Real validation is server-side against the row once the runtime gate opens.
 * Rejects naked row ids and phone numbers outright.
 */
export function isPlausibleReferenceToken(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 6 || v.length > 200) return false;
  if (isRawUuid(v)) return false;
  if (looksLikePhone(v)) return false;
  return /^[A-Za-z0-9_.:-]+$/.test(v);
}

// --- Public projections (what a customer may see) --------------------------

export type PublicClaimStatus =
  | 'received'
  | 'in_review'
  | 'waiting_for_you'
  | 'resolved'
  | 'closed';

/**
 * Coarse map from the internal Ticket status set to the customer-facing status.
 * Internal-only states collapse; assignee/notes/timeline never cross this line.
 */
export function toPublicClaimStatus(internalStatus: string): PublicClaimStatus {
  switch (internalStatus) {
    case 'New':
    case 'Acknowledged':
      return 'received';
    case 'InReview':
    case 'RecheckScheduled':
      return 'in_review';
    case 'WaitingForCustomer':
      return 'waiting_for_you';
    case 'Resolved':
      return 'resolved';
    case 'Closed':
      return 'closed';
    default:
      return 'received';
  }
}

/** The only fields a public tracking response may carry. */
export const PUBLIC_CLAIM_TRACKING_FIELDS = [
  'publicRef',
  'status',
  'submittedAt',
  'updatedAt',
  'merchantMessage',
] as const;

export type PublicClaimTracking = {
  publicRef: string;
  status: PublicClaimStatus;
  submittedAt: string;
  updatedAt: string;
  /** Only set if the future adapter contract explicitly exposes a merchant note. */
  merchantMessage: string | null;
};

/** Whitelist projection — drops any private Ticket field that leaked in. */
export function projectPublicClaimTracking(raw: Record<string, unknown>): PublicClaimTracking {
  return {
    publicRef: String(raw.publicRef ?? ''),
    status: (raw.status as PublicClaimStatus) ?? 'received',
    submittedAt: String(raw.submittedAt ?? ''),
    updatedAt: String(raw.updatedAt ?? ''),
    merchantMessage:
      typeof raw.merchantMessage === 'string' && raw.merchantMessage.length > 0
        ? raw.merchantMessage
        : null,
  };
}

// --- Adapter interface + fail-closed production implementation --------------

export type ClaimErrorCode =
  | typeof CLAIM_RUNTIME_NOT_ENABLED
  | 'CLAIM_NOT_ENABLED_FOR_SHOP'
  | 'INVALID_SHOP'
  | 'INVALID_REFERENCE'
  | 'INVALID_INPUT';

export type ClaimUnavailable = { ok: false; code: ClaimErrorCode };

export type PublicClaimContext = {
  ok: true;
  shopSlug: string;
  shopName: string | null;
  claimEnabled: boolean;
  origin: ClaimOriginKind;
};

export type ClaimSubmitOk = {
  ok: true;
  publicRef: string;
  status: PublicClaimStatus;
};

/** Tracking result on the wire — discriminated so callers can narrow on `ok`. */
export type PublicClaimTrackingResult =
  | ({ ok: true } & PublicClaimTracking)
  | ClaimUnavailable;

/** Public capability inputs; production carries only the booking signal. */
export type PublicClaimCapabilitySource = {
  isAcceptingOnlineBookings?: boolean | null;
  claimEnabled?: boolean | null;
};

export type ClaimContextRequest = {
  shopSlug: string;
  origin: ClaimOriginKind;
  token?: string;
  capabilitySource?: PublicClaimCapabilitySource | null;
  shopName?: string | null;
};

export type ClaimTrackingRequest = { token: string };

export interface PublicClaimAdapter {
  getPublicClaimContext(
    req: ClaimContextRequest,
  ): Promise<PublicClaimContext | ClaimUnavailable>;
  submitPublicClaim(input: PublicClaimInput): Promise<ClaimSubmitOk | ClaimUnavailable>;
  getPublicClaimTracking(
    req: ClaimTrackingRequest,
  ): Promise<PublicClaimTrackingResult>;
}

export function validateClaimContextRequest(
  req: ClaimContextRequest,
): ClaimUnavailable | null {
  if (!req.shopSlug || !SLUG_RE.test(req.shopSlug)) {
    return { ok: false, code: 'INVALID_SHOP' };
  }
  if ((req.origin === 'booking' || req.origin === 'order') && !isPlausibleReferenceToken(req.token)) {
    return { ok: false, code: 'INVALID_REFERENCE' };
  }
  return null;
}

export function validateClaimSubmission(input: PublicClaimInput): ClaimUnavailable | null {
  if (!input.shopSlug || !SLUG_RE.test(input.shopSlug)) {
    return { ok: false, code: 'INVALID_SHOP' };
  }
  if (
    !input.customerName?.trim() ||
    !input.customerPhone?.trim() ||
    !input.description?.trim()
  ) {
    return { ok: false, code: 'INVALID_INPUT' };
  }
  if (!isClaimCategory(input.category)) {
    return { ok: false, code: 'INVALID_INPUT' };
  }
  if (!input.idempotencyKey || input.idempotencyKey.trim().length < 8) {
    return { ok: false, code: 'INVALID_INPUT' };
  }
  // A naked booking/order id is never sufficient — only a customer-held token.
  if (
    input.origin.kind === 'booking' &&
    !isPlausibleReferenceToken(input.origin.manageToken)
  ) {
    return { ok: false, code: 'INVALID_REFERENCE' };
  }
  if (
    input.origin.kind === 'order' &&
    !isPlausibleReferenceToken(input.origin.trackingToken)
  ) {
    return { ok: false, code: 'INVALID_REFERENCE' };
  }
  return null;
}

export function validateTrackingRequest(req: ClaimTrackingRequest): ClaimUnavailable | null {
  // Phone/email/order-number alone must never resolve a claim.
  if (!isPlausibleReferenceToken(req.token)) {
    return { ok: false, code: 'INVALID_REFERENCE' };
  }
  return null;
}

export function isClaimUnavailable(value: { ok: boolean }): value is ClaimUnavailable {
  return value.ok === false;
}

export const productionClaimAdapter: PublicClaimAdapter = {
  async getPublicClaimContext(req) {
    const invalid = validateClaimContextRequest(req);
    if (invalid) return invalid;

    // Only the public booking signal exists today; Claim has no live capability
    // source, so `claimEnabled` is always false until the shared-runtime gate.
    if (req.capabilitySource?.claimEnabled !== true) {
      return { ok: false, code: 'CLAIM_NOT_ENABLED_FOR_SHOP' };
    }

    // Unreachable in production today. Kept explicit so the post-gate adapter
    // has an obvious place to return a real context.
    return { ok: false, code: CLAIM_RUNTIME_NOT_ENABLED };
  },

  async submitPublicClaim(input) {
    const invalid = validateClaimSubmission(input);
    if (invalid) return invalid;

    // Shape is acceptable, but there is no authorized live Ticket/Case write
    // path. Never invent an id or a successful claim state.
    return { ok: false, code: CLAIM_RUNTIME_NOT_ENABLED };
  },

  async getPublicClaimTracking(req) {
    const invalid = validateTrackingRequest(req);
    if (invalid) return invalid;

    return { ok: false, code: CLAIM_RUNTIME_NOT_ENABLED };
  },
};
