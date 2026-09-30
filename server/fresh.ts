import ExcelJS from 'exceljs';
import type { Repo } from './repo.js';
import { matchInvoicePayments, matchLooseReceipts } from './sync.js';
import { FRESH_COLUMNS, WHAT_CHOICES, planFresh, readFreshSheet, whatLabel, type Cell, type FreshRow } from '../src/core/freshSheet.js';
import { parseCsv } from '../src/core/csv.js';
import { CATEGORIES, categoryInfo } from '../src/core/hmrc.js';
import { mkId } from '../src/core/id.js';
import type { Stream, Transaction } from '../src/core/types.js';

// Starting fresh from your own spreadsheet. Honey writes the spreadsheet (your bank lines already
// in, the columns you fill in marked yellow, every choice a dropdown), reads it back, and — once
// you've seen what it read — replaces everything up to the sheet's last date with it. From the
// day after, the bank feed, statements and CSTL carry on. The old app's records go for good.
// What was replaced is kept, so the whole thing can be undone.

/** The day your spreadsheet is the record up to. Nothing dated on or before it is added from elsewhere. */
export const BOOKS_FROM = 'books:from';
const BACKUP = 'fresh:backup';

export async function booksFrom(r: Repo): Promise<string | null> {
  return (await r.getKv<{ cutoff: string }>(BOOKS_FROM))?.cutoff ?? null;
}

export async function freshStatus(r: Repo): Promise<{ cutoff: string; at: string; canUndo: boolean } | null> {
  const [books, backup] = await Promise.all([r.getKv<{ cutoff: string; at: string }>(BOOKS_FROM), r.getKv<{ at: string }>(BACKUP)]);
  return books?.cutoff ? { cutoff: books.cutoff, at: books.at, canUndo: Boolean(backup) } : null;
}

// ── Reading the file you bring back ─────────────────────────────────────────────────

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
  }
  return String(v);
}

/** An Excel file (the "Payments" sheet, or the first with anything on it) or a CSV, as rows of cells. */
export async function readUpload(dataBase64: string): Promise<Cell[][]> {
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    } catch {
      throw new Error('That file isn’t an Excel file Honey can open. Save it as Excel (.xlsx) or CSV — in Numbers: File → Export To → Excel.');
    }
    const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === 'payments') ?? wb.worksheets.find((w) => w.actualRowCount > 1);
    if (!ws) return [];
    const table: Cell[][] = [];
    for (let i = 1; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const cells: Cell[] = [];
      for (let c = 1; c <= Math.max(ws.columnCount, row.cellCount); c++) cells.push(cellValue(row.getCell(c).value));
      table.push(cells);
    }
    return table;
  }
  return parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
}

// ── The spreadsheet Honey gives you ─────────────────────────────────────────────────

const FONT = { name: 'Arial', size: 10 };
const YOU_FILL = new Set(['What is it?', 'Stream', 'Category', 'Work %', 'Note']);
const WIDTHS: Record<string, number> = { Date: 12, 'In/Out': 8, 'Amount £': 11, Who: 30, Reference: 22, 'What is it?': 22, Stream: 24, Category: 34, 'Work %': 9, Note: 40, Account: 14 };
const YELLOW = 'FFFFF2CC';
const HEAD_YELLOW = 'FFFFD966';

function sourceName(t: Transaction): string {
  if (t.meta.account) return t.meta.account;
  return { starling: 'Starling', monzo: 'Monzo', bankcsv: 'Bank', cash: 'Cash', manual: 'Added by hand', cstl: 'Cash (CSTL)', import: 'Old app', sheet: '' }[t.source] ?? '';
}

/**
 * The spreadsheet to fill in. `prefill`: every line Honey has (the old app's records left out),
 * with what you've sorted so far — otherwise an empty sheet with the same columns.
 */
