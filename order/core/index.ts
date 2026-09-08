export type OrderLifecycle = 'DRAFT' | 'SUBMITTED' | 'CONFIRMED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' | 'CANCELLED';
export type OrderPaymentState = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED';
export type DepositVerificationState = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type FulfillmentType = 'PICKUP' | 'DELIVERY' | 'ON_SITE_SERVICE';

const transitions: Readonly<Record<OrderLifecycle, readonly OrderLifecycle[]>> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'], SUBMITTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [],
};

export function assertOrderTransition(from: OrderLifecycle, to: OrderLifecycle): void {
  if (!transitions[from].includes(to)) throw new Error(`Invalid Order lifecycle transition: ${from} -> ${to}`);
}

export type CatalogOrderSource = Readonly<{ id: string; name: string; sku: string; unitPriceSatang: number; leadDays: number; capacityUnits: number }>;
export type OrderLineSnapshot = Readonly<CatalogOrderSource & { quantity: number; lineTotalSatang: number }>;

export function createOrderLineSnapshot(source: CatalogOrderSource, quantity: number): OrderLineSnapshot {
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('quantity must be a positive integer');
  if (!Number.isSafeInteger(source.unitPriceSatang) || source.unitPriceSatang < 0) throw new Error('unitPriceSatang must be a non-negative integer');
  if (!Number.isSafeInteger(source.leadDays) || source.leadDays < 0 || !Number.isSafeInteger(source.capacityUnits) || source.capacityUnits < 0) throw new Error('leadDays and capacityUnits must be non-negative integers');
  return Object.freeze({ ...source, quantity, lineTotalSatang: source.unitPriceSatang * quantity });
}

export function calculateOrderRequirements(lines: readonly OrderLineSnapshot[]): Readonly<{ requiredLeadDays: number; requiredCapacityUnits: number }> {
  if (lines.length === 0) throw new Error('Order requires at least one line');
  return Object.freeze({ requiredLeadDays: Math.max(...lines.map((line) => line.leadDays)), requiredCapacityUnits: lines.reduce((total, line) => total + line.quantity * line.capacityUnits, 0) });
}

export type CapacityDay = Readonly<{ date: string; isOpen: boolean; effectiveCapacityUnits: number; reservedUnits: number }>;
export function calculateEarliestReadyDate(input: Readonly<{ today: string; requiredLeadDays: number; requiredCapacityUnits: number; days: readonly CapacityDay[]; requestedReadyDate?: string }>): Readonly<{ scheduledProductionDate: string; promisedReadyDate: string; requestedDateFeasible: boolean }> {
  const earliest = new Date(`${input.today}T00:00:00Z`); earliest.setUTCDate(earliest.getUTCDate() + input.requiredLeadDays);
  const minimumDate = earliest.toISOString().slice(0, 10);
  const eligible = input.days.find((day) => day.date >= minimumDate && day.isOpen && day.effectiveCapacityUnits - day.reservedUnits >= input.requiredCapacityUnits);
  if (!eligible) throw new Error('No available production capacity in supplied calendar horizon');
  return Object.freeze({ scheduledProductionDate: eligible.date, promisedReadyDate: eligible.date, requestedDateFeasible: !input.requestedReadyDate || input.requestedReadyDate >= eligible.date });
}

export function canCreateBookingForOrder(order: Readonly<{ lifecycle: OrderLifecycle; appointmentRequired: boolean }>): boolean {
  return order.appointmentRequired && order.lifecycle === 'READY';
}

export function decideCancellationCapacityRelease(lifecycle: OrderLifecycle): 'RELEASE' | 'REQUIRES_PRIVILEGED_AUDIT' {
  if (lifecycle === 'CONFIRMED') return 'RELEASE';
  if (lifecycle === 'IN_PROGRESS' || lifecycle === 'READY') return 'REQUIRES_PRIVILEGED_AUDIT';
  throw new Error(`Order in ${lifecycle} has no cancellable production reservation`);
}

export interface OrderRepository { getById(shopId: string, orderId: string): Promise<unknown | null>; }
export interface AtomicOrderConfirmationPort { confirm(input: Readonly<{ shopId: string; orderId: string; idempotencyKey: string }>): Promise<unknown>; }
export interface PublicOrderTrackingPort { findByOpaqueToken(shopId: string, token: string): Promise<unknown | null>; }
export interface OrderBookingLinkPort { createIdempotentLink(input: Readonly<{ shopId: string; orderId: string; bookingId: string; idempotencyKey: string }>): Promise<unknown>; }

export function getOrderRuntimeUnavailable(): Readonly<{ submitPublicOrder(): Promise<Readonly<{ available: false; code: 'ORDER_RUNTIME_UNAVAILABLE' }>> }> {
  return Object.freeze({
    async submitPublicOrder() { return Object.freeze({ available: false as const, code: 'ORDER_RUNTIME_UNAVAILABLE' as const }); },
  });
}
