export function assertSameShop(expectedShopId: string, referencedShopId: string): void {
  if (!expectedShopId || expectedShopId !== referencedShopId) throw new Error('Cross-shop reference rejected');
}

export function isOpaqueTrackingToken(token: string): boolean {
  return /^trk_[a-z0-9]{12,}$/i.test(token) && !/^trk_0+$/.test(token);
}

export function publicOrderProjection(order: Readonly<{ orderId: string; customerPhone: string; lifecycle: string; totalSatang: number }>): Readonly<{ orderId: string; lifecycle: string }> {
  return Object.freeze({ orderId: order.orderId, lifecycle: order.lifecycle });
}
