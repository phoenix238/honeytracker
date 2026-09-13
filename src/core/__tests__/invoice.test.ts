import { describe, it, expect } from 'vitest';
import { invoiceTotalPence, lineTotalPence, nextInvoiceNumber } from '../invoice';
import type { Invoice } from '../types';

describe('lineTotalPence', () => {
  it('multiplies qty by unit price', () => {
    expect(lineTotalPence({ qty: 2, unitPence: 16000 })).toBe(32000);
  });
});

describe('invoiceTotalPence', () => {
  it('sums all lines', () => {
    const total = invoiceTotalPence({
      lines: [
        { id: '1', label: 'Brand day', qty: 1, unitPence: 48000 },
        { id: '2', label: 'Revisions', qty: 2, unitPence: 16000 },
      ],
    });
    expect(total).toBe(80000);
  });

  it('is zero with no lines', () => {
    expect(invoiceTotalPence({ lines: [] })).toBe(0);
  });
});

describe('nextInvoiceNumber', () => {
  const inv = (number: string): Invoice => ({
    id: number,
    number,
    client: 'x',
    lines: [],
    dueDate: '2026-01-01',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00Z',
  });

  it('starts at HP-0001 with no invoices', () => {
    expect(nextInvoiceNumber([])).toBe('HP-0001');
  });

  it('increments past the highest existing number', () => {
    expect(nextInvoiceNumber([inv('HP-0001'), inv('HP-0143'), inv('HP-0002')])).toBe('HP-0144');
  });
});
