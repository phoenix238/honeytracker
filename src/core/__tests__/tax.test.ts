import { describe, it, expect } from 'vitest';
import { deriveTotals } from '../tax';
import type { Income, Expense, Settings } from '../types';

const income = (grossPence: number): Income => ({
  id: 'i' + grossPence,
  date: '2026-05-01',
  grossPence,
  method: 'bank',
  createdAt: '2026-05-01T00:00:00Z',
});
const expense = (amountPence: number, deductible = true): Expense => ({
  id: 'e' + amountPence + deductible,
  date: '2026-05-02',
  amountPence,
  category: 'other',
  deductible,
  createdAt: '2026-05-02T00:00:00Z',
});
const settings = (taxPercent: number): Settings => ({
  name: '',
  business: '',
  taxPercent,
  defaultRatePence: 3500,
  theme: 'light',
  taxSavedPence: 0,
});

describe('deriveTotals', () => {
  it('derives the full picture from facts', () => {
    const t = deriveTotals([income(100000), income(50000)], [expense(30000)], settings(20));
    expect(t.grossPence).toBe(150000);
    expect(t.deductibleExpensesPence).toBe(30000);
    expect(t.taxableProfitPence).toBe(120000);
    expect(t.taxStashPence).toBe(24000); // 20% of profit after costs
    expect(t.safeStashPence).toBe(30000); // 20% of all gross
    expect(t.takeHomePence).toBe(96000);
  });

  it('HONOURS the tax-rate setting — the original bug', () => {
    const facts: [Income[], Expense[]] = [[income(100000)], []];
    expect(deriveTotals(...facts, settings(20)).taxStashPence).toBe(20000);
    expect(deriveTotals(...facts, settings(30)).taxStashPence).toBe(30000);
    expect(deriveTotals(...facts, settings(0)).taxStashPence).toBe(0);
    // Same stored facts, different setting, different result — retroactively correct.
  });

  it('ignores non-deductible expenses in the profit calc', () => {
    const t = deriveTotals([income(100000)], [expense(20000, false)], settings(20));
    expect(t.deductibleExpensesPence).toBe(0);
    expect(t.taxableProfitPence).toBe(100000);
  });

  it('floors taxable profit at zero when costs exceed income', () => {
    const t = deriveTotals([income(10000)], [expense(30000)], settings(20));
    expect(t.taxableProfitPence).toBe(0);
    expect(t.taxStashPence).toBe(0);
    expect(t.takeHomePence).toBe(0);
    // safe stash still reflects gross received
    expect(t.safeStashPence).toBe(2000);
  });

  it('is empty-safe', () => {
    const t = deriveTotals([], [], settings(20));
    expect(t).toMatchObject({ grossPence: 0, taxStashPence: 0, takeHomePence: 0 });
  });
});
