import { describe, it, expect } from 'vitest';
import { invoiceTotal, invoiceState, mentionsInvoice, invoiceForPayment, paymentCandidates, owedSummary, formatInvoiceNumber, daysOverdue, hoursBetween, lineWhen, hasWorkDates, lateFeesByDefault, lateNoteFor, possiblePayments, invoiceGuess } from '../invoices';
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
    expect(formatInvoiceNumber('INV', 42)).toBe('INV42');
    expect(formatInvoiceNumber('INV-', 7)).toBe('INV-7');
  });
});

describe('matching payments to invoices', () => {
  it('spots the invoice number however the payer typed it', () => {
    expect(mentionsInvoice({ reference: 'inv 0042', counterparty: '' }, 'INV-0042')).toBe(true);
    expect(mentionsInvoice({ reference: 'INV0042 thanks', counterparty: '' }, 'INV-0042')).toBe(true);
    expect(mentionsInvoice({ reference: 'INV-00421', counterparty: '' }, 'INV-0042')).toBe(false);
    expect(mentionsInvoice({ reference: 'lunch', counterparty: '' }, 'INV-0042')).toBe(false);
    // Without padding, INV5 must still never be read out of INV57.
    expect(mentionsInvoice({ reference: 'INV57', counterparty: '' }, 'INV5')).toBe(false);
    expect(mentionsInvoice({ reference: 'inv 5 thanks', counterparty: '' }, 'INV5')).toBe(true);
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

describe('time on invoices', () => {
  it('works out hours from start and end, past midnight too', () => {
    expect(hoursBetween('10:00', '13:30')).toBe(3.5);
    expect(hoursBetween('22:00', '01:15')).toBe(3.25);
    expect(hoursBetween('9:45', '10:05')).toBe(0.33);
    expect(hoursBetween('10:00', '10:00')).toBeNull();
    expect(hoursBetween('25:00', '10:00')).toBeNull();
  });
  it('writes the line the way a client reads it', () => {
    expect(lineWhen({ date: '2026-09-03', start: '10:00', end: '13:00' })).toEqual({ day: 'Thu 3 Sep 2026', time: '10:00–13:00' });
    expect(lineWhen({ date: '2026-09-03' })).toEqual({ day: 'Thu 3 Sep 2026', time: '' });
    expect(lineWhen({})).toEqual({ day: '', time: '' });
    expect(hasWorkDates([{ description: 'x', quantity: 1, unitPence: 1 }])).toBe(false);
    expect(hasWorkDates([{ description: 'x', quantity: 1, unitPence: 1 }, { description: 'y', quantity: 1, unitPence: 1, date: '2026-09-03' }])).toBe(true);
  });
});

describe('payments that don’t match exactly', () => {
  const sent = (over: Partial<Invoice>) => inv({ status: 'sent', ...over });
  it('lists every payment in that could be it — exact first, then the nearest amounts', () => {
    const i = sent({ id: 'a', number: 'INV57', issueDate: '2026-09-01', lines: [{ description: 'x', quantity: 1, unitPence: 14513 }] });
    const exact = txn({ direction: 'in', amountPence: 14513, date: '2026-09-20' });
    const short = txn({ direction: 'in', amountPence: 14000, date: '2026-09-10' });
    const far = txn({ direction: 'in', amountPence: 2000, date: '2026-09-05' });
    const before = txn({ direction: 'in', amountPence: 14513, date: '2026-08-01' });
    const taken = txn({ direction: 'in', amountPence: 14513, date: '2026-09-12', meta: { invoiceId: 'other' } });
    const mine = txn({ direction: 'in', amountPence: 14513, date: '2026-09-12', bucket: 'transfer' });
    expect(possiblePayments(i, [far, short, exact, before, taken, mine]).map((t) => t.id)).toEqual([exact.id, short.id, far.id]);
  });
  it('puts a payment from the client by name above another client’s of the same amount', () => {
    const i = sent({ number: 'INV57', clientName: 'Sam Client', issueDate: '2026-09-20', lines: [{ description: 'x', quantity: 1, unitPence: 6500 }] });
    const lara = txn({ direction: 'in', amountPence: 6000, date: '2026-09-19', counterparty: 'Lara Bligh' });
    const sam = txn({ direction: 'in', amountPence: 6000, date: '2026-09-27', counterparty: 'SAM CLIENT' });
    const quoted = txn({ direction: 'in', amountPence: 100, date: '2026-09-30', counterparty: 'X', reference: 'INV57' });
    expect(possiblePayments(i, [lara, sam, quoted]).map((t) => t.id)).toEqual([quoted.id, sam.id, lara.id]);
  });
  it('guesses the invoice from the payer’s name or the number — only when there’s one that fits', () => {
    const caff = sent({ id: 'c', number: 'INV57', clientName: 'Ethical Caff Ltd', lines: [{ description: 'x', quantity: 1, unitPence: 14513 }] });
    const sam = sent({ id: 's', number: 'INV58', clientName: 'Sam Client', lines: [{ description: 'x', quantity: 1, unitPence: 6000 }] });
    expect(invoiceGuess(txn({ direction: 'in', amountPence: 14000, counterparty: 'ETHICAL CAFF LIMITED' }), [caff, sam])?.id).toBe('c');
    expect(invoiceGuess(txn({ direction: 'in', amountPence: 6000, counterparty: 'S CLIENT', reference: 'inv 58' }), [caff, sam])?.id).toBe('s');
    expect(invoiceGuess(txn({ direction: 'in', amountPence: 6000, counterparty: 'Someone Else' }), [caff, sam])).toBeNull();
    const caff2 = sent({ id: 'c2', number: 'INV59', clientName: 'Ethical Caff Ltd', lines: [{ description: 'x', quantity: 1, unitPence: 5000 }] });
    expect(invoiceGuess(txn({ direction: 'in', amountPence: 5000, counterparty: 'ETHICAL CAFF' }), [caff, caff2])?.id).toBe('c2'); // two open: the amount decides
    expect(invoiceGuess(txn({ direction: 'in', amountPence: 1, counterparty: 'ETHICAL CAFF' }), [caff, caff2])).toBeNull();
    expect(invoiceGuess(txn({ direction: 'out', amountPence: 6000, counterparty: 'Sam Client' }), [sam])).toBeNull();
  });
});

describe('late fees', () => {
  it('are on for business work and off for private-client work until you choose', () => {
    for (const name of ['Coffee', 'Ethical Caff', 'Media', 'Filming & photos', 'Odd jobs']) expect(lateFeesByDefault(name)).toBe(true);
    for (const name of ['Craniosacral therapy', 'CST sessions', 'CSTL practice', 'Massage', 'Bodywork']) expect(lateFeesByDefault(name)).toBe(false);
  });
  it('print only on invoices for a stream that has them on', () => {
    const streams = [{ id: 'coffee', lateFees: true }, { id: 'cst', lateFees: false }];
    const profile = { lateNote: 'Pay up.' };
    expect(lateNoteFor('coffee', streams, profile)).toBe('Pay up.');
    expect(lateNoteFor('cst', streams, profile)).toBe('');
    expect(lateNoteFor(null, streams, profile)).toBe('');
  });
});
