import type { Bucket, Direction, ExpenseCategory, IsoDate, Pence, Transaction } from './types.js';
import { isBankRow } from './types.js';
import { cleanText, parseDate, parseSignedPence } from './csv.js';
import { categoryFrom } from './csvRoundTrip.js';
import { CATEGORIES, QUICK_CATEGORIES } from './hmrc.js';
import { taxYearOf } from './dates.js';

// Starting fresh from one clean spreadsheet of everything: every payment, sorted, in your own
// words. The app gives you the spreadsheet (your bank lines already in, with dropdowns) and reads
// it back here — forgivingly: columns are found by name in any order, dates and amounts however
// the spreadsheet stored them, choices whether picked from the dropdown or typed. Nothing is
// dropped quietly: a row it can't read is listed with the reason.

export const FRESH_COLUMNS = ['Date', 'In/Out', 'Amount £', 'Who', 'Reference', 'What is it?', 'Stream', 'Category', 'Work %', 'Note', 'Account'] as const;

/** The "What is it?" choices, as the dropdown shows them. */
export const WHAT_CHOICES: readonly { label: string; bucket: Bucket; hint: string }[] = [
  { label: 'Business income', bucket: 'business_income', hint: 'Money earned from your self-employed work' },
  { label: 'Business cost', bucket: 'business_expense', hint: 'Spent wholly (or partly — see Work %) for the work' },
  { label: 'Personal', bucket: 'personal', hint: 'Your own spending, gifts, anything not the business' },
  { label: 'Between my accounts', bucket: 'transfer', hint: 'Money moving between your own accounts or pots' },
  { label: 'Not sure yet', bucket: 'unreviewed', hint: 'Left for you to swipe in the app' },
];
export const whatLabel = (b: Bucket) => WHAT_CHOICES.find((c) => c.bucket === b)!.label;

export type Cell = string | number | boolean | Date | null | undefined;

export interface FreshRow {
  /** Spreadsheet row number, as you see it. */
  line: number;
  date: IsoDate;
  direction: Direction;
  amountPence: Pence;
  counterparty: string;
  reference: string;
  bucket: Bucket;
  /** The stream as written — matched to yours by name, or made. */
  stream: string;
  category: ExpenseCategory | null;
  businessPercent: number;
  note: string;
  account: string;
}

export interface FreshProblem {
  line: number;
  message: string;
  /** Left out entirely, or brought in with a guess. */
  skipped: boolean;
}

export interface FreshRead {
  rows: FreshRow[];
  problems: FreshProblem[];
  /** Which columns were found, by what they're called in your spreadsheet. */
  columns: string[];
}

type Field = 'date' | 'inout' | 'amount' | 'moneyIn' | 'moneyOut' | 'who' | 'reference' | 'what' | 'stream' | 'category' | 'percent' | 'note' | 'account';

const key = (h: string) => h.toLowerCase().replace(/%/g, 'pc').replace(/[^a-z0-9]/g, '');
const HEADERS: Record<Field, readonly string[]> = {
  date: ['date', 'datepaid', 'transactiondate', 'day', 'when'],
  inout: ['inout', 'direction', 'inorout', 'moneyinout'],
  amount: ['amount', 'amountgbp', 'amountpounds', 'value', 'total', 'sum', 'gbp'],
  moneyIn: ['moneyin', 'paidin', 'in', 'credit', 'received'],
  moneyOut: ['moneyout', 'paidout', 'out', 'debit', 'spent'],
  who: ['who', 'name', 'payee', 'payer', 'counterparty', 'description', 'merchant', 'details', 'whofrom', 'whoto'],
  reference: ['reference', 'ref', 'paymentreference'],
  what: ['whatisit', 'what', 'kind', 'bucket', 'businessorpersonal', 'classification', 'sort', 'type'],
  stream: ['stream', 'whichwork', 'work', 'job', 'business', 'incomestream'],
  category: ['category', 'hmrccategory', 'costtype', 'expensetype', 'type of cost', 'kindofcost'].map(key),
  percent: ['workpc', 'businesspc', 'businessuse', 'pc', 'percent', 'share'],
  note: ['note', 'notes', 'comment', 'comments', 'memo', 'why'],
  account: ['account', 'bank', 'paidfrom', 'card', 'source'],
};

