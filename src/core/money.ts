import type { Pence } from './types';

// Money is integer pence, never a float. The old app compared amounts with a `< 0.02`
// tolerance precisely because 0.1 + 0.2 !== 0.3 in floating point; integers remove the
// whole class of rounding bugs from a system that reports someone's tax.

/** Parse a user-typed amount ("1,234.5", "£12", "12.999") into whole pence. */
export function parsePence(input: string | number): Pence {
  if (typeof input === 'number') return Math.round(input * 100);
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned === '.') return 0;
  const pounds = parseFloat(cleaned);
  return Number.isFinite(pounds) ? Math.round(pounds * 100) : 0;
}

/** Format pence as a plain decimal string: 123456 -> "1234.56". No currency symbol. */
export function formatAmount(pence: Pence): string {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(Math.round(pence));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Format pence for display with the pound sign and thousands separators: "£1,234.56". */
export function formatGBP(pence: Pence): string {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100).toLocaleString('en-GB');
  return `${sign}£${pounds}.${String(abs % 100).padStart(2, '0')}`;
}

/** Take `percent` percent of an amount, rounded to the nearest penny. */
export function percentOf(pence: Pence, percent: number): Pence {
  return Math.round((pence * percent) / 100);
}

export function sumPence(amounts: readonly Pence[]): Pence {
  return amounts.reduce((total, p) => total + p, 0);
}
