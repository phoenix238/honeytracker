import type { Direction, IsoDate, Pence } from './types.js';
import { cleanText, headerKey, parseDate, parseSignedPence } from './csv.js';

// Bank statements as CSV, for the accounts Honey can't read directly — Monzo above all. Each line
// gets a stable id (Monzo's own transaction id, or one made from the line itself) so bringing in
// the same statement twice, or two that overlap, never adds a line twice.

export interface StatementLine {
  sourceId: string;
  date: IsoDate;
  amountPence: Pence;
  direction: Direction;
  counterparty: string;
  reference: string;
  /** A move to or from one of the account's own pots — never income or a cost. */
  ownMove: boolean;
  bankType: string;
  bankCategory: string;
}

export interface Statement {
  kind: 'monzo' | 'bank';
  lines: StatementLine[];
  problems: { row: number; message: string }[];
}

interface Cols { id: number; date: number; type: number; name: number; ref: number; category: number; amount: number; in: number; out: number; currency: number }
const find = (head: string[], ...names: string[]) => head.findIndex((h) => names.includes(h));

/** Recognise a statement from its header row; null if it isn't one we can read. */
export function detectStatement(rows: string[][]): Statement['kind'] | null {
  const head = (rows[0] ?? []).map(headerKey);
  if (head.includes('transactionid') && head.includes('name') && (head.includes('amount') || head.includes('moneyout'))) return 'monzo';
  const hasDate = find(head, 'date', 'transactiondate', 'postingdate', 'completeddate') >= 0;
  const hasAmount = find(head, 'amount', 'amountgbp', 'value') >= 0 || (find(head, ...IN_NAMES) >= 0 && find(head, ...OUT_NAMES) >= 0);
  const hasText = find(head, ...TEXT_NAMES) >= 0;
  return hasDate && hasAmount && hasText ? 'bank' : null;
}

const IN_NAMES = ['paidin', 'moneyin', 'credit', 'creditamount', 'in'];
const OUT_NAMES = ['paidout', 'moneyout', 'debit', 'debitamount', 'out'];
const TEXT_NAMES = ['description', 'name', 'payee', 'counterparty', 'details', 'transactiondescription', 'narrative', 'merchant'];

function amountOf(r: string[], c: Cols): Pence | null {
  if (c.amount >= 0 && cleanText(r[c.amount])) return parseSignedPence(r[c.amount]!);
  const inn = c.in >= 0 && cleanText(r[c.in]) ? parseSignedPence(r[c.in]!) : 0;
  const out = c.out >= 0 && cleanText(r[c.out]) ? parseSignedPence(r[c.out]!) : 0;
  if (inn === null || out === null) return null;
  return Math.abs(inn) - Math.abs(out);
}

export function parseStatement(rows: string[][]): Statement {
  const kind = detectStatement(rows);
  const out: Statement = { kind: kind ?? 'bank', lines: [], problems: [] };
  if (!kind) {
    out.problems.push({ row: 1, message: 'This doesn’t look like a bank statement — it needs date, amount and description columns.' });
    return out;
  }
  const head = rows[0]!.map(headerKey);
  const c: Cols = {
    id: find(head, 'transactionid', 'id'),
    date: find(head, 'date', 'transactiondate', 'postingdate', 'completeddate'),
    type: find(head, 'type', 'transactiontype'),
    name: kind === 'monzo' ? find(head, 'name') : find(head, ...TEXT_NAMES),
    ref: kind === 'monzo' ? find(head, 'description', 'notesandtags') : find(head, 'reference', 'memo', 'notes'),
    category: find(head, 'category'),
    amount: find(head, 'amount', 'amountgbp', 'value'),
    in: find(head, ...IN_NAMES),
    out: find(head, ...OUT_NAMES),
    currency: find(head, 'currency'),
  };
  // Identical lines in one statement (two £3 coffees on one day) are told apart by position.
  const repeats = new Map<string, number>();
  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const date = parseDate(r[c.date] ?? '');
    const signed = amountOf(r, c);
    if (!date || signed === null) return void out.problems.push({ row, message: 'No readable date or amount — left out.' });
    if (signed === 0) return; // declined or zero-value lines
    if (c.currency >= 0 && cleanText(r[c.currency]) && cleanText(r[c.currency]).toUpperCase() !== 'GBP') {
      return void out.problems.push({ row, message: `Not in pounds (${cleanText(r[c.currency])}) — left out; add it by hand in pounds.` });
    }
    const counterparty = cleanText(r[c.name]).slice(0, 200);
    const reference = c.ref >= 0 ? cleanText(r[c.ref]).slice(0, 200) : '';
    const bankType = c.type >= 0 ? cleanText(r[c.type]) : '';
    const fingerprint = `${date}|${signed}|${counterparty.toLowerCase()}|${reference.toLowerCase()}`;
    const n = (repeats.get(fingerprint) ?? 0) + 1;
    repeats.set(fingerprint, n);
    const ownId = c.id >= 0 ? cleanText(r[c.id]) : '';
    out.lines.push({
      sourceId: ownId || `${fingerprint}|${n}`,
      date,
      amountPence: Math.abs(signed),
      direction: signed > 0 ? 'in' : 'out',
      counterparty: counterparty || reference,
      reference: counterparty ? reference : '',
      ownMove: /pot transfer|pot$/i.test(bankType) || /^pot\b/i.test(counterparty),
      bankType,
      bankCategory: c.category >= 0 ? cleanText(r[c.category]).slice(0, 60) : '',
    });
  });
  return out;
}