export async function buildFreshTemplate(txns: readonly Transaction[], streams: readonly Stream[], prefill: boolean): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Honey';
  const active = streams.filter((s) => !s.archived);
  const streamName = new Map(streams.map((s) => [s.id, s.name]));

  // How to fill it in — the first thing you see. Two columns: what, and what to put.
  const how = wb.addWorksheet('How to fill it in', { pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  how.columns = [{ width: 26 }, { width: 92 }];
  const put = (a: string, b = '', style: 'title' | 'head' | 'text' | 'example' = 'text') => {
    const row = how.addRow([a, b]);
    const [ca, cb] = [row.getCell(1), row.getCell(2)];
    ca.font = style === 'title' ? { ...FONT, size: 16, bold: true } : style === 'head' ? { ...FONT, size: 11, bold: true } : { ...FONT, bold: true };
    cb.font = style === 'example' ? { ...FONT, color: { argb: 'FF0000FF' } } : FONT;
    ca.alignment = { vertical: 'top', wrapText: true };
    cb.alignment = { vertical: 'top', wrapText: true };
    if (style === 'example') for (const c of [ca, cb]) c.border = { bottom: { style: 'hair', color: { argb: 'FFBBBBBB' } } };
  };
  put('Honey — your clean record', '', 'title');
  how.mergeCells('A1:B1');
  put('', prefill
    ? 'The Payments tab has every payment Honey has from your bank (your old app’s records are left out). Go down it and fill in the yellow columns. White columns are what your bank says — leave them as they are.'
    : 'Put one row per payment on the Payments tab, and fill in the yellow columns.');
  put('');
  put('The yellow columns', '', 'head');
  put('What is it?', 'Pick from the list: Business income · Business cost · Personal · Between my accounts · Not sure yet. “Not sure yet” ones wait in the app for you to swipe.');
  put('Stream', 'Which of your work it was — for income and costs only. Pick from the list, or type a new name and Honey makes that stream.');
  put('Category', 'Business costs only: what kind of cost. The list (with the HMRC box each one goes in) is on the Lists tab.');
  put('Work %', 'Only when something is partly business, like a phone you also use personally: type 50. Leave it empty for 100%.');
  put('Note', 'Why it’s a business cost, in your words. It stays with the payment in Honey.');
  put('');
  put('Adding and removing', '', 'head');
  put('Monzo and cash', 'Add them as new rows, anywhere — order doesn’t matter. Fill in Date, In/Out, Amount £, Who, and Account (e.g. “Monzo” or “Cash”), then the yellow columns.');
  put('Each payment once', 'Delete a row only if that money never really happened (an old duplicate). For personal spending, pick “Personal” rather than deleting it.');
  put('Column headings', 'Don’t rename them. You can move columns about or add your own — Honey ignores columns it doesn’t know.');
  put('');
  put('Bringing it back', '', 'head');
  put('Save it as', 'Excel (.xlsx) or CSV. In Numbers: File → Export To → Excel. In Google Sheets: File → Download → Microsoft Excel.');
  put('In Honey', 'Settings → Start fresh from a spreadsheet → choose the file. Honey shows you what it read — how many payments, the totals for each tax year, anything it couldn’t read — before it changes anything. You can undo it afterwards.');
  put('Where the bank takes over', 'The last date in the sheet. From the day after, new payments come in from your bank as usual, and you swipe them in the app.');
  put('');
  put('An example row', '(how one filled-in row looks on the Payments tab)', 'head');
  const ex: [string, string][] = [
    ['Date', '03/09/2025'], ['In/Out', 'Out'], ['Amount £', '45.50'], ['Who', 'SHELL 334'], ['Reference', ''],
    ['What is it?', 'Business cost'], ['Stream', active[0]?.name ?? 'Craniosacral therapy'], ['Category', 'Car, van & travel'],
    ['Work %', '(empty — all of it was for work)'], ['Note', 'Fuel driving to a client’s home'], ['Account', 'Starling'],
  ];
  for (const [a, b] of ex) put(a, b, 'example');
  put('');
  put('Colours', 'Yellow = you fill in. White = from your bank; leave as it is.');

  // The payments.
  const ws = wb.addWorksheet('Payments', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' },
  });
  ws.columns = FRESH_COLUMNS.map((h) => ({ header: h, key: h, width: WIDTHS[h] ?? 14, style: { font: FONT, ...(YOU_FILL.has(h) ? { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } } } : {}) } }));
  ws.getColumn('Date').numFmt = 'dd/mm/yyyy';
  ws.getColumn('Amount £').numFmt = '#,##0.00';
  const head = ws.getRow(1);
  head.eachCell((c) => {
    const mine = YOU_FILL.has(String(c.value));
    c.font = { ...FONT, bold: true, color: { argb: mine ? 'FF000000' : 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: mine ? HEAD_YELLOW : 'FF3A3A3A' } };
  });
  ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + FRESH_COLUMNS.length)}1` };
  const rows = prefill ? [...txns].filter((t) => t.source !== 'import').sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)) : [];
  for (const t of rows) {
    const business = t.bucket === 'business_income' || t.bucket === 'business_expense';
    ws.addRow([
      new Date(`${t.date}T00:00:00Z`),
      t.direction === 'in' ? 'In' : 'Out',
      t.amountPence / 100,
      t.counterparty,
      t.reference,
      whatLabel(t.bucket),
      business && t.streamId ? streamName.get(t.streamId) ?? '' : '',
      t.bucket === 'business_expense' && t.category ? categoryInfo(t.category).label : '',
      t.bucket === 'business_expense' && t.businessPercent !== 100 ? t.businessPercent : null,
      t.note,
      sourceName(t),
    ]);
  }

  // Lists behind the dropdowns — and a reference for what each means.
  const lists = wb.addWorksheet('Lists');
  lists.columns = [
    { header: 'What is it?', width: 22 }, { header: 'Means', width: 50 }, { header: 'Streams', width: 26 }, { header: 'About', width: 50 },
    { header: 'Category', width: 34 }, { header: 'HMRC box', width: 10 }, { header: 'What goes here', width: 80 },
  ].map((c) => ({ ...c, style: { font: FONT } }));
  lists.getRow(1).eachCell((c) => { c.font = { ...FONT, bold: true }; });
  const cats = CATEGORIES.filter((c) => !c.disallowable || c.key === 'businessEntertainmentCosts');
  const n = Math.max(WHAT_CHOICES.length, active.length, cats.length);
  for (let i = 0; i < n; i++) {
    const w = WHAT_CHOICES[i];
    const s = active[i];
    const c = cats[i];
    lists.addRow([w?.label ?? null, w?.hint ?? null, s?.name ?? null, s?.about ?? null, c?.label ?? null, c ? `Box ${c.box}` : null, c ? `${c.hint}${c.disallowable ? ' (recorded, not tax-deductible)' : ''}` : null]);
  }

  // Dropdowns, well past the last row, so added rows get them too.
  const last = Math.max(rows.length + 1000, 3000);
  const list = (range: string, formula: string, strict: boolean, prompt: string) =>
    (ws as unknown as { dataValidations: { add: (a: string, v: ExcelJS.DataValidation) => void } }).dataValidations.add(range, {
      type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true, errorStyle: strict ? 'stop' : 'warning',
      errorTitle: 'Not on the list', error: prompt, showInputMessage: false,
    });
  list(`B2:B${last}`, '"In,Out"', true, 'Choose In (money came in) or Out (money went out).');
  list(`F2:F${last}`, `Lists!$A$2:$A$${WHAT_CHOICES.length + 1}`, true, 'Choose one of the five — see the How to fill it in tab.');
  if (active.length) list(`G2:G${last}`, `Lists!$C$2:$C$${active.length + 1}`, false, 'Not one of your streams — keep it and Honey makes a new stream with this name.');
  list(`H2:H${last}`, `Lists!$E$2:$E$${cats.length + 1}`, false, 'Not one of the categories — Honey will file it as Other business expenses.');
  (ws as unknown as { dataValidations: { add: (a: string, v: ExcelJS.DataValidation) => void } }).dataValidations.add(`I2:I${last}`, {
    type: 'whole', operator: 'between', allowBlank: true, formulae: [0, 100], showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Work %', error: 'A whole number from 0 to 100.',
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Replacing, and undoing it ───────────────────────────────────────────────────────

interface Backup {
  at: string;
  cutoff: string;
  prev: { cutoff: string; at: string } | null;
  removed: Transaction[];
  insertedIds: string[];
  receiptLinks: [string, string][];
  invoiceLinks: [string, string][];
}

const COLORS = ['#E0A92E', '#6E86D0', '#5BBF8A', '#D66E8E', '#9B7BD4', '#4FB6C4'];

/** Replace everything up to the spreadsheet's last date (and every old-app record) with the spreadsheet. */
export async function startFresh(r: Repo, rows: readonly FreshRow[], today: string): Promise<{ inserted: number; removed: number; cutoff: string; streamsMade: string[] }> {
  const [all, streams, receipts, invoices, prev] = await Promise.all([r.listTransactions(), r.listStreams(), r.listReceipts(), r.listInvoices(), r.getKv<{ cutoff: string; at: string }>(BOOKS_FROM)]);
  const plan = planFresh(rows, all, streams.map((s) => s.name), today);
  if (!plan) throw new Error('The spreadsheet has no payments Honey could read.');

  const byName = new Map(streams.map((s) => [s.name.trim().toLowerCase(), s.id]));
  const streamsMade: string[] = [];
  for (const name of plan.newStreams) {
    const made = await r.saveStream({ name, kind: 'self_employment', color: COLORS[(streams.length + streamsMade.length) % COLORS.length]!, archived: false });
    byName.set(name.toLowerCase(), made.id);
    streamsMade.push(name);
  }
  const activeStreams = streams.filter((s) => !s.archived);
  const onlyStream = activeStreams.length === 1 && !streamsMade.length ? activeStreams[0]!.id : null;

  const removed = all.filter((t) => t.date <= plan.cutoff || t.source === 'import');
  const removedIds = new Set(removed.map((t) => t.id));
  const at = new Date().toISOString();
  const importId = mkId();
  const inserted: Transaction[] = rows.map((row) => {
    const business = row.bucket === 'business_income' || row.bucket === 'business_expense';
    return {
      id: mkId(), date: row.date, amountPence: row.amountPence, direction: row.direction, source: 'sheet', sourceId: `${importId}:${row.line}`,
      counterparty: row.counterparty, reference: row.reference, bucket: row.bucket,
      streamId: business ? (row.stream ? byName.get(row.stream.trim().toLowerCase()) ?? null : onlyStream) : null,
      category: row.bucket === 'business_expense' ? row.category : null,
      businessPercent: row.bucket === 'business_expense' ? row.businessPercent : 100,
      note: row.note, classifiedBy: row.bucket === 'unreviewed' ? null : 'user',
      meta: { ...(row.account ? { account: row.account } : {}), sheetLine: String(row.line) },
      receiptIds: [], createdAt: at, updatedAt: at,
    };
  });

  // Kept before anything changes, so even a half-finished run can be undone.
  const backup: Backup = {
    at, cutoff: plan.cutoff, prev, removed, insertedIds: inserted.map((t) => t.id),
    receiptLinks: receipts.filter((rc) => rc.transactionId && removedIds.has(rc.transactionId)).map((rc) => [rc.id, rc.transactionId!]),
    invoiceLinks: invoices.filter((i) => i.paidTransactionId && removedIds.has(i.paidTransactionId)).map((i) => [i.id, i.paidTransactionId!]),
  };
  await r.setKv(BACKUP, backup);
  await r.deleteMany([...removedIds]);
  await r.insertMany(inserted);
  await r.setKv(BOOKS_FROM, { cutoff: plan.cutoff, at });
  await r.audit(null, 'fresh_start', { cutoff: plan.cutoff, inserted: inserted.length, removed: removed.length });
  // Invoices paid by a payment that quotes their number, and receipts that fit a line, find their new lines.
  await matchInvoicePayments(r).catch(() => 0);
  await matchLooseReceipts(r).catch(() => 0);
  return { inserted: inserted.length, removed: removed.length, cutoff: plan.cutoff, streamsMade };
}

/** Put everything back as it was before the last fresh start. */
export async function undoFresh(r: Repo): Promise<{ restored: number; removed: number }> {
  const b = await r.getKv<Backup>(BACKUP);
  if (!b) throw new Error('There’s no fresh start to undo.');
  await r.deleteMany(b.insertedIds);
  await r.insertMany(b.removed);
  const receipts = new Map((await r.listReceipts()).map((rc) => [rc.id, rc]));
  for (const [rcId, txId] of b.receiptLinks) if (receipts.get(rcId) && !receipts.get(rcId)!.transactionId) await r.updateReceipt(rcId, { transactionId: txId });
  for (const [invId, txId] of b.invoiceLinks) {
    const inv = await r.getInvoice(invId);
    if (inv && inv.paidTransactionId !== txId) await r.updateInvoice(invId, { paidTransactionId: txId });
  }
  await r.setKv(BOOKS_FROM, b.prev);
  await r.setKv(BACKUP, null);
  await r.audit(null, 'fresh_start_undone', { cutoff: b.cutoff });
  return { restored: b.removed.length, removed: b.insertedIds.length };
}

/** Read an upload and say what starting fresh from it would do — nothing changes. */
export async function previewFresh(r: Repo, dataBase64: string, today: string) {
  const read = readFreshSheet(await readUpload(dataBase64));
  const [all, streams] = await Promise.all([r.listTransactions(), r.listStreams()]);
  const plan = planFresh(read.rows, all, streams.map((s) => s.name), today);
  return { read, plan };
}
