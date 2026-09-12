import type { Income, Expense, Settings, Pence } from './types';
import { percentOf, sumPence } from './money';

// The single source of every money figure the app shows. The old app froze `tax` and `net`
// onto each record at creation and recomputed stashes in a dozen places against a hardcoded
// 20% — so the "Tax set-aside %" setting changed nothing, and old records stayed wrong. Here
// nothing is stored derived: give this function the facts and the current settings and it
// returns today's correct numbers, retroactively, from one place.

export interface Totals {
  /** Everything received. */
  grossPence: Pence;
  /** Deductible business costs only. */
  deductibleExpensesPence: Pence;
  /** Gross minus deductible costs, floored at zero. */
  taxableProfitPence: Pence;
  /** Set-aside on profit after costs — the realistic figure. */
  taxStashPence: Pence;
  /** Set-aside on ALL gross, ignoring costs — the safe figure if expenses are disallowed. */
  safeStashPence: Pence;
  /** Profit minus the (realistic) tax stash. */
  takeHomePence: Pence;
}

export function taxRate(settings: Settings): number {
  return settings.taxPercent ?? 20;
}

export function deriveTotals(
  income: readonly Income[],
  expenses: readonly Expense[],
  settings: Settings,
): Totals {
  const grossPence = sumPence(income.map((i) => i.grossPence));
  const deductibleExpensesPence = sumPence(
    expenses.filter((e) => e.deductible).map((e) => e.amountPence),
  );
  const taxableProfitPence = Math.max(0, grossPence - deductibleExpensesPence);
  const rate = taxRate(settings);
  const taxStashPence = percentOf(taxableProfitPence, rate);
  const safeStashPence = percentOf(grossPence, rate);
  return {
    grossPence,
    deductibleExpensesPence,
    taxableProfitPence,
    taxStashPence,
    safeStashPence,
    takeHomePence: taxableProfitPence - taxStashPence,
  };
}
