import type { IsoDate } from './types';

// UK tax years run 6 April to 5 April. Ported from Honeypot0101, kept as pure functions so
// the boundary logic is testable in isolation instead of scattered through the UI.

/** The calendar year in which the UK tax year containing `d` began. */
export function ukTaxYearStart(d: Date = new Date()): number {
  const y = d.getFullYear();
  const apr6 = new Date(y, 3, 6);
  return d >= apr6 ? y : y - 1;
}

export interface TaxYearBounds {
  from: IsoDate;
  to: IsoDate;
}

/** Inclusive [6 Apr `year`, 5 Apr `year`+1] as ISO dates. */
export function taxYearBounds(year: number): TaxYearBounds {
  return { from: `${year}-04-06`, to: `${year + 1}-04-05` };
}

/** "2026/27" style label for the tax year beginning in `year`. */
export function taxYearLabel(year: number): string {
  return `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
}

/** Whether an ISO date falls within an inclusive bounds range. */
export function withinBounds(date: IsoDate, bounds: TaxYearBounds): boolean {
  const day = date.slice(0, 10);
  return day >= bounds.from && day <= bounds.to;
}

/** True when two dates are within `days` of each other (default 6), for duplicate hints. */
export function datesClose(a: IsoDate, b: IsoDate, days = 6): boolean {
  if (!a || !b) return false;
  const da = new Date(a.slice(0, 10)).getTime();
  const db = new Date(b.slice(0, 10)).getTime();
  return Number.isFinite(da) && Number.isFinite(db) && Math.abs(da - db) < days * 86_400_000;
}

/** Today as an ISO date string. */
export function today(now: Date = new Date()): IsoDate {
  return now.toISOString().slice(0, 10);
}

/** The next 31 January on or after `now` — the self-assessment balancing payment deadline. */
export function nextJan31(now: Date = new Date()): IsoDate {
  const year = now.getMonth() === 0 ? now.getFullYear() : now.getFullYear() + 1;
  return `${year}-01-31`;
}
