import type { Transaction, Stream, Settings, ExpenseCategory, Pence, IsoDate } from './types.js';
import { factsFor } from './types.js';
import { CATEGORIES, isDisallowable } from './hmrc.js';
import { taxYearBounds, taxYearOf, mtdQuarters, withinBounds, type TaxYearBounds } from './dates.js';
import {
  estimateYear,
  liability,
  paymentSchedule,
  paymentsOnAccount,
  ratesFor,
  tradingProfit,
  type Payment,
  type TradingProfit,
  type YearEstimate,
} from './ukTax.js';

// Every money figure the app shows is derived here, from ledger rows, on read. Nothing
// derived is ever stored — change a classification or a setting and every total, every
// quarter and every tax estimate is right again, retroactively, from one place.

/** A business row's effect on its stream, in pence. Refunds (money back) count negative. */
export function businessEffect(t: Transaction): { income: Pence; expense: Pence } {
  if (t.bucket === 'business_income') {
    return { income: t.direction === 'in' ? t.amountPence : -t.amountPence, expense: 0 };
  }
  if (t.bucket === 'business_expense') {
    const share = Math.round((t.amountPence * clampPercent(t.businessPercent)) / 100);
    return { income: 0, expense: t.direction === 'out' ? share : -share };
  }
  return { income: 0, expense: 0 };
}

function clampPercent(p: number): number {
  return Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 100;
}

export interface StreamSummary {
  /** null collects business rows not yet given a stream — counted, and flagged. */
  streamId: string | null;
  turnoverPence: Pence;
  expensesByCategory: Partial<Record<ExpenseCategory, Pence>>;
  allowableExpensesPence: Pence;
  disallowableExpensesPence: Pence;
  /** Turnover − allowable expenses. Can be negative (a loss). */
  profitPence: Pence;
  rowCount: number;
}

function emptySummary(streamId: string | null): StreamSummary {
  return {
    streamId,
    turnoverPence: 0,
    expensesByCategory: {},
    allowableExpensesPence: 0,
    disallowableExpensesPence: 0,
    profitPence: 0,
    rowCount: 0,
  };
}

/** Per-stream totals for business rows dated inside `bounds`. */
export function summarise(txns: readonly Transaction[], bounds: TaxYearBounds): StreamSummary[] {
  const by = new Map<string | null, StreamSummary>();
  for (const t of txns) {
    if (t.bucket !== 'business_income' && t.bucket !== 'business_expense') continue;
    if (!withinBounds(t.date, bounds)) continue;
    const key = t.streamId ?? null;
    let s = by.get(key);
    if (!s) by.set(key, (s = emptySummary(key)));
    const { income, expense } = businessEffect(t);
    s.rowCount++;
    s.turnoverPence += income;
    if (t.bucket === 'business_expense') {
      const cat = t.category ?? 'otherExpenses';
      s.expensesByCategory[cat] = (s.expensesByCategory[cat] ?? 0) + expense;
      if (isDisallowable(cat)) s.disallowableExpensesPence += expense;
      else s.allowableExpensesPence += expense;
    }
  }
  for (const s of by.values()) s.profitPence = s.turnoverPence - s.allowableExpensesPence;
  return [...by.values()];
}

/** Only self-employment streams (and unassigned business rows, to be safe) are taxed as trading. */
export function tradingStreams(
  summaries: readonly StreamSummary[],
  streams: readonly Stream[],
): { grossPence: Pence; allowableExpensesPence: Pence }[] {
  const kind = new Map(streams.map((s) => [s.id, s.kind]));
  return summaries
    .filter((s) => s.streamId === null || kind.get(s.streamId) !== 'other')
    .map((s) => ({ grossPence: s.turnoverPence, allowableExpensesPence: s.allowableExpensesPence }));
}

export interface QuarterSummary {
  index: number;
  from: IsoDate;
  to: IsoDate;
  deadline: IsoDate;
  /** Just this quarter. */
  period: StreamSummary[];
  /** Tax year to the end of this quarter — what an MTD update actually reports. */
  cumulative: StreamSummary[];
}

export function quarterlySummaries(txns: readonly Transaction[], taxYear: number): QuarterSummary[] {
  const start = taxYearBounds(taxYear).from;
  return mtdQuarters(taxYear).map((q) => ({
    ...q,
    period: summarise(txns, { from: q.from, to: q.to }),
    cumulative: summarise(txns, { from: start, to: q.to }),
  }));
}

export interface ReviewState {
  unreviewed: number;
  /** Business rows with no stream yet. */
  noStream: number;
  /** Business expenses above the threshold with no receipt attached. */
  missingReceipts: number;
  /** Classified automatically (rule / CSTL) — worth a glance, not required. */
  autoClassified: number;
}