function mapHeader(row: Cell[]): Map<Field, number> | null {
  const found = new Map<Field, number>();
  row.forEach((cell, i) => {
    const k = key(text(cell));
    if (!k) return;
    for (const [field, names] of Object.entries(HEADERS) as [Field, readonly string[]][]) {
      if (!found.has(field) && names.includes(k)) {
        found.set(field, i);
        return;
      }
    }
  });
  const hasAmount = found.has('amount') || found.has('moneyIn') || found.has('moneyOut');
  return found.has('date') && hasAmount ? found : null;
}

function text(c: Cell): string {
  if (c == null) return '';
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return cleanText(String(c));
}

/** A spreadsheet date: a real date, an Excel day number, or text in UK order. */
export function dateOf(c: Cell): IsoDate | null {
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : c.toISOString().slice(0, 10);
  if (typeof c === 'number' && c > 20000 && c < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86_400_000).toISOString().slice(0, 10);
  return parseDate(text(c));
}

/** A spreadsheet amount: a number, or text like "£1,234.50" or "(12.00)". Signed. */
export function penceOf(c: Cell): Pence | null {
  if (typeof c === 'number') return Number.isFinite(c) ? Math.round(c * 100) : null;
  const s = text(c);
  return s ? parseSignedPence(s) : null;
}

function directionOf(c: Cell): Direction | null {
  const k = key(text(c));
  if (!k) return null;
  if (['in', 'moneyin', 'income', 'credit', 'received', 'paidin'].includes(k)) return 'in';
  if (['out', 'moneyout', 'cost', 'expense', 'debit', 'spent', 'paidout'].includes(k)) return 'out';
  return null;
}

const WHAT_IN: Record<string, Bucket> = {
  businessincome: 'business_income', income: 'business_income', earned: 'business_income', sales: 'business_income',
  businesscost: 'business_expense', cost: 'business_expense', expense: 'business_expense', businessexpense: 'business_expense', expenses: 'business_expense',
  personal: 'personal', notbusiness: 'personal', private: 'personal',
  betweenmyaccounts: 'transfer', transfer: 'transfer', myownmoney: 'transfer', ownaccount: 'transfer', ownmoney: 'transfer', savings: 'transfer',
  notsureyet: 'unreviewed', tosort: 'unreviewed', unsure: 'unreviewed', unreviewed: 'unreviewed', '': 'unreviewed',
};

/** A category however it's written: the dropdown label, the short name from the app, the HMRC key or box, or a word from it. */
export function looseCategory(v: string): ExpenseCategory | null {
  const exact = categoryFrom(v);
  if (exact !== 'bad') return exact;
  const s = v.toLowerCase();
  const byWord = [...QUICK_CATEGORIES.map((c) => ({ key: c.key, label: c.label })), ...CATEGORIES.map((c) => ({ key: c.key, label: c.label }))].filter((c) =>
    c.label.toLowerCase().split(/[^a-z]+/).some((w) => w.length >= 4 && s.includes(w)),
  );
  const keys = [...new Set(byWord.map((c) => c.key))];
  return keys.length === 1 ? keys[0]! : null;
}

