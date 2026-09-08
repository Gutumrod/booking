export type OrderLifecycle = 'DRAFT' | 'SUBMITTED' | 'CONFIRMED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' | 'CANCELLED';
export type OrderPaymentState = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED';
export type DepositVerificationState = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type FulfillmentType = 'PICKUP' | 'DELIVERY' | 'ON_SITE_SERVICE';

const transitions: Readonly<Record<OrderLifecycle, readonly OrderLifecycle[]>> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'], SUBMITTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [],
};

const paymentTransitions: Readonly<Record<OrderPaymentState, readonly OrderPaymentState[]>> = {
  UNPAID: ['PARTIALLY_PAID', 'PAID'],
  PARTIALLY_PAID: ['PAID', 'REFUNDED'],
  PAID: ['REFUNDED'],
  REFUNDED: [],
};

const depositTransitions: Readonly<Record<DepositVerificationState, readonly DepositVerificationState[]>> = {
  PENDING: ['VERIFIED', 'REJECTED'],
  VERIFIED: [],
  REJECTED: ['PENDING'],
};

export function assertOrderTransition(from: OrderLifecycle, to: OrderLifecycle): void {
  if (!transitions[from].includes(to)) throw new Error(`Invalid Order lifecycle transition: ${from} -> ${to}`);
}

export function assertPaymentTransition(from: OrderPaymentState, to: OrderPaymentState): void {
  if (!paymentTransitions[from].includes(to)) throw new Error(`Invalid Order payment transition: ${from} -> ${to}`);
}

export function assertDepositVerificationTransition(from: DepositVerificationState, to: DepositVerificationState): void {
  if (!depositTransitions[from].includes(to)) throw new Error(`Invalid deposit verification transition: ${from} -> ${to}`);
}

export type OrderTransitionAudit = Readonly<{ actorId: string; reason: string; privilegedRecovery?: boolean }>;
export function transitionOrder(from: OrderLifecycle, to: OrderLifecycle, audit: OrderTransitionAudit): Readonly<{ from: OrderLifecycle; to: OrderLifecycle; actorId: string; reason: string }> {
  const recovery = audit.privilegedRecovery === true && ((from === 'CANCELLED' && to === 'SUBMITTED') || (from === 'COMPLETED' && to === 'READY'));
  if (!recovery) assertOrderTransition(from, to);
  if (!audit.actorId.trim() || !audit.reason.trim()) throw new Error('Order transition requires actorId and reason');
  return Object.freeze({ from, to, actorId: audit.actorId, reason: audit.reason });
}

export type CatalogOrderSource = Readonly<{ id: string; name: string; sku: string; unitPriceSatang: number; leadDays: number; capacityUnits: number; depositAmountSatang?: number; fulfillmentType?: FulfillmentType; appointmentRequired?: boolean }>;
export type OrderLineSnapshot = Readonly<CatalogOrderSource & { quantity: number; lineTotalSatang: number }>;

export function createOrderLineSnapshot(source: CatalogOrderSource, quantity: number): OrderLineSnapshot {
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('quantity must be a positive integer');
  if (!Number.isSafeInteger(source.unitPriceSatang) || source.unitPriceSatang < 0) throw new Error('unitPriceSatang must be a non-negative integer');
  if (!Number.isSafeInteger(source.leadDays) || source.leadDays < 0 || !Number.isSafeInteger(source.capacityUnits) || source.capacityUnits < 0) throw new Error('leadDays and capacityUnits must be non-negative integers');
  if (source.depositAmountSatang !== undefined && (!Number.isSafeInteger(source.depositAmountSatang) || source.depositAmountSatang < 0)) throw new Error('depositAmountSatang must be a non-negative integer');
  const lineTotalSatang = source.unitPriceSatang * quantity;
  if (!Number.isSafeInteger(lineTotalSatang)) throw new Error('lineTotalSatang exceeds safe integer range');
  return Object.freeze({ ...source, quantity, lineTotalSatang });
}

