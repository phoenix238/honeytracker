import type { Bucket, ExpenseCategory, Stream, Transaction } from './types.js';
import { CATEGORIES, QUICK_CATEGORIES, categoryInfo, isCategory } from './hmrc.js';
import { formatAmount } from './money.js';
import { cleanText, headerKey, parseDate, parseSignedPence } from './csv.js';

// Edit in a spreadsheet, bring it back. The file carries every row with a Honey ID; on the way
// back only the columns that say what a row IS can change (what it is, stream, category, work %,
// note). The bank's own facts — date, amount, who — are there to read and to check the row still
// lines up; a spreadsheet can never add, delete or rewrite a bank line.

export const EDIT_COLUMNS = [
  'Honey ID (don’t change)',
  'Date',
  'In/Out',
  'Amount £',
  'Who',
  'Reference',
  'Account',
  'What is it?',
  'Stream',
  'Category',
  'Work %',
  'Note',
  'Receipts',
  'Last changed (don’t change)',
] as const;

/** What the "What is it?" column says, both ways. */
const WHAT: Record<Bucket, string> = {
  unreviewed: 'to sort',
  business_income: 'income',
  business_expense: 'cost',
  personal: 'personal',
  transfer: 'transfer',
};
const WHAT_IN: Record<string, Bucket> = {
  tosort: 'unreviewed', unreviewed: 'unreviewed', sort: 'unreviewed',
  income: 'business_income', businessincome: 'business_income',
  cost: 'business_expense', expense: 'business_expense', businesscost: 'business_expense', businessexpense: 'business_expense',
  personal: 'personal', notbusiness: 'personal',
  transfer: 'transfer',
};

// The ID is written "h-…" so no spreadsheet ever mistakes it for a number (an all-digit ID, or
// one like "12e45", would come back rounded or as scientific notation).
const idOut = (id: string) => `h-${id}`;
const idIn = (v: string) => cleanText(v).replace(/^h-/i, '');
// Same for the "last changed" stamp: a spreadsheet that turned it into a date would make every
// row look changed since, and nothing would save.
const stampOut = (at: string) => `v-${at}`;
const stampIn = (v: string) => cleanText(v).replace(/^v-/i, '');

function textCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function editCsv(txns: readonly Transaction[], streams: readonly Stream[]): string {
  const streamName = new Map(streams.map((s) => [s.id, s.name]));
  const lines = [EDIT_COLUMNS.map(textCell).join(',')];
  for (const t of [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))) {
    lines.push(
      [
        idOut(t.id),
        t.date,
        t.direction,
        formatAmount(t.amountPence),
        textCell(t.counterparty),
        textCell(t.reference),
        textCell(t.meta.account || t.source),
        WHAT[t.bucket],
        textCell(t.streamId ? streamName.get(t.streamId) ?? '' : ''),
        textCell(t.bucket === 'business_expense' && t.category ? categoryInfo(t.category).label : ''),
        t.bucket === 'business_expense' ? String(t.businessPercent) : '',
        textCell(t.note),
        String(t.receiptIds.length),
        stampOut(t.updatedAt),
      ].join(','),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Is this our own edit file? (Recognised by its ID column, whatever order the rest are in.) */
export function isEditFile(rows: string[][]): boolean {
  return Boolean(rows[0]?.some((h) => headerKey(h).startsWith('honeyid')));
}

export function categoryFrom(v: string): ExpenseCategory | null | 'bad' {
  const s = cleanText(v).toLowerCase();
  if (!s) return null;
  if (isCategory(cleanText(v))) return cleanText(v) as ExpenseCategory;
  const byLabel = CATEGORIES.find((c) => c.label.toLowerCase() === s) ?? QUICK_CATEGORIES.find((c) => c.label.toLowerCase() === s);
  if (byLabel) return byLabel.key;
  const box = /^(?:box\s*)?(\d{2})$/.exec(s);
  if (box) {
    const matches = CATEGORIES.filter((c) => c.box === Number(box[1]) && !c.disallowable);
    if (matches.length === 1) return matches[0]!.key;
  }
  return 'bad';
}

export interface CsvChange {
  id: string;
  /** Spreadsheet row number, counting the header as row 1 — what the person sees. */
  row: number;
  patch: Partial<Pick<Transaction, 'bucket' | 'streamId' | 'category' | 'businessPercent' | 'note'>>;
  expectUpdatedAt: string;
  who: string;
  /** "What: to sort → cost", "Category: → Travel" — for the preview. */
  summary: string[];
}

export interface CsvPlan {
  changes: CsvChange[];
  /** Changed in Honey since the file was downloaded: left as Honey has them. */
  conflicts: { row: number; who: string }[];
  problems: { row: number; message: string }[];
  unchanged: number;
}

export function planEditImport(rows: string[][], txns: readonly Transaction[], streams: readonly Stream[]): CsvPlan {
  const plan: CsvPlan = { changes: [], conflicts: [], problems: [], unchanged: 0 };
  const head = (rows[0] ?? []).map(headerKey);
  const col = (prefix: string) => head.findIndex((h) => h.startsWith(prefix));
  const c = {
    id: col('honeyid'), date: col('date'), amount: col('amount'), what: col('whatisit'), stream: col('stream'),
    category: col('category'), work: col('work'), note: col('note'), changed: col('lastchanged'),
  };
  if (c.id < 0) {
    plan.problems.push({ row: 1, message: 'No “Honey ID” column — download the file from Honey to edit it.' });
    return plan;
  }
  const byId = new Map(txns.map((t) => [t.id, t]));
  const streamByName = new Map(streams.map((s) => [s.name.trim().toLowerCase(), s]));
  const seen = new Map<string, number>();
  for (const r of rows.slice(1)) {
    const id = idIn(r[c.id] ?? '');
    if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
  }

  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const cell = (k: keyof typeof c) => (c[k] >= 0 ? r[c[k]] ?? '' : '');
    const id = idIn(cell('id'));
    if (!id) return void plan.problems.push({ row, message: 'No Honey ID — rows can’t be added from a spreadsheet, only changed.' });
    if ((seen.get(id) ?? 0) > 1) return void plan.problems.push({ row, message: 'This Honey ID appears more than once — none of its rows were used.' });
    const t = byId.get(id);
    if (!t) return void plan.problems.push({ row, message: 'Honey has no row with this ID.' });
    const who = t.counterparty || t.reference || t.date;

    // The row must still describe the same money — catches rows sorted or pasted out of line.
    if (c.date >= 0 && cleanText(cell('date')) && parseDate(cell('date')) !== t.date)
      return void plan.problems.push({ row, message: `${who}: the date no longer matches Honey’s (${t.date}) — was the row moved?` });
    if (c.amount >= 0 && cleanText(cell('amount'))) {
      const p = parseSignedPence(cell('amount'));
      if (p === null || Math.abs(p) !== t.amountPence)
        return void plan.problems.push({ row, message: `${who}: the amount no longer matches Honey’s (${formatAmount(t.amountPence)}) — was the row moved?` });
    }
    if (c.changed >= 0 && stampIn(cell('changed')) && stampIn(cell('changed')) !== t.updatedAt) return void plan.conflicts.push({ row, who });

    const summary: string[] = [];
    const patch: CsvChange['patch'] = {};
    const whatRaw = cleanText(cell('what'));
    let bucket: Bucket = t.bucket;
    if (whatRaw) {
      const b = WHAT_IN[headerKey(whatRaw)];
      if (!b) return void plan.problems.push({ row, message: `${who}: “${whatRaw}” isn’t one of: income, cost, personal, transfer, to sort.` });
      bucket = b;
    }
    const business = bucket === 'business_income' || bucket === 'business_expense';

    let streamId = business ? t.streamId : null;
    const streamRaw = cleanText(cell('stream'));
    if (business && streamRaw) {
      const s = streamByName.get(streamRaw.toLowerCase());
      if (!s) return void plan.problems.push({ row, message: `${who}: there’s no stream called “${streamRaw}”.` });
      streamId = s.id;
    }

    let category = bucket === 'business_expense' ? t.category ?? 'otherExpenses' : null;
    if (bucket === 'business_expense' && cleanText(cell('category'))) {
      const k = categoryFrom(cell('category'));
      if (k === 'bad') return void plan.problems.push({ row, message: `${who}: “${cleanText(cell('category'))}” isn’t an HMRC category Honey knows.` });
      if (k) category = k;
    }

    let percent = bucket === 'business_expense' ? t.businessPercent : 100;
    const workRaw = cleanText(cell('work')).replace(/%$/, '');
    if (bucket === 'business_expense' && workRaw) {
      const n = Number(workRaw);
      if (!Number.isFinite(n) || n < 0 || n > 100) return void plan.problems.push({ row, message: `${who}: Work % must be 0–100.` });
      percent = Math.round(n);
    }

    const note = c.note >= 0 ? cleanText(cell('note')) : t.note;
    const streamName = (sid: string | null) => (sid ? streams.find((s) => s.id === sid)?.name ?? '?' : '—');
    if (bucket !== t.bucket) { patch.bucket = bucket; summary.push(`What: ${WHAT[t.bucket]} → ${WHAT[bucket]}`); }
    if (streamId !== t.streamId) { patch.streamId = streamId; summary.push(`Stream: ${streamName(t.streamId)} → ${streamName(streamId)}`); }
    if (category !== t.category) { patch.category = category; summary.push(`Category: ${t.category ? categoryInfo(t.category).label : '—'} → ${category ? categoryInfo(category).label : '—'}`); }
    if (bucket === 'business_expense' && percent !== t.businessPercent) { patch.businessPercent = percent; summary.push(`Work: ${t.businessPercent}% → ${percent}%`); }
    if (note !== t.note.trim()) { patch.note = note; summary.push(note ? `Note: “${note}”` : 'Note cleared'); }

    if (!summary.length) plan.unchanged++;
    else plan.changes.push({ id, row, patch, expectUpdatedAt: t.updatedAt, who, summary });
  });
  return plan;
}
