import type { IsoDate } from './types.js';

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

/** Today as an ISO date string (UK local date). */
export function today(now: Date = new Date()): IsoDate {
  return londonDate(now);
}

/** The UK tax year (by start year) an ISO date falls in: "2027-04-05" → 2026. */
export function taxYearOf(date: IsoDate): number {
  const y = Number(date.slice(0, 4));
  return date.slice(5, 10) >= '04-06' ? y : y - 1;
}

/**
 * The calendar date in London for an instant. Bank timestamps are UTC, but tax years turn
 * over at midnight UK time — a payment at 23:30 on 5 April BST is 22:30 UTC the same day,
 * one at 00:30 on 6 April BST is 23:30 UTC on the 5th. Using the UTC date would file that
 * one in the wrong year.
 */
export function londonDate(instant: string | Date): IsoDate {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export interface Quarter {
  /** 1–4 within the tax year. */
  index: number;
  from: IsoDate;
  to: IsoDate;
  /** Making Tax Digital quarterly update deadline (the 7th of the second month after). */
  deadline: IsoDate;
}

/** The four standard MTD update periods for the tax year starting in `year`. */
export function mtdQuarters(year: number): Quarter[] {
  const n = year + 1;
  return [
    { index: 1, from: `${year}-04-06`, to: `${year}-07-05`, deadline: `${year}-08-07` },
    { index: 2, from: `${year}-07-06`, to: `${year}-10-05`, deadline: `${year}-11-07` },
    { index: 3, from: `${year}-10-06`, to: `${n}-01-05`, deadline: `${n}-02-07` },
    { index: 4, from: `${n}-01-06`, to: `${n}-04-05`, deadline: `${n}-05-07` },
  ];
}

/** Whole days from `from` to `to` (ISO dates), inclusive of both. */
export function daysInclusive(from: IsoDate, to: IsoDate): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Shift an ISO date by whole days. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}
