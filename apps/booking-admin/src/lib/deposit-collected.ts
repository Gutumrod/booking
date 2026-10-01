/**
 * B8b — "deposit collected" is a question about money, not about appointments.
 *
 * The card used to sum `status === 'confirmed'`, so the figure collapsed the
 * moment the shop pressed completed / no_show even though the money was still in
 * the shop's account. The honest total is the sum of every deposit the shop has
 * received and still holds: refunded rows (B8) drop out.
 *
 * The "is the shop holding this money?" rule is `holdsDepositMoney()` in
 * refund-eligibility.ts — the same predicate the refund eligibility uses — so the
 * card and the refund feature cannot drift apart.
 */

import { holdsDepositMoney } from './refund-eligibility';

export type DepositCollectedRow = {
  depositStatus: string;
  depositPrice: number;
};

/** Total deposit the shop has actually taken in and not yet refunded. */
export function depositCollectedTotal(rows: ReadonlyArray<DepositCollectedRow>): number {
  return rows.reduce(
    (sum, row) => sum + (holdsDepositMoney(row.depositStatus) ? row.depositPrice : 0),
    0,
  );
}