export function calculateOrderRequirements(lines: readonly OrderLineSnapshot[]): Readonly<{ requiredLeadDays: number; requiredCapacityUnits: number }> {
  if (lines.length === 0) throw new Error('Order requires at least one line');
  const requiredCapacityUnits = lines.reduce((total, line) => {
    const lineCapacity = line.quantity * line.capacityUnits;
    const nextTotal = total + lineCapacity;
    if (!Number.isSafeInteger(lineCapacity) || !Number.isSafeInteger(nextTotal)) throw new Error('requiredCapacityUnits exceeds safe integer range');
    return nextTotal;
  }, 0);
  return Object.freeze({ requiredLeadDays: Math.max(...lines.map((line) => line.leadDays)), requiredCapacityUnits });
}

export type CapacityDay = Readonly<{ date: string; isOpen: boolean; effectiveCapacityUnits: number; reservedUnits: number }>;
export type WeeklyCapacityRule = Readonly<{ weekday: number; isOpen: boolean; baseCapacityUnits: number }>;
export type CapacityDayOverride = Readonly<{ date: string; isOpen?: boolean; effectiveCapacityUnits?: number }>;
function parseIsoDate(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be an ISO date`);
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${field} must be a valid ISO date`);
  return date;
}

export function materializeCapacityDays(input: Readonly<{ fromDate: string; throughDate: string; weekly: readonly WeeklyCapacityRule[]; overrides: readonly CapacityDayOverride[]; reservedByDate: Readonly<Record<string, number>> }>): readonly CapacityDay[] {
  const start = parseIsoDate(input.fromDate, 'fromDate'); const end = parseIsoDate(input.throughDate, 'throughDate');
  if (start > end) throw new Error('Invalid calendar range');
  if (input.weekly.some((rule) => !Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6 || !Number.isSafeInteger(rule.baseCapacityUnits) || rule.baseCapacityUnits < 0)) throw new Error('Invalid weekly capacity rule');
  if (new Set(input.weekly.map((rule) => rule.weekday)).size !== input.weekly.length) throw new Error('Duplicate weekly capacity rule');
  if (input.overrides.some((override) => parseIsoDate(override.date, 'override date') < start || parseIsoDate(override.date, 'override date') > end)) throw new Error('Override date outside calendar range');
  if (new Set(input.overrides.map((override) => override.date)).size !== input.overrides.length) throw new Error('Duplicate capacity override');
  const result: CapacityDay[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10); const rule = input.weekly.find((item) => item.weekday === cursor.getUTCDay()); const override = input.overrides.find((item) => item.date === date);
    const capacity = override?.effectiveCapacityUnits ?? rule?.baseCapacityUnits ?? 0; const reserved = input.reservedByDate[date] ?? 0;
    if (!Number.isSafeInteger(capacity) || capacity < 0 || !Number.isSafeInteger(reserved) || reserved < 0 || reserved > capacity) throw new Error('Invalid calendar capacity');
    result.push(Object.freeze({ date, isOpen: override?.isOpen ?? rule?.isOpen ?? false, effectiveCapacityUnits: capacity, reservedUnits: reserved }));
  }
  return Object.freeze(result);
}
export function calculateEarliestReadyDate(input: Readonly<{ today: string; requiredLeadDays: number; requiredCapacityUnits: number; days: readonly CapacityDay[]; requestedReadyDate?: string }>): Readonly<{ scheduledProductionDate: string; promisedReadyDate: string; requestedDateFeasible: boolean }> {
  if (!Number.isSafeInteger(input.requiredLeadDays) || input.requiredLeadDays < 0 || !Number.isSafeInteger(input.requiredCapacityUnits) || input.requiredCapacityUnits < 1) throw new Error('Invalid readiness input');
  const earliest = parseIsoDate(input.today, 'today'); earliest.setUTCDate(earliest.getUTCDate() + input.requiredLeadDays);
  if (input.requestedReadyDate) parseIsoDate(input.requestedReadyDate, 'requestedReadyDate');
  const minimumDate = earliest.toISOString().slice(0, 10);
  const sortedDays = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of sortedDays) {
    parseIsoDate(day.date, 'capacity day');
    if (!Number.isSafeInteger(day.effectiveCapacityUnits) || !Number.isSafeInteger(day.reservedUnits) || day.effectiveCapacityUnits < 0 || day.reservedUnits < 0 || day.reservedUnits > day.effectiveCapacityUnits) throw new Error('Invalid capacity day');
  }
  const isEligible = (day: CapacityDay) => day.date >= minimumDate && day.isOpen && day.effectiveCapacityUnits - day.reservedUnits >= input.requiredCapacityUnits;
  const eligible = sortedDays.find(isEligible);
  if (!eligible) throw new Error('No available production capacity in supplied calendar horizon');
  const requestedDay = input.requestedReadyDate ? sortedDays.find((day) => day.date === input.requestedReadyDate) : undefined;
  return Object.freeze({ scheduledProductionDate: eligible.date, promisedReadyDate: eligible.date, requestedDateFeasible: !input.requestedReadyDate || Boolean(requestedDay && isEligible(requestedDay)) });
}

