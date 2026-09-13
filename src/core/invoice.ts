import type { Invoice, InvoiceLine, Pence } from './types';
import { sumPence } from './money';

/** An invoice's total is derived from its lines, never stored separately. */
export function invoiceTotalPence(invoice: Pick<Invoice, 'lines'>): Pence {
  return sumPence(invoice.lines.map((l) => lineTotalPence(l)));
}

export function lineTotalPence(line: Pick<InvoiceLine, 'qty' | 'unitPence'>): Pence {
  return Math.round(line.qty * line.unitPence);
}

/** "HP-0001" style, one past the highest existing number. */
export function nextInvoiceNumber(existing: readonly Invoice[]): string {
  const max = existing.reduce((m, inv) => {
    const n = parseInt(inv.number.replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `HP-${String(max + 1).padStart(4, '0')}`;
}
