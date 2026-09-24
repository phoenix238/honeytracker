import type { Pence, IsoDate, TaxYearFacts } from './types.js';
import { daysInclusive, taxYearBounds } from './dates.js';

// UK (England, Wales & NI) self-employed tax, worked out properly rather than as a flat
// percentage. A flat 20% is wrong in both directions: it ignores the personal allowance
// (overstating tax on small profits), and it ignores Class 4 National Insurance, the 40%
// band, and the personal-allowance taper (understating it on larger ones). It also says
// nothing about WHEN the money is due — payments on account mean the first January after a
// good year can ask for ~150% of that year's bill.
//
// Scope, stated honestly: non-savings income only; no Scottish rates; no student loan,
// Marriage Allowance, pension relief, Gift Aid or High Income Child Benefit Charge; trading
// losses are not offset between trades. Every figure is an estimate for setting money aside,
// not a filed calculation.

export interface TaxRates {
  personalAllowance: Pence;
  /** Allowance is withdrawn £1 for every £2 of income above this. */
  taperThreshold: Pence;
  basicRateBand: Pence;
  /** Taxable income above this is taxed at the additional rate. */
  additionalThreshold: Pence;
  basicRate: number;
  higherRate: number;
  additionalRate: number;
  class4LowerLimit: Pence;
  class4UpperLimit: Pence;
  class4MainRate: number;
  class4UpperRate: number;
  /** Trading allowance: can be claimed instead of actual expenses. */
  tradingAllowance: Pence;
  /** Below this, payments on account aren't asked for. */
  poaThreshold: Pence;
}

// Thresholds have been frozen since 2021/22; Class 4 dropped to 6% from 2024/25.
const FROZEN_2024: TaxRates = {
  personalAllowance: 1_257_000,
  taperThreshold: 10_000_000,
  basicRateBand: 3_770_000,
  additionalThreshold: 12_514_000,
  basicRate: 20,
  higherRate: 40,
  additionalRate: 45,
  class4LowerLimit: 1_257_000,
  class4UpperLimit: 5_027_000,
  class4MainRate: 6,
  class4UpperRate: 2,
  tradingAllowance: 100_000,
  poaThreshold: 100_000,
};

const RATES: Record<number, TaxRates> = {
  2024: FROZEN_2024,
  2025: FROZEN_2024,
  2026: FROZEN_2024,
};

const LATEST_KNOWN = Math.max(...Object.keys(RATES).map(Number));

export function ratesFor(taxYear: number): { rates: TaxRates; assumed: boolean } {
  const known = RATES[taxYear];
  if (known) return { rates: known, assumed: false };
  // An unknown year borrows the nearest known one, and says so.
  const nearest = taxYear > LATEST_KNOWN ? LATEST_KNOWN : Math.min(...Object.keys(RATES).map(Number));
  return { rates: RATES[nearest]!, assumed: true };
}

const pct = (p: Pence, rate: number): Pence => Math.round((p * rate) / 100);

export function personalAllowance(totalIncome: Pence, r: TaxRates): Pence {
  const over = Math.max(0, totalIncome - r.taperThreshold);
  return Math.max(0, r.personalAllowance - Math.floor(over / 2));
}

/** Income tax on a year's total non-savings income. */
export function incomeTax(totalIncome: Pence, r: TaxRates): Pence {
  const taxable = Math.max(0, totalIncome - personalAllowance(totalIncome, r));
  const basic = Math.min(taxable, r.basicRateBand);
  const additional = Math.max(0, taxable - r.additionalThreshold);
  const higher = taxable - basic - additional;
  return pct(basic, r.basicRate) + pct(higher, r.higherRate) + pct(additional, r.additionalRate);
}

/** Class 4 National Insurance on self-employed profit. */
export function class4(profit: Pence, r: TaxRates): Pence {
  const main = Math.max(0, Math.min(profit, r.class4UpperLimit) - r.class4LowerLimit);
  const upper = Math.max(0, profit - r.class4UpperLimit);
  return pct(main, r.class4MainRate) + pct(upper, r.class4UpperRate);
}

