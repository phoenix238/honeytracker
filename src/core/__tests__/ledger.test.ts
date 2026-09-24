import { describe, it, expect } from 'vitest';
import { summarise, taxPicture, reviewState, quarterlySummaries, needsReceipt } from '../ledger.js';
import { DEFAULT_SETTINGS, type Stream } from '../types.js';
import { txn } from './fixtures.js';

const year = { from: '2026-04-06', to: '2027-04-05' };
const streams: Stream[] = [
  { id: 'cstl', name: 'CSTL', kind: 'self_employment', color: '#e0a92e', archived: false, about: '' },
  { id: 'refunds', name: 'Other', kind: 'other', color: '#888', archived: false, about: '' },
];

describe('summarise', () => {
  it('adds income, subtracts refunds, and splits expenses by category', () => {
    const rows = [
      txn({ bucket: 'business_income', streamId: 'cstl', amountPence: 8_000 }),
      txn({ bucket: 'business_income', streamId: 'cstl', amountPence: 1_000, direction: 'out' }), // refund to a client
      txn({ bucket: 'business_expense', streamId: 'cstl', direction: 'out', amountPence: 3_000, category: 'premisesRunningCosts' }),
      txn({ bucket: 'business_expense', streamId: 'cstl', direction: 'out', amountPence: 4_000, category: 'adminCosts', businessPercent: 50 }),
      txn({ bucket: 'business_expense', streamId: 'cstl', direction: 'out', amountPence: 2_500, category: 'businessEntertainmentCosts' }),
      txn({ bucket: 'personal', direction: 'out', amountPence: 99_999 }),
      txn({ bucket: 'business_income', streamId: 'cstl', amountPence: 5_000, date: '2026-04-05' }), // last tax year
    ];
    const [s] = summarise(rows, year);
    expect(s!.turnoverPence).toBe(7_000);
    expect(s!.expensesByCategory.premisesRunningCosts).toBe(3_000);
    expect(s!.expensesByCategory.adminCosts).toBe(2_000);
    expect(s!.allowableExpensesPence).toBe(5_000);
    expect(s!.disallowableExpensesPence).toBe(2_500);
    expect(s!.profitPence).toBe(2_000);
  });

  it('keeps business rows with no stream visible rather than dropping them', () => {
    const s = summarise([txn({ bucket: 'business_income', amountPence: 500 })], year);
    expect(s).toHaveLength(1);
    expect(s[0]!.streamId).toBeNull();
    expect(s[0]!.turnoverPence).toBe(500);
  });
});

describe('reviewState', () => {
  it('counts what still needs doing', () => {
    const rows = [
      txn({ bucket: 'unreviewed' }),
      txn({ bucket: 'business_income' }), // no stream
      txn({ bucket: 'business_expense', streamId: 'cstl', direction: 'out', category: 'adminCosts' }), // no receipt
      txn({ bucket: 'business_expense', streamId: 'cstl', direction: 'out', category: 'adminCosts', receiptIds: ['r1'], classifiedBy: 'rule' }),
    ];
    expect(reviewState(rows, DEFAULT_SETTINGS)).toEqual({ unreviewed: 1, noStream: 1, missingReceipts: 1, autoClassified: 1, aiToCheck: 0 });
  });
  it('only asks for receipts above the threshold', () => {
    const small = txn({ bucket: 'business_expense', direction: 'out', amountPence: 300 });
    expect(needsReceipt(small, { ...DEFAULT_SETTINGS, receiptThresholdPence: 500 })).toBe(false);
  });
});

describe('quarterlySummaries', () => {
  it('reports each MTD period and the running year-to-date', () => {
    const rows = [
      txn({ bucket: 'business_income', streamId: 'cstl', amountPence: 1_000, date: '2026-05-01' }),
      txn({ bucket: 'business_income', streamId: 'cstl', amountPence: 2_000, date: '2026-08-01' }),
    ];
    const q = quarterlySummaries(rows, 2026);
    expect(q[1]!.period[0]!.turnoverPence).toBe(2_000);
    expect(q[1]!.cumulative[0]!.turnoverPence).toBe(3_000);
    expect(q[1]!.deadline).toBe('2026-11-07');
  });
});

describe('taxPicture', () => {
  it('ignores streams that are not self-employment', () => {
    const rows = [
      txn({ bucket: 'business_income', streamId: 'cstl', amountPence: 2_000_000, date: '2026-06-01' }),
      txn({ bucket: 'business_income', streamId: 'refunds', amountPence: 9_000_000, date: '2026-06-01' }),
    ];
    const p = taxPicture(rows, streams, DEFAULT_SETTINGS, '2027-04-05');
    // £20k gross, no costs: the £1,000 trading allowance beats £0 of expenses.
    expect(p.trading.usesTradingAllowance).toBe(true);
    expect(p.trading.profitPence).toBe(1_900_000);
  });

  it('includes last year’s unpaid bill in the pot until its deadline passes', () => {
    const rows = [txn({ bucket: 'business_income', streamId: 'cstl', amountPence: 3_000_000, date: '2025-10-01' })];
    const before = taxPicture(rows, streams, DEFAULT_SETTINGS, '2026-09-24');
    expect(before.previous.estimated).toBe(true);
    expect(before.previous.liabilityPence).toBeGreaterThan(0);
    expect(before.potTargetPence).toBe(before.previous.liabilityPence);
    expect(before.upcoming.some((p) => p.due === '2027-01-31')).toBe(true);
  });

  it('uses HMRC’s real figure for last year when entered', () => {
    const settings = { ...DEFAULT_SETTINGS, taxYears: { '2026': { ...DEFAULT_SETTINGS.taxYears['2026'], employmentIncomePence: 0, payeTaxPence: 0, priorYearLiabilityPence: 123_400, paidToHmrcPence: 0, expectedProfitPence: null } } };
    const p = taxPicture([], streams, settings, '2026-09-24');
    expect(p.previous.estimated).toBe(false);
    expect(p.previous.liabilityPence).toBe(123_400);
  });
});