export function needsReceipt(t: Transaction, settings: Settings): boolean {
  return (
    t.bucket === 'business_expense' &&
    t.direction === 'out' &&
    t.receiptIds.length === 0 &&
    t.amountPence > settings.receiptThresholdPence
  );
}

export function reviewState(txns: readonly Transaction[], settings: Settings, bounds?: TaxYearBounds): ReviewState {
  const out: ReviewState = { unreviewed: 0, noStream: 0, missingReceipts: 0, autoClassified: 0 };
  for (const t of txns) {
    if (bounds && !withinBounds(t.date, bounds)) continue;
    if (t.bucket === 'unreviewed') out.unreviewed++;
    if ((t.bucket === 'business_income' || t.bucket === 'business_expense') && !t.streamId) out.noStream++;
    if (needsReceipt(t, settings)) out.missingReceipts++;
    if (t.classifiedBy === 'rule' || t.classifiedBy === 'cstl') out.autoClassified++;
  }
  return out;
}

export interface TaxPicture {
  taxYear: number;
  asOf: IsoDate;
  streams: StreamSummary[];
  trading: TradingProfit;
  estimate: YearEstimate;
  previous: {
    taxYear: number;
    profitPence: Pence;
    liabilityPence: Pence;
    /** true when worked out from the ledger; false when you entered HMRC's actual figure. */
    estimated: boolean;
    /** What's still owed on last year (0 once its January deadline has passed). */
    stillOwedPence: Pence;
  };
  /** Payments due to HMRC from today on. */
  upcoming: Payment[];
  /** What the tax pot should hold right now to cover tax on everything earned so far. */
  potTargetPence: Pence;
  review: ReviewState;
}

/**
 * The whole tax position as of a date: this year's estimate, last year's bill, the HMRC
 * payment calendar, and what the tax pot should hold.
 */
export function taxPicture(
  txns: readonly Transaction[],
  streams: readonly Stream[],
  settings: Settings,
  asOf: IsoDate,
): TaxPicture {
  const Y = taxYearOf(asOf);
  const bounds = taxYearBounds(Y);
  const rY = ratesFor(Y).rates;
  const rPrev = ratesFor(Y - 1).rates;

  const thisYear = summarise(txns, { from: bounds.from, to: asOf });
  const trading = tradingProfit(tradingStreams(thisYear, streams), rY);
  const facts = factsFor(settings, Y);
  const estimate = estimateYear(Y, trading.profitPence, facts, asOf);

  // Last year: HMRC's real figure if you've entered it (as next year's "prior year bill"),
  // otherwise worked out from last year's ledger.
  const prevFacts = factsFor(settings, Y - 1);
  const prevTrading = tradingProfit(tradingStreams(summarise(txns, taxYearBounds(Y - 1)), streams), rPrev);
  const prevComputed = liability(prevTrading.profitPence, prevFacts, rPrev).totalPence;
  const prevEntered = facts.priorYearLiabilityPence;
  const prevLiability = prevEntered ?? prevComputed;
  const prevEstimated = prevEntered == null;
  const prevDeadline = `${Y + 1}-01-31`;
  const prevStillOwed = asOf > prevDeadline ? 0 : Math.max(0, prevLiability - prevFacts.paidToHmrcPence);

  const schedule = paymentSchedule({
    taxYear: Y,
    previousLiabilityPence: prevLiability,
    previousPoaPence: 2 * paymentsOnAccount(prevFacts.priorYearLiabilityPence, rPrev),
    previousEstimated: prevEstimated,
    thisYearLiabilityPence: estimate.projectedLiability.totalPence,
  });

  return {
    taxYear: Y,
    asOf,
    streams: thisYear,
    trading,
    estimate,
    previous: {
      taxYear: Y - 1,
      profitPence: prevTrading.profitPence,
      liabilityPence: prevLiability,
      estimated: prevEstimated,
      stillOwedPence: prevStillOwed,
    },
    upcoming: schedule.filter((p) => p.due >= asOf),
    potTargetPence: prevStillOwed + estimate.owedNowPence,
    review: reviewState(txns, settings, bounds),
  };
}

/** Rows for the self-employment pages: one line per category, in form order. */
export function sa103Lines(s: StreamSummary): { box: number; label: string; key: ExpenseCategory; amountPence: Pence; disallowable: boolean }[] {
  return CATEGORIES.filter((c) => (s.expensesByCategory[c.key] ?? 0) !== 0)
    .map((c) => ({ box: c.box, label: c.label, key: c.key, amountPence: s.expensesByCategory[c.key] ?? 0, disallowable: Boolean(c.disallowable) }))
    .sort((a, b) => a.box - b.box);
}

export { taxYearOf };