export function canCreateBookingForOrder(order: Readonly<{ lifecycle: OrderLifecycle; appointmentRequired: boolean }>): boolean {
  return order.appointmentRequired && order.lifecycle === 'READY';
}

export function decideCancellationCapacityRelease(lifecycle: OrderLifecycle): 'RELEASE' | 'REQUIRES_PRIVILEGED_AUDIT' {
  if (lifecycle === 'CONFIRMED') return 'RELEASE';
  if (lifecycle === 'IN_PROGRESS' || lifecycle === 'READY') return 'REQUIRES_PRIVILEGED_AUDIT';
  throw new Error(`Order in ${lifecycle} has no cancellable production reservation`);
}

export function decideSequentialReservation(input: Readonly<{ effectiveCapacityUnits: number; reservedUnits: number; requestedUnits: number }>): Readonly<{ accepted: boolean; nextReservedUnits: number }> {
  const values = [input.effectiveCapacityUnits, input.reservedUnits, input.requestedUnits];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0) || input.reservedUnits > input.effectiveCapacityUnits || input.requestedUnits < 1) throw new Error('Invalid reservation input');
  const candidate = input.reservedUnits + input.requestedUnits;
  return Object.freeze(candidate <= input.effectiveCapacityUnits ? { accepted: true, nextReservedUnits: candidate } : { accepted: false, nextReservedUnits: input.reservedUnits });
}

export interface CatalogReadRepository { listForShop(input: Readonly<{ shopId: string; catalogId: string }>): Promise<readonly CatalogOrderSource[]>; }
export interface OrderRepository { getById(shopId: string, orderId: string): Promise<unknown | null>; save(shopId: string, order: unknown, idempotencyKey: string): Promise<unknown>; }
export interface CapacityCalendarRepository { listCandidateDays(input: Readonly<{ shopId: string; fromDate: string; throughDate: string }>): Promise<readonly CapacityDay[]>; }
export interface AtomicOrderConfirmationPort { confirm(input: Readonly<{ shopId: string; orderId: string; idempotencyKey: string }>): Promise<unknown>; }
export type PublicOrderLineSelection = Readonly<{ catalogProductId: string; quantity: number }>;
export interface PublicOrderSubmitPort { submit(input: Readonly<{ shopId: string; idempotencyKey: string; selections: readonly PublicOrderLineSelection[]; requestedReadyDate?: string; fulfillmentType: FulfillmentType }>): Promise<unknown>; }
export interface PublicOrderTrackingPort { findByOpaqueToken(input: Readonly<{ shopId: string; opaqueToken: string }>): Promise<unknown | null>; }
export interface OrderBookingLinkPort { createIdempotentLink(input: Readonly<{ shopId: string; orderId: string; bookingId: string; idempotencyKey: string }>): Promise<unknown>; }

export function getOrderRuntimeUnavailable(): Readonly<{ submitPublicOrder(): Promise<Readonly<{ available: false; code: 'ORDER_RUNTIME_UNAVAILABLE' }>> }> {
  return Object.freeze({
    async submitPublicOrder() { return Object.freeze({ available: false as const, code: 'ORDER_RUNTIME_UNAVAILABLE' as const }); },
  });
}
