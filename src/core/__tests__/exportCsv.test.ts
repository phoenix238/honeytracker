import { describe, it, expect } from 'vitest';
import { ledgerCsv } from '../exportCsv.js';
import { txn } from './fixtures.js';

describe('ledger CSV', () => {
  it('keeps a refund’s business amount a negative number, not text', () => {
    const refund = txn({ direction: 'in', amountPence: 1200, bucket: 'business_expense', category: 'adminCosts', streamId: null });
    const line = ledgerCsv([refund], []).split('\n')[1]!;
    expect(line).toContain(',-12.00,');
    expect(line).not.toContain("'-12.00");
  });
  it('still neutralises formulas hidden in bank text', () => {
    const t = txn({ counterparty: '=HYPERLINK("x")', reference: '-1+2', note: '\tlead' });
    const line = ledgerCsv([t], []).split('\n')[1]!;
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain("'-1+2");
    expect(line).toContain("'\tlead");
  });
});
