import type { IsoDate, Pence } from './types.js';

// Reading CSV files that have been through a spreadsheet and back: Excel, Numbers and Google
// Sheets each add their own habits (a byte-order mark, dd/mm/yyyy dates, "£1,234.50", a
// leading apostrophe to keep text as text). These undo them.

/** RFC 4180: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** A header, reduced to letters, so "Amount (£)", "amount £" and "AMOUNT" all read "amount". */
export const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

/** Text a spreadsheet may have prefixed with an apostrophe to stop it being read as a formula. */
export const cleanText = (v: string | undefined) => (v ?? '').replace(/^'/, '').trim();

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "2026-09-03", "03/09/2026", "3/9/26", "3 Sep 2026" → "2026-09-03". UK order: day first. */
export function parseDate(v: string): IsoDate | null {
  const s = cleanText(v);
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (hit) [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else if ((hit = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(s))) {
    [d, m, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
    if (y < 100) y += 2000;
  } else if ((hit = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/i.exec(s))) {
    const mi = MONTHS.indexOf(hit[2]!.toLowerCase());
    if (mi < 0) return null;
    [d, m, y] = [Number(hit[1]), mi + 1, Number(hit[3])];
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * "£1,234.50", "-12.00", "−3.75", "(12.00)" → signed pence. Null when it isn't an amount at all —
 * never zero by accident, since a zero would quietly change someone's figures.
 */
export function parseSignedPence(v: string): Pence | null {
  let s = cleanText(v).replace(/[£\s,]/g, '').replace(/^−/, '-');
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    sign = -sign;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return sign * (Number(whole) * 100 + Number(frac.padEnd(2, '0')));
}
