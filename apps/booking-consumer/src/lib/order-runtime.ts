export type ProductionOrderRuntimeStatus = Readonly<{ available: false; code: 'ORDER_RUNTIME_UNAVAILABLE' }>;

export function getProductionOrderRuntimeStatus(): ProductionOrderRuntimeStatus {
  return Object.freeze({ available: false, code: 'ORDER_RUNTIME_UNAVAILABLE' });
}
