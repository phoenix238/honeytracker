import { describe, it, expect } from 'vitest';
import { invoiceTotal, invoiceState, mentionsInvoice, invoiceForPayment, paymentCandidates, owedSummary, formatInvoiceNumber, daysOverdue } from '../invoices';
import type { Invoice } from '../types';
import { txn } from './fixtures';

const inv = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'i1',
  number: 'INV-0042',
  streamId: 'media',
  clientName: 'Studio Ltd',
  clientEmail: '',
  clientAddress: '',
  issueDate: '2026-09-01',
  dueDate: '2026-09-15',
  lines: [
    { description: 'Edit, 10–13', quantity: 3, unitPence: 1650 },
    { description: 'Travel', quantity: 1, unitPence: 1000 },
  ],
  notes: '',
  status: 'sent',
  paidTransactionId: null,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('invoice totals and state', () => {
  it('adds up lines, including part-hours', () => {
    expect(invoiceTotal(inv())).toBe(5950);
    expect(invoiceTotal(inv({ lines: [{ description: '', quantity: 2.5, unitPence: 1650 }] }))).toBe(4125);
  });
  it('knows open, overdue, paid, draft and void', () => {
    expect(invoiceState(inv(), '2026-09-10')).toBe('open');
    expect(invoiceState(inv(), '2026-09-20')).toBe('overdue');
    expect(daysOverdue(inv(), '2026-09-20')).toBe(5);
    expect(invoiceState(inv({ paidTransactionId: 't' }), '2026-09-20')).toBe('paid');
    expect(invoiceState(inv({ status: 'draft' }), '2026-09-20')).toBe('draft');
    expect(invoiceState(inv({ status: 'void' }), '2026-09-20')).toBe('void');
  });
  it('numbers invoices', () => {
    expect(formatInvoiceNumber('INV-', 42)).toBe('INV-0042');
  });
});

describe('matching payments to invoices', () => {
  it('spots the invoice number however the payer typed it', () => {
    expect(mentionsInvoice({ reference: 'inv 0042', counterparty: '' }, 'INV-0042')).toBe(true);
    expect(mentionsInvoice({ reference: 'INV0042 thanks', counterparty: '' }, 'INV-0042')).toBe(true);
    expect(mentionsInvoice({ reference: 'INV-00421', counterparty: '' }, 'INV-0042')).toBe(false);
    expect(mentionsInvoice({ reference: 'lunch', counterparty: '' }, 'INV-0042')).toBe(false);
  });
  it('settles automatically only on reference AND exact amount', () => {
    const invoices = [inv()];
    expect(invoiceForPayment(txn({ direction: 'in', amountPence: 5950, reference: 'INV-0042' }), invoices)?.id).toBe('i1');
    expect(invoiceForPayment(txn({ direction: 'in', amountPence: 5000, reference: 'INV-0042' }), invoices)).toBeNull();
    expect(invoiceForPayment(txn({ direction: 'in', amountPence: 5950, reference: 'other' }), invoices)).toBeNull();
    expect(invoiceForPayment(txn({ direction: 'in', amountPence: 5950, reference: 'INV-0042' }), [inv({ status: 'draft' })])).toBeNull();
  });
  it('suggests payments of the right amount, the referenced one first', () => {
    const plain = txn({ direction: 'in', amountPence: 5950, date: '2026-09-05' });
    const referenced = txn({ direction: 'in', amountPence: 5950, date: '2026-09-09', reference: 'INV-0042' });
    const tooEarly = txn({ direction: 'in', amountPence: 5950, date: '2026-08-01' });
    const taken = txn({ direction: 'in', amountPence: 5950, date: '2026-09-06', meta: { invoiceId: 'other' } });
    expect(paymentCandidates(inv(), [plain, referenced, tooEarly, taken]).map((t) => t.id)).toEqual([referenced.id, plain.id]);
  });
});

describe('owed summary', () => {
  it('totals what is still owed and what is late', () => {
    const s = owedSummary([inv(), inv({ id: 'i2', dueDate: '2026-12-01' }), inv({ id: 'i3', paidTransactionId: 't' }), inv({ id: 'i4', status: 'draft' })], '2026-09-20');
    expect(s).toEqual({ count: 2, totalPence: 11900, overdueCount: 1, overduePence: 5950 });
  });
});