/** Read the spreadsheet: the first row with a Date and an Amount column is the header. */
export function readFreshSheet(table: readonly Cell[][]): FreshRead {
  let headerAt = -1;
  let cols: Map<Field, number> | null = null;
  for (let i = 0; i < Math.min(table.length, 15) && !cols; i++) {
    cols = mapHeader(table[i] ?? []);
    if (cols) headerAt = i;
  }
  if (!cols) {
    return { rows: [], problems: [{ line: 1, message: 'Couldn’t find the header row — it needs at least a “Date” and an “Amount £” column.', skipped: true }], columns: [] };
  }
  const at = (row: Cell[], f: Field) => (cols!.has(f) ? row[cols!.get(f)!] : undefined);
  const rows: FreshRow[] = [];
  const problems: FreshProblem[] = [];
  for (let i = headerAt + 1; i < table.length; i++) {
    const row = table[i] ?? [];
    const line = i + 1;
    if (!row.some((c) => text(c))) continue; // a blank row
    const date = dateOf(at(row, 'date'));
    if (!date) {
      problems.push({ line, message: `No date I can read (“${text(at(row, 'date'))}”) — left out.`, skipped: true });
      continue;
    }
    let what = WHAT_IN[key(text(at(row, 'what')))];
    if (what === undefined) {
      problems.push({ line, message: `“${text(at(row, 'what'))}” isn’t one of the choices — brought in as “Not sure yet”.`, skipped: false });
      what = 'unreviewed';
    }
    // The amount, and which way it went: an In/Out column, separate Money in / Money out
    // columns, a signed amount, or — failing all that — what "What is it?" says.
    let signed: number | null = null;
    let direction: Direction | null = directionOf(at(row, 'inout'));
    const mIn = penceOf(at(row, 'moneyIn'));
    const mOut = penceOf(at(row, 'moneyOut'));
    const amt = penceOf(at(row, 'amount'));
    if (amt !== null) signed = amt;
    else if (mIn) [signed, direction] = [Math.abs(mIn), direction ?? 'in'];
    else if (mOut) [signed, direction] = [Math.abs(mOut), direction ?? 'out'];
    if (signed === null || signed === 0) {
      problems.push({ line, message: 'No amount — left out.', skipped: true });
      continue;
    }
    if (!direction) {
      if (signed < 0) direction = 'out';
      else if (what === 'business_income') direction = 'in';
      else if (what === 'business_expense') direction = 'out';
      else {
        problems.push({ line, message: 'Say whether it was money In or Out — left out.', skipped: true });
        continue;
      }
    }
    let category: ExpenseCategory | null = null;
    if (what === 'business_expense') {
      const written = text(at(row, 'category'));
      category = written ? looseCategory(written) : null;
      if (written && !category) problems.push({ line, message: `Category “${written}” not recognised — brought in as “Other business expenses”.`, skipped: false });
      category ??= 'otherExpenses';
    }
    let pct = 100;
    const pcText = text(at(row, 'percent')).replace('%', '');
    if (pcText && what === 'business_expense') {
      const n = Number(pcText);
      const v = n > 0 && n <= 1 && pcText.includes('.') ? n * 100 : n;
      if (Number.isFinite(v) && v >= 0 && v <= 100) pct = Math.round(v);
      else problems.push({ line, message: `Work % “${pcText}” isn’t 0–100 — taken as 100%.`, skipped: false });
    }
    rows.push({
      line,
      date,
      direction,
      amountPence: Math.abs(signed),
      counterparty: text(at(row, 'who')).slice(0, 200),
      reference: text(at(row, 'reference')).slice(0, 200),
      bucket: what,
      stream: what === 'business_income' || what === 'business_expense' ? text(at(row, 'stream')).slice(0, 80) : '',
      category,
      businessPercent: pct,
      note: text(at(row, 'note')).slice(0, 1000),
      account: text(at(row, 'account')).slice(0, 60),
    });
  }
  const columns = [...cols.entries()].map(([, i]) => text(table[headerAt]![i]));
  return { rows, problems, columns };
}

