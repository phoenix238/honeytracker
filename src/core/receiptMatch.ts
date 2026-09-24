import type { Receipt, Transaction } from './types.js';
import { addDays } from './dates.js';

// Pair a receipt with the bank line it explains. Card payments settle a day or few after the
// receipt is printed, and hotels/online orders can go either way, so the window is a few days
// each side. The amount must match to the penny (±1p for rounding on foreign/VAT receipts).

const WINDOW_DAYS = 5;

export function receiptCandidates(receipt: Receipt, txns: readonly Transaction[]): Transaction[] {
  if (receipt.totalPence == null || !receipt.date) return [];
  const from = addDays(receipt.date, -WINDOW_DAYS);
  const to = addDays(receipt.date, WINDOW_DAYS);
  const total = receipt.totalPence;
  const target = new Date(receipt.date).getTime();
  return txns
    .filter(
      (t) =>
        t.direction === 'out' &&
        t.bucket !== 'transfer' &&
        Math.abs(t.amountPence - total) <= 1 &&
        t.date >= from &&
        t.date <= to &&
        !t.receiptIds.includes(receipt.id),
    )
    .sort((a, b) => {
      // Rows still missing evidence first, then the nearest date.
      const needA = a.receiptIds.length === 0 ? 0 : 1;
      const needB = b.receiptIds.length === 0 ? 0 : 1;
      if (needA !== needB) return needA - needB;
      return Math.abs(new Date(a.date).getTime() - target) - Math.abs(new Date(b.date).getTime() - target);
    });
}

/** The one row to attach automatically, or null when it isn't unambiguous. */
export function autoMatch(receipt: Receipt, txns: readonly Transaction[]): Transaction | null {
  const c = receiptCandidates(receipt, txns).filter((t) => t.receiptIds.length === 0);
  return c.length === 1 ? c[0]! : null;
}