export interface TradingProfit {
  /** Profit actually used: the lower of "gross − expenses" and "gross − trading allowance". */
  profitPence: Pence;
  usesTradingAllowance: boolean;
  /** Under the allowance entirely: no tax, and no need to register for this income alone. */
  fullyCoveredByAllowance: boolean;
}

/**
 * Taxable trading profit across all self-employments. Losses in one stream are NOT set
 * against another (that needs a claim), so each stream's profit is floored at zero.
 */
export function tradingProfit(
  streams: readonly { grossPence: Pence; allowableExpensesPence: Pence }[],
  r: TaxRates,
): TradingProfit {
  const gross = streams.reduce((s, x) => s + x.grossPence, 0);
  const expensesRoute = streams.reduce((s, x) => s + Math.max(0, x.grossPence - x.allowableExpensesPence), 0);
  const allowanceRoute = Math.max(0, gross - r.tradingAllowance);
  const usesTradingAllowance = gross > 0 && allowanceRoute < expensesRoute;
  return {
    profitPence: usesTradingAllowance ? allowanceRoute : expensesRoute,
    usesTradingAllowance,
    fullyCoveredByAllowance: gross > 0 && gross <= r.tradingAllowance,
  };
}

export interface Liability {
  /** Income tax caused by the self-employed profit (on top of any job). */
  incomeTaxPence: Pence;
  class4Pence: Pence;
  /** Tax due on the job's pay minus what PAYE already took (negative = overpaid). */
  payeAdjustmentPence: Pence;
  /** The Self Assessment bill: everything above, floored at zero. */
  totalPence: Pence;
}

/** The Self Assessment bill for a year, given its self-employed profit and PAYE facts. */
export function liability(profit: Pence, facts: TaxYearFacts, r: TaxRates): Liability {
  const emp = facts.employmentIncomePence;
  const taxOnJob = incomeTax(emp, r);
  const incomeTaxPence = incomeTax(emp + profit, r) - taxOnJob;
  const class4Pence = class4(profit, r);
  const payeAdjustmentPence = taxOnJob - facts.payeTaxPence;
  return {
    incomeTaxPence,
    class4Pence,
    payeAdjustmentPence,
    totalPence: Math.max(0, incomeTaxPence + class4Pence + payeAdjustmentPence),
  };
}

export interface YearEstimate {
  taxYear: number;
  ratesAssumed: boolean;
  profitSoFarPence: Pence;
  /** Best guess of the whole year's profit. */
  projectedProfitPence: Pence;
  /** How the projection was made — "your figure", or scaled up from the days so far. */
  projectionBasis: 'expected' | 'annualised' | 'complete';
  /** True when annualising from too few weeks to trust. */
  lowConfidence: boolean;
  /** The bill for the whole year on the projected profit. */
  projectedLiability: Liability;
  /** Tax per £ of profit on the projection — the "put this much aside from every payment" rate. */
  setAsideRate: number;
  /** Tax already built up on the profit made so far. */
  accruedPence: Pence;
  /** Accrued, less what's already been paid to HMRC for this year. */
  owedNowPence: Pence;
}

/**
 * Estimate a tax year from the profit made so far. The projection scales the year-to-date
 * up to a full year (or uses your own figure, when given, early in the year) so the rate
 * reflects the band you'll END in, not the one you're in today — otherwise April's income
 * looks tax-free and March's looks punishing.
 */
