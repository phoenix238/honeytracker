import type { Invoice, InvoiceLine, IsoDate, Pence, Transaction } from './types.js';
import { addDays } from './dates.js';

// Invoices: totals, where each one stands, and finding the bank payment that settles it.
// Everything here is derived — an invoice stores its lines and dates, never a frozen total
// or a "paid" flag.

export function lineAmount(l: InvoiceLine): Pence {
  return Math.round(l.quantity * l.unitPence);
}

export function invoiceTotal(inv: Pick<Invoice, 'lines'>): Pence {
  return inv.lines.reduce((sum, l) => sum + lineAmount(l), 0);
}

export type InvoiceState = 'draft' | 'open' | 'overdue' | 'paid' | 'void';

export function invoiceState(inv: Invoice, today: IsoDate): InvoiceState {
  if (inv.status === 'void') return 'void';
  if (inv.paidTransactionId) return 'paid';
  if (inv.status === 'draft') return 'draft';
  return today > inv.dueDate ? 'overdue' : 'open';
}

export function daysOverdue(inv: Invoice, today: IsoDate): number {
  if (today <= inv.dueDate) return 0;
  return Math.round((Date.parse(today) - Date.parse(inv.dueDate)) / 86_400_000);
}

export function formatInvoiceNumber(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(4, '0')}`;
}

/** Letters and digits only, upper-cased: "inv-0042" and "INV 0042" compare equal. */
function squash(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Whether a bank line names this invoice — in its reference or payer text. */
export function mentionsInvoice(t: Pick<Transaction, 'reference' | 'counterparty'>, number: string): boolean {
  const target = squash(number);
  if (target.length < 3) return false;
  for (const text of [t.reference, t.counterparty]) {
    const hay = squash(text);
    let at = hay.indexOf(target);
    while (at !== -1) {
      // "INV0042" must not match inside "INV00421".
      const next = hay[at + target.length];
      if (next === undefined || !/\d/.test(next)) return true;
      at = hay.indexOf(target, at + 1);
    }
  }
  return false;
}

/** Invoices that can still be paid: sent, not void, not already settled. */
export function openInvoices(invoices: readonly Invoice[]): Invoice[] {
  return invoices.filter((i) => i.status === 'sent' && !i.paidTransactionId);
}

/**
 * The invoice a bank payment settles, when it's certain: the payer used the invoice number as
 * the reference AND paid the exact amount. Anything less certain is left for you to confirm.
 */
export function invoiceForPayment(t: Transaction, invoices: readonly Invoice[]): Invoice | null {
  if (t.direction !== 'in' || t.meta.invoiceId) return null;
  const hits = openInvoices(invoices).filter((i) => mentionsInvoice(t, i.number) && invoiceTotal(i) === t.amountPence);
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Money in that could be this invoice's payment, best first: the right amount, arriving on or
 * after (a few days before, for early payers) the issue date, not already settling something.
 */
export function paymentCandidates(inv: Invoice, txns: readonly Transaction[]): Transaction[] {
  const total = invoiceTotal(inv);
  const from = addDays(inv.issueDate, -3);
  return txns
    .filter((t) => t.direction === 'in' && t.amountPence === total && t.date >= from && !t.meta.invoiceId && t.bucket !== 'transfer')
    .sort((a, b) => {
      const ra = mentionsInvoice(a, inv.number) ? 0 : 1;
      const rb = mentionsInvoice(b, inv.number) ? 0 : 1;
      return ra - rb || a.date.localeCompare(b.date);
    });
}

export interface OwedSummary {
  count: number;
  totalPence: Pence;
  overdueCount: number;
  overduePence: Pence;
}

export function owedSummary(invoices: readonly Invoice[], today: IsoDate): OwedSummary {
  const out: OwedSummary = { count: 0, totalPence: 0, overdueCount: 0, overduePence: 0 };
  for (const inv of invoices) {
    const st = invoiceState(inv, today);
    if (st !== 'open' && st !== 'overdue') continue;
    const total = invoiceTotal(inv);
    out.count++;
    out.totalPence += total;
    if (st === 'overdue') {
      out.overdueCount++;
      out.overduePence += total;
    }
  }
  return out;
}

/** Clients you've invoiced before, most recent first — for quick re-use. */
export function pastClients(invoices: readonly Invoice[]): { name: string; email: string; address: string; streamId: string | null; lastLine: InvoiceLine | null }[] {
  const seen = new Map<string, { name: string; email: string; address: string; streamId: string | null; lastLine: InvoiceLine | null }>();
  for (const inv of [...invoices].sort((a, b) => b.issueDate.localeCompare(a.issueDate))) {
    const key = inv.clientName.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.set(key, { name: inv.clientName, email: inv.clientEmail, address: inv.clientAddress, streamId: inv.streamId, lastLine: inv.lines[0] ?? null });
  }
  return [...seen.values()];
}
