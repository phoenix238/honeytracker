import type { Invoice, InvoiceLine, IsoDate, Pence, Transaction } from './types.js';
import { addDays } from './dates.js';
import { formatGBP } from './money.js';

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

/** Hours between two clock times ("10:00", "13:30"); an end before the start runs past midnight. */
export function hoursBetween(start: string, end: string): number | null {
  const m = (t: string) => {
    const hit = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    return hit && Number(hit[1]) < 24 && Number(hit[2]) < 60 ? Number(hit[1]) * 60 + Number(hit[2]) : null;
  };
  const a = m(start);
  const b = m(end);
  if (a === null || b === null || a === b) return null;
  return Math.round((((b - a + 1440) % 1440) / 60) * 100) / 100;
}

/** "Tue 3 Sep" */
export function dayLabel(date: IsoDate): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** An invoice line's wording for time worked: "Tue 3 Sep, 10:00–13:00 · Shift". */
export function timedDescription(date: IsoDate, start: string | null, end: string | null, what = ''): string {
  return [`${dayLabel(date)}${start && end ? `, ${start}–${end}` : ''}`, what.trim()].filter(Boolean).join(' · ');
}

/** "INV" + 57 → "INV57": no padding zeros, so the number is exactly the one you count to. */
export function formatInvoiceNumber(prefix: string, n: number): string {
  return `${prefix}${n}`;
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

/**
 * Every payment in that could have settled this invoice, best first: the exact amount, then the
 * rest by how close the amount is — for a client who paid a little less or more, or paid two
 * invoices in one go. Nothing already settling an invoice, and no transfers between your own accounts.
 */
export function possiblePayments(inv: Invoice, txns: readonly Transaction[], limit = 15): Transaction[] {
  const total = invoiceTotal(inv);
  const from = addDays(inv.issueDate, -7);
  const score = (t: Transaction) => (mentionsInvoice(t, inv.number) ? 0 : 1) * 1e12 + Math.abs(t.amountPence - total) * 1e3 + Math.abs(Date.parse(t.date) - Date.parse(inv.issueDate)) / 8.64e7;
  return txns
    .filter((t) => t.direction === 'in' && t.date >= from && !t.meta.invoiceId && t.bucket !== 'transfer' && t.bucket !== 'personal')
    .sort((a, b) => score(a) - score(b))
    .slice(0, limit);
}

/** Letters only, and no "Ltd": "ETHICAL CAFF LTD" and "Ethical Caff Limited" read the same. */
function nameKey(s: string): string {
  return s.toLowerCase().replace(/\b(ltd|limited|plc|llp|the)\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();
}

/**
 * The open invoice a payment coming in most likely settles, or null. It has to be the only one
 * that fits: the invoice number in the reference, or the client's name in the payer — the
 * amount only settles a tie. A name alone for someone with two open invoices isn't enough.
 */
export function invoiceGuess(t: Pick<Transaction, 'direction' | 'amountPence' | 'counterparty' | 'reference' | 'meta'>, invoices: readonly Invoice[]): Invoice | null {
  if (t.direction !== 'in' || t.meta.invoiceId) return null;
  const open = openInvoices(invoices);
  const byNumber = open.filter((i) => mentionsInvoice(t, i.number));
  if (byNumber.length === 1) return byNumber[0]!;
  const payer = nameKey(`${t.counterparty} ${t.reference}`);
  const byName = open.filter((i) => {
    const client = nameKey(i.clientName);
    return client.length >= 3 && (payer.includes(client) || (payer.length >= 3 && client.includes(nameKey(t.counterparty)) && nameKey(t.counterparty).length >= 3));
  });
  if (byName.length === 1) return byName[0]!;
  const exact = byName.filter((i) => invoiceTotal(i) === t.amountPence);
  return exact.length === 1 ? exact[0]! : null;
}

/** "paid £5.13 less" / "paid £10.00 more" when a payment isn't the invoice's exact total; '' when it is. */
export function paidDifference(paidPence: Pence, inv: Invoice): string {
  const diff = paidPence - invoiceTotal(inv);
  return diff === 0 ? '' : `paid ${formatGBP(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'}`;
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