export function estimateYear(
  taxYear: number,
  profitSoFarPence: Pence,
  facts: TaxYearFacts,
  asOf: IsoDate,
): YearEstimate {
  const { rates, assumed } = ratesFor(taxYear);
  const { from, to } = taxYearBounds(taxYear);
  const total = daysInclusive(from, to);
  const elapsed = asOf < from ? 0 : asOf > to ? total : daysInclusive(from, asOf);

  let projectedProfitPence: Pence;
  let projectionBasis: YearEstimate['projectionBasis'];
  if (elapsed >= total) {
    projectedProfitPence = profitSoFarPence;
    projectionBasis = 'complete';
  } else if (facts.expectedProfitPence != null && (elapsed < 90 || facts.expectedProfitPence > profitSoFarPence)) {
    projectedProfitPence = Math.max(facts.expectedProfitPence, profitSoFarPence);
    projectionBasis = 'expected';
  } else {
    projectedProfitPence = elapsed > 0 ? Math.round((profitSoFarPence * total) / elapsed) : profitSoFarPence;
    projectionBasis = 'annualised';
  }
  const lowConfidence = projectionBasis === 'annualised' && elapsed < 60;

  const projectedLiability = liability(projectedProfitPence, facts, rates);
  const seTax = projectedLiability.incomeTaxPence + projectedLiability.class4Pence;
  const setAsideRate = projectedProfitPence > 0 ? seTax / projectedProfitPence : 0;
  // The PAYE adjustment belongs to the whole year, so it accrues with time, not profit.
  const payeShare = Math.round((projectedLiability.payeAdjustmentPence * elapsed) / total);
  const accruedPence = Math.max(0, Math.round(profitSoFarPence * setAsideRate) + payeShare);

  return {
    taxYear,
    ratesAssumed: assumed,
    profitSoFarPence,
    projectedProfitPence,
    projectionBasis,
    lowConfidence,
    projectedLiability,
    setAsideRate,
    accruedPence,
    owedNowPence: Math.max(0, accruedPence - facts.paidToHmrcPence),
  };
}

export interface Payment {
  due: IsoDate;
  label: string;
  amountPence: Pence;
  /** Whether this is a guess from an unfinished year, or a fixed figure. */
  estimated: boolean;
}

/** Payments on account for a year, from the previous year's bill. */
export function paymentsOnAccount(priorLiability: Pence | null, r: TaxRates): Pence {
  if (priorLiability == null || priorLiability < r.poaThreshold) return 0;
  return Math.round(priorLiability / 2);
}

/**
 * HMRC's payment calendar around tax year `taxYear` (Y):
 *   31 Jan Y+1 — balancing payment for Y−1, plus the 1st payment on account for Y
 *   31 Jul Y+1 — 2nd payment on account for Y
 *   31 Jan Y+2 — balancing payment for Y, plus the 1st payment on account for Y+1
 *
 * Payments on account are each half of the PREVIOUS year's bill, so a year where income
 * jumps produces a large January: that year's balance plus half of it again in advance.
 * (The "80% already collected through PAYE" exemption isn't modelled.)
 */
export function paymentSchedule(args: {
  taxYear: number;
  previousLiabilityPence: Pence | null;
  previousPoaPence: Pence;
  previousEstimated: boolean;
  thisYearLiabilityPence: Pence;
}): Payment[] {
  const Y = args.taxYear;
  const { rates } = ratesFor(Y);
  const out: Payment[] = [];
  const poaThis = paymentsOnAccount(args.previousLiabilityPence, rates);
  const label = (y: number) => `${y}/${String((y + 1) % 100).padStart(2, '0')}`;

  if (args.previousLiabilityPence != null) {
    const balancingPrev = Math.max(0, args.previousLiabilityPence - args.previousPoaPence);
    if (balancingPrev > 0) {
      out.push({ due: `${Y + 1}-01-31`, label: `Balancing payment ${label(Y - 1)}`, amountPence: balancingPrev, estimated: args.previousEstimated });
    }
  }
  if (poaThis > 0) {
    out.push({ due: `${Y + 1}-01-31`, label: `1st payment on account ${label(Y)}`, amountPence: poaThis, estimated: args.previousEstimated });
    out.push({ due: `${Y + 1}-07-31`, label: `2nd payment on account ${label(Y)}`, amountPence: poaThis, estimated: args.previousEstimated });
  }
  const balancingThis = Math.max(0, args.thisYearLiabilityPence - 2 * poaThis);
  if (balancingThis > 0) {
    out.push({ due: `${Y + 2}-01-31`, label: `Balancing payment ${label(Y)}`, amountPence: balancingThis, estimated: true });
  }
  const poaNext = paymentsOnAccount(args.thisYearLiabilityPence, ratesFor(Y + 1).rates);
  if (poaNext > 0) {
    out.push({ due: `${Y + 2}-01-31`, label: `1st payment on account ${label(Y + 1)}`, amountPence: poaNext, estimated: true });
  }
  return out;
}
