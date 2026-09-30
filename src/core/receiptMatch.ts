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

const DAY = 86_400_000;

/**
 * Receipts not yet attached to anything that could explain this bank line — a Gmail receipt the
 * Google finder brought in, or a photo you snapped — best first: same amount (±1p), nearest date.
 * Online orders are often emailed a few days before or after the card is charged, so the window
 * is a week each side.
 */
export function receiptsFor(t: Pick<Transaction, 'direction' | 'amountPence' | 'date'>, receipts: readonly Receipt[], windowDays = 7): Receipt[] {
  if (t.direction !== 'out') return [];
  const at = Date.parse(t.date);
  return receipts
    .filter((r) => !r.transactionId && r.totalPence != null && r.date && Math.abs(r.totalPence - t.amountPence) <= 1 && Math.abs(Date.parse(r.date) - at) <= windowDays * DAY)
    .sort((a, b) => Math.abs(Date.parse(a.date!) - at) - Math.abs(Date.parse(b.date!) - at));
}

/** Where a receipt came from, in words for a person: Gmail, Drive, or a photo you took. */
export function receiptOrigin(r: Pick<Receipt, 'description' | 'filename' | 'mime'>): string {
  if (/\(from Gmail/.test(r.description)) return 'from your email';
  if (/\(from Google Drive\)/.test(r.description)) return 'from Drive';
  if (/^(message|email)|\.eml$/i.test(r.filename) || /^text\/plain/.test(r.mime)) return 'from your email';
  return 'you snapped it';
}

/**
 * Every receipt not yet attached to anything, best guess first, for picking one by hand when
 * no automatic match was found: the same amount near the date first, then the closest amounts
 * (a tip added, a receipt with a typo), then ones with no total read at all.
 */
export function looseReceiptsFor(t: Pick<Transaction, 'amountPence' | 'date'>, receipts: readonly Receipt[], limit = 12): Receipt[] {
  const at = Date.parse(t.date);
  const score = (r: Receipt) => {
    const days = r.date ? Math.abs(Date.parse(r.date) - at) / DAY : 365;
    if (r.totalPence == null) return 2e9 + days;
    const off = Math.abs(r.totalPence - t.amountPence);
    return (off <= 1 && days <= 7 ? 0 : 1e9) + off * 10 + days;
  };
  return receipts.filter((r) => !r.transactionId).sort((a, b) => score(a) - score(b)).slice(0, limit);
}
