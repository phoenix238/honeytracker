import { describe, it, expect } from 'vitest';
import {
  ratesFor,
  incomeTax,
  class4,
  liability,
  personalAllowance,
  tradingProfit,
  paymentsOnAccount,
  paymentSchedule,
  estimateYear,
} from '../ukTax.js';
import { DEFAULT_TAX_YEAR_FACTS } from '../types.js';

const r = ratesFor(2026).rates;
const gbp = (pounds: number) => Math.round(pounds * 100);

describe('income tax (rUK 2026/27)', () => {
  it('is nothing within the personal allowance', () => {
    expect(incomeTax(gbp(12_570), r)).toBe(0);
  });
  it('charges 20% in the basic band', () => {
    expect(incomeTax(gbp(30_000), r)).toBe(gbp(3_486));
  });
  it('charges 40% above the basic band', () => {
    // 37,700 × 20% + 9,730 × 40%
    expect(incomeTax(gbp(60_000), r)).toBe(gbp(11_432));
  });
  it('withdraws the personal allowance above £100k', () => {
    expect(personalAllowance(gbp(110_000), r)).toBe(gbp(7_570));
    expect(personalAllowance(gbp(125_140), r)).toBe(0);
    // taxable 102,430: 37,700 × 20% + 64,730 × 40%
    expect(incomeTax(gbp(110_000), r)).toBe(gbp(33_432));
  });
  it('charges 45% above £125,140', () => {
    // taxable 150,000: 37,700 × 20% + 87,440 × 40% + 24,860 × 45%
    expect(incomeTax(gbp(150_000), r)).toBe(gbp(7_540) + gbp(34_976) + gbp(11_187));
  });
});

describe('Class 4 National Insurance', () => {
  it('is 6% between the limits and 2% above', () => {
    expect(class4(gbp(12_570), r)).toBe(0);
    expect(class4(gbp(30_000), r)).toBe(gbp(1_045.8));
    expect(class4(gbp(60_000), r)).toBe(gbp(2_262) + gbp(194.6));
  });
});

describe('liability', () => {
  it('is income tax + Class 4 for a sole trader with no job', () => {
    const l = liability(gbp(30_000), DEFAULT_TAX_YEAR_FACTS, r);
    expect(l.totalPence).toBe(gbp(3_486) + gbp(1_045.8));
  });
  it('taxes self-employed profit at the rate left over after a PAYE job', () => {
    const facts = { ...DEFAULT_TAX_YEAR_FACTS, employmentIncomePence: gbp(20_000), payeTaxPence: gbp(1_486) };
    const l = liability(gbp(10_000), facts, r);
    expect(l.incomeTaxPence).toBe(gbp(2_000)); // the whole 10k lands in the basic band
    expect(l.class4Pence).toBe(0); // profit under the Class 4 lower limit
    expect(l.payeAdjustmentPence).toBe(0);
    expect(l.totalPence).toBe(gbp(2_000));
  });
  it('adds any PAYE underpayment to the bill', () => {
    const facts = { ...DEFAULT_TAX_YEAR_FACTS, employmentIncomePence: gbp(20_000), payeTaxPence: gbp(1_000) };
    expect(liability(0, facts, r).totalPence).toBe(gbp(486));
  });
});

describe('trading allowance', () => {
  it('uses the £1,000 allowance when it beats actual expenses', () => {
    const t = tradingProfit([{ grossPence: gbp(5_000), allowableExpensesPence: gbp(300) }], r);
    expect(t.usesTradingAllowance).toBe(true);
    expect(t.profitPence).toBe(gbp(4_000));
  });
  it('uses actual expenses when they are bigger', () => {
    const t = tradingProfit([{ grossPence: gbp(5_000), allowableExpensesPence: gbp(1_500) }], r);
    expect(t.usesTradingAllowance).toBe(false);
    expect(t.profitPence).toBe(gbp(3_500));
  });
  it('does not let one stream’s loss wipe out another’s profit', () => {
    const t = tradingProfit(
      [
        { grossPence: gbp(20_000), allowableExpensesPence: gbp(2_000) },
        { grossPence: gbp(1_000), allowableExpensesPence: gbp(4_000) },
      ],
      r,
    );
    expect(t.profitPence).toBe(gbp(18_000));
  });
});

describe('payments on account', () => {
  it('are not asked for on a bill under £1,000', () => {
    expect(paymentsOnAccount(gbp(999), r)).toBe(0);
    expect(paymentsOnAccount(null, r)).toBe(0);
  });
  it('are half of last year’s bill each', () => {
    expect(paymentsOnAccount(gbp(3_000), r)).toBe(gbp(1_500));
  });
  it('build the January shock after a first big year', () => {
    // First year trading, 2025/26 bill £4,000, no payments on account yet.
    // 2026/27 bill projected at £6,000.
    const s = paymentSchedule({
      taxYear: 2026,
      previousLiabilityPence: gbp(4_000),
      previousPoaPence: 0,
      previousEstimated: false,
      thisYearLiabilityPence: gbp(6_000),
    });
    const jan27 = s.filter((p) => p.due === '2027-01-31').reduce((a, p) => a + p.amountPence, 0);
    const jul27 = s.filter((p) => p.due === '2027-07-31').reduce((a, p) => a + p.amountPence, 0);
    const jan28 = s.filter((p) => p.due === '2028-01-31').reduce((a, p) => a + p.amountPence, 0);
    expect(jan27).toBe(gbp(4_000) + gbp(2_000)); // whole 25/26 bill + half of it again
    expect(jul27).toBe(gbp(2_000));
    expect(jan28).toBe(gbp(2_000) + gbp(3_000)); // 26/27 balance + 1st POA for 27/28
  });
});

describe('estimateYear', () => {
  it('annualises so early-year income is taxed at the band the year will end in', () => {
    // Half a year in (6 Apr → ~5 Oct), £30k profit so far → ~£60k projected.
    const e = estimateYear(2026, gbp(30_000), DEFAULT_TAX_YEAR_FACTS, '2026-10-05');
    expect(e.projectionBasis).toBe('annualised');
    expect(e.projectedProfitPence).toBeGreaterThan(gbp(59_000));
    expect(e.setAsideRate).toBeGreaterThan(0.22);
    expect(e.accruedPence).toBe(Math.round(gbp(30_000) * e.setAsideRate));
  });
  it('prefers your own expected profit early in the year', () => {
    const facts = { ...DEFAULT_TAX_YEAR_FACTS, expectedProfitPence: gbp(40_000) };
    const e = estimateYear(2026, gbp(2_000), facts, '2026-05-01');
    expect(e.projectionBasis).toBe('expected');
    expect(e.projectedProfitPence).toBe(gbp(40_000));
  });
  it('flags a projection built on too few weeks', () => {
    const e = estimateYear(2026, gbp(2_000), DEFAULT_TAX_YEAR_FACTS, '2026-04-20');
    expect(e.lowConfidence).toBe(true);
  });
  it('takes off what has already been paid to HMRC', () => {
    const facts = { ...DEFAULT_TAX_YEAR_FACTS, paidToHmrcPence: gbp(1_000) };
    const e = estimateYear(2026, gbp(30_000), facts, '2027-04-05');
    expect(e.projectionBasis).toBe('complete');
    expect(e.owedNowPence).toBe(e.accruedPence - gbp(1_000));
  });
});