export interface FreshPlan {
  count: number;
  from: IsoDate;
  /** The last date in the spreadsheet: everything up to it is replaced, and the bank feed takes over after it. */
  cutoff: IsoDate;
  years: { taxYear: number; incomePence: Pence; costsPence: Pence; toSort: number; rows: number }[];
  /** What goes from the app: everything up to the cutoff, and every old-app record whatever its date. */
  removing: { total: number; bank: number; oldApp: number; other: number };
  /** What stays: lines after the cutoff. */
  keeping: number;
  newStreams: string[];
  /** Rows that look the same as another row (same day, amount, way and name) — worth a look. */
  lookAlike: number[];
  /** Rows dated after today. */
  future: number[];
}

export function planFresh(rows: readonly FreshRow[], existing: readonly Transaction[], streamNames: readonly string[], today: IsoDate): FreshPlan | null {
  if (!rows.length) return null;
  const cutoff = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0]!.date);
  const from = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0]!.date);
  const years = new Map<number, FreshPlan['years'][number]>();
  for (const r of rows) {
    const ty = taxYearOf(r.date);
    const y = years.get(ty) ?? { taxYear: ty, incomePence: 0, costsPence: 0, toSort: 0, rows: 0 };
    y.rows++;
    if (r.bucket === 'business_income') y.incomePence += r.direction === 'in' ? r.amountPence : -r.amountPence;
    if (r.bucket === 'business_expense') {
      const share = Math.round((r.amountPence * r.businessPercent) / 100);
      const cat = CATEGORIES.find((c) => c.key === r.category);
      if (!cat?.disallowable) y.costsPence += r.direction === 'out' ? share : -share;
    }
    if (r.bucket === 'unreviewed') y.toSort++;
    years.set(ty, y);
  }
  const gone = existing.filter((t) => t.date <= cutoff || t.source === 'import');
  const known = new Set(streamNames.map((n) => n.trim().toLowerCase()));
  const newStreams = [...new Set(rows.map((r) => r.stream.trim()).filter((n) => n && !known.has(n.toLowerCase())))];
  const seen = new Map<string, number>();
  const lookAlike: number[] = [];
  for (const r of rows) {
    const k = `${r.date}|${r.direction}|${r.amountPence}|${r.counterparty.toLowerCase()}`;
    if (seen.has(k)) lookAlike.push(r.line);
    else seen.set(k, r.line);
  }
  return {
    count: rows.length,
    from,
    cutoff,
    years: [...years.values()].sort((a, b) => a.taxYear - b.taxYear),
    removing: {
      total: gone.length,
      bank: gone.filter(isBankRow).length,
      oldApp: gone.filter((t) => t.source === 'import').length,
      other: gone.filter((t) => !isBankRow(t) && t.source !== 'import').length,
    },
    keeping: existing.length - gone.length,
    newStreams,
    lookAlike,
    future: rows.filter((r) => r.date > today).map((r) => r.line),
  };
}

/**
 * Receipts and invoices were pinned to lines the spreadsheet replaced. Each of those old lines
 * finds its new line: same way, same amount, within a few days (nearest first, then the same
 * name). One new line per old line, so two £60 payments on a day stay two.
 */
export function carryOver(
  old: readonly Pick<Transaction, 'id' | 'date' | 'direction' | 'amountPence' | 'counterparty'>[],
  fresh: readonly Pick<Transaction, 'id' | 'date' | 'direction' | 'amountPence' | 'counterparty'>[],
  windowDays = 3,
): Map<string, string> {
  const days = (a: IsoDate, b: IsoDate) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const o of [...old].sort((a, b) => a.date.localeCompare(b.date))) {
    const best = fresh
      .filter((n) => !taken.has(n.id) && n.direction === o.direction && n.amountPence === o.amountPence && days(n.date, o.date) <= windowDays)
      .sort((a, b) => days(a.date, o.date) - days(b.date, o.date) || Number(!same(a.counterparty, o.counterparty)) - Number(!same(b.counterparty, o.counterparty)))[0];
    if (!best) continue;
    taken.add(best.id);
    out.set(o.id, best.id);
  }
  return out;
}
