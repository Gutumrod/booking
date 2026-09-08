import type { DepositVerificationState, OrderLifecycle, OrderPaymentState } from '../../../../order/core/index';

export type OrderAdminListItem = Readonly<{ shopId: string; orderId: string; lifecycle: OrderLifecycle; paymentState: OrderPaymentState; depositState: DepositVerificationState; promisedReadyDate: string | null }>;
export type ReadyDateOverrideRequest = Readonly<{ orderId: string; nextReadyDate: string; actorId: string; reason: string }>;

export const orderAdminRuntimeStatus = Object.freeze({ available: false, reason: 'ORDER_RUNTIME_UNAVAILABLE' as const });
