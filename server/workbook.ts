import ExcelJS from 'exceljs';
import type { Settings, Stream, Transaction } from '../src/core/types.js';
import { CATEGORIES, categoryInfo } from '../src/core/hmrc.js';
import { businessEffect, summarise } from '../src/core/ledger.js';
import { taxYearBounds, taxYearLabel } from '../src/core/dates.js';
import { EDIT_COLUMNS } from '../src/core/csvRoundTrip.js';

// A tax year as a workbook to check before it goes to the accountant. The Transactions sheet is
// every line with what Honey decided, with drop-downs to change it; the Summary works out the
// self-employment figures from that sheet with formulas, beside what Honey worked out, so any
// change shows as a difference. It opens in Excel, Numbers and Google Sheets.
//
// The Transactions sheet keeps the columns of Honey's "edit" file, so exported as CSV it can be
// brought back into Honey (Settings → Spreadsheet & other banks).

const WHAT: Record<Transaction['bucket'], string> = {
  unreviewed: 'to sort',
  business_income: 'income',
  business_expense: 'cost',
  personal: 'personal',
  transfer: 'transfer',
};

const GBP = '£#,##0.00;[Red]-£#,##0.00';
const GOLD = 'FFE0A92E';
const PALE = 'FFFBF3E0';

/** A string inside a formula: quotes doubled. */
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** A SUMIFS criterion matching this text exactly — its wildcards (* ? ~) escaped. */
const exact = (s: string) => q(s.replace(/[~*?]/g, (c) => `~${c}`));

export async function buildWorkbook(txns: readonly Transaction[], streams: readonly Stream[], settings: Settings, year: number, preparedOn: string): Promise<Buffer> {
  const bounds = taxYearBounds(year);
  const rows = txns.filter((t) => t.date >= bounds.from && t.date <= bounds.to).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const streamName = new Map(streams.map((s) => [s.id, s.name]));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Honey';
  wb.created = new Date(`${preparedOn}T12:00:00Z`);

  const summary = wb.addWorksheet('Summary', { properties: { tabColor: { argb: GOLD } } });
  const sheet = wb.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 1 }] });
  const lists = wb.addWorksheet('Lists');

  // ── Lists: what the drop-downs offer, and category → box for the formulas ────────────
  lists.columns = [
    { header: 'Category', key: 'label', width: 34 },
    { header: 'SA103F box', key: 'box', width: 11 },
    { header: 'MTD field', key: 'key', width: 26 },
    { header: 'Allowable?', key: 'allowable', width: 11 },
    { header: 'Streams', key: 'stream', width: 26 },
    { header: 'What goes here', key: 'hint', width: 80 },
  ];
  CATEGORIES.forEach((c, i) => {
    const r = lists.getRow(i + 2);
    r.values = [c.label, c.box, c.key, c.disallowable ? 'no' : 'yes', undefined, c.hint];
  });
  const streamNames = [...new Set(streams.map((s) => s.name))];
  streamNames.forEach((n, i) => (lists.getCell(i + 2, 5).value = n));
  lists.getRow(1).font = { bold: true };
  const catRange = `Lists!$A$2:$A$${CATEGORIES.length + 1}`;
  const boxRange = `Lists!$A$2:$B$${CATEGORIES.length + 1}`;
  const streamRange = `Lists!$E$2:$E$${Math.max(2, streamNames.length + 1)}`;

  // ── Transactions ──────────────────────────────────────────────────────────────────────
  sheet.columns = [
    { header: EDIT_COLUMNS[0], width: 12 },
    { header: EDIT_COLUMNS[1], width: 11 },
    { header: EDIT_COLUMNS[2], width: 7 },
    { header: EDIT_COLUMNS[3], width: 11 },
    { header: EDIT_COLUMNS[4], width: 28 },
    { header: EDIT_COLUMNS[5], width: 20 },
    { header: EDIT_COLUMNS[6], width: 12 },
    { header: EDIT_COLUMNS[7], width: 11 },
    { header: EDIT_COLUMNS[8], width: 20 },
    { header: EDIT_COLUMNS[9], width: 30 },
    { header: EDIT_COLUMNS[10], width: 8 },
    { header: EDIT_COLUMNS[11], width: 30 },
    { header: EDIT_COLUMNS[12], width: 9 },
    { header: EDIT_COLUMNS[13], width: 12 },
    { header: 'SA103F box', width: 10 },
    { header: 'Business £', width: 12 },
  ];
  const head = sheet.getRow(1);
  head.font = { bold: true };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 30;

  rows.forEach((t, i) => {
    const n = i + 2;
    const eff = businessEffect(t);
    const business = t.bucket === 'business_income' ? eff.income : t.bucket === 'business_expense' ? eff.expense : 0;
    const cat = t.bucket === 'business_expense' && t.category ? categoryInfo(t.category) : null;
    const r = sheet.getRow(n);
    r.values = [
      `h-${t.id}`,
      new Date(`${t.date}T00:00:00Z`),
      t.direction,
      t.amountPence / 100,
      t.counterparty,
      t.reference,
      t.meta.account || t.source,
      WHAT[t.bucket],
      t.streamId ? streamName.get(t.streamId) ?? '' : '',
      cat?.label ?? '',
      t.bucket === 'business_expense' ? t.businessPercent : null,
      t.note,
      t.receiptIds.length,
      `v-${t.updatedAt}`,
      { formula: `IF(H${n}="cost",IFERROR(VLOOKUP(J${n},${boxRange},2,FALSE),""),"")`, result: cat ? cat.box : '' },
      {
        formula: `IF(H${n}="income",IF(C${n}="in",D${n},-D${n}),IF(H${n}="cost",IF(C${n}="out",1,-1)*D${n}*IF(K${n}="",100,K${n})/100,0))`,
        result: business / 100,
      },
    ];
    r.getCell(2).numFmt = 'dd/mm/yyyy';
    r.getCell(4).numFmt = GBP;
    r.getCell(16).numFmt = GBP;
    r.getCell(1).font = { color: { argb: 'FF999999' }, size: 9 };
    r.getCell(14).font = { color: { argb: 'FF999999' }, size: 9 };
    r.getCell(8).dataValidation = { type: 'list', allowBlank: false, formulae: ['"income,cost,personal,transfer,to sort"'], showErrorMessage: true, errorTitle: 'What is it?', error: 'income, cost, personal, transfer or to sort' };
    if (streamNames.length) r.getCell(9).dataValidation = { type: 'list', allowBlank: true, formulae: [streamRange] };
    r.getCell(10).dataValidation = { type: 'list', allowBlank: true, formulae: [catRange] };
    r.getCell(11).dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [0, 100], showErrorMessage: true, error: 'Work % is 0 to 100' };
  });
  const last = rows.length + 1;
  sheet.autoFilter = { from: 'A1', to: `P${Math.max(2, last)}` };
  if (rows.length) {
    sheet.addConditionalFormatting({
      ref: `A2:P${last}`,
      rules: [
        { type: 'expression', priority: 1, formulae: ['$H2="to sort"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFE9A8' } } } },
        { type: 'expression', priority: 2, formulae: ['OR($H2="personal",$H2="transfer")'], style: { font: { color: { argb: 'FF8A8576' } } } },
        { type: 'expression', priority: 3, formulae: ['AND($H2="cost",$M2=0)'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFDE2DD' } } } },
      ],
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────────────────
  summary.columns = [{ width: 44 }, { width: 11 }, { width: 15 }, { width: 15 }, { width: 14 }];
  const who = settings.profile.name || settings.name || 'Self-employment';
  summary.getCell('A1').value = `${who} — self-employment ${taxYearLabel(year)}`;
  summary.getCell('A1').font = { bold: true, size: 15 };
  summary.getCell('A2').value = `${bounds.from} to ${bounds.to} · cash basis · prepared from Honey on ${preparedOn}`;
  summary.getCell('A2').font = { color: { argb: 'FF666666' } };
  summary.getCell('A3').value =
    'Change lines on the Transactions sheet (What is it?, Stream, Category, Work %). “This sheet” recalculates from them; “Honey” is what the app worked out; “Difference” shows what you’ve changed.';
  summary.getCell('A3').alignment = { wrapText: true, vertical: 'top' };
  summary.mergeCells('A3:E3');
  summary.getRow(3).height = 32;

  const unsorted = rows.filter((t) => t.bucket === 'unreviewed');
  const noReceipt = rows.filter((t) => t.bucket === 'business_expense' && t.direction === 'out' && t.receiptIds.length === 0);
  const sum = (list: Transaction[], d: 'in' | 'out') => list.filter((t) => t.direction === d).reduce((a, t) => a + t.amountPence, 0) / 100;
  summary.getCell('A5').value = 'Still “to sort” (yellow on Transactions)';
  summary.getCell('C5').value = { formula: `COUNTIF(Transactions!$H$2:$H$${Math.max(2, last)},"to sort")`, result: unsorted.length };
  summary.getCell('D5').value = `in ${fmt(sum(unsorted, 'in'))} · out ${fmt(sum(unsorted, 'out'))}`;
  summary.getCell('A6').value = 'Business costs with no receipt in Honey (pink)';
  summary.getCell('C6').value = noReceipt.length;
  summary.getCell('D6').value = fmt(noReceipt.reduce((a, t) => a + t.amountPence, 0) / 100);

  const P = `Transactions!$P$2:$P$${Math.max(2, last)}`;
  const H = `Transactions!$H$2:$H$${Math.max(2, last)}`;
  const I = `Transactions!$I$2:$I$${Math.max(2, last)}`;
  const J = `Transactions!$J$2:$J$${Math.max(2, last)}`;
  const summaries = summarise(rows, bounds);
  // Every stream with lines this year, then business lines with no stream yet (Honey's null).
  const blocks: { name: string; criterion: string; honey: (typeof summaries)[number] | undefined; other: boolean }[] = streams
    .filter((s) => summaries.some((x) => x.streamId === s.id))
    .map((s) => ({ name: s.name, criterion: exact(s.name), honey: summaries.find((x) => x.streamId === s.id), other: s.kind === 'other' }));
  const orphan = summaries.find((x) => x.streamId === null);
  if (orphan) blocks.push({ name: 'No stream yet', criterion: '"="', honey: orphan, other: false });

  let row = 8;
  const totals: { turnover: string[]; expenses: string[]; profit: string[]; honey: { t: number; e: number; p: number } } = { turnover: [], expenses: [], profit: [], honey: { t: 0, e: 0, p: 0 } };
  const line = (label: string, box: number | string, honey: number, formula: string, opts: { bold?: boolean; muted?: boolean } = {}) => {
    const r = summary.getRow(row);
    r.values = [label, box, honey, { formula, result: honey }, { formula: `ROUND(D${row}-C${row},2)`, result: 0 }];
    for (const c of [3, 4, 5]) r.getCell(c).numFmt = GBP;
    if (opts.bold) r.font = { bold: true };
    if (opts.muted) r.font = { color: { argb: 'FF8A8576' } };
    return row++;
  };

  if (!blocks.length) summary.getCell(`A${row++}`).value = `No business income or costs in ${taxYearLabel(year)} yet.`;
  for (const b of blocks) {
    const hr = summary.getRow(row++);
    hr.values = [`${b.name}${b.other ? ' (not self-employment — not taxed as trading)' : ''}`, 'SA103F box', 'Honey', 'This sheet', 'Difference'];
    hr.font = { bold: true };
    hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } };
    const s = b.honey;
    const turnover = line('Turnover (business income)', 15, (s?.turnoverPence ?? 0) / 100, `SUMIFS(${P},${H},"income",${I},${b.criterion})`);
    for (const c of [...CATEGORIES].sort((x, y) => x.box - y.box)) {
      // A cost with no category counts as "other", as it does in Honey.
      const blank = c.key === 'otherExpenses' ? `+SUMIFS(${P},${H},"cost",${I},${b.criterion},${J},"=")` : '';
      line(
        `${c.label}${c.disallowable ? ' (not allowable)' : ''}`,
        c.box,
        (s?.expensesByCategory[c.key] ?? 0) / 100,
        `SUMIFS(${P},${H},"cost",${I},${b.criterion},${J},${exact(c.label)})${blank}`,
        { muted: c.disallowable },
      );
    }
    // Costs Honey counts but whose category a sheet edit left blank or unknown still count, as "other".
    const allCosts = `SUMIFS(${P},${H},"cost",${I},${b.criterion})`;
    const disallowed = CATEGORIES.filter((c) => c.disallowable).map((c) => `SUMIFS(${P},${H},"cost",${I},${b.criterion},${J},${exact(c.label)})`).join('-');
    const expenses = line('Total allowable expenses', 31, (s?.allowableExpensesPence ?? 0) / 100, `${allCosts}-${disallowed}`, { bold: true });
    const profit = line('Net profit (loss if negative)', '', (s?.profitPence ?? 0) / 100, `D${turnover}-D${expenses}`, { bold: true });
    if (!b.other) {
      totals.turnover.push(`D${turnover}`);
      totals.expenses.push(`D${expenses}`);
      totals.profit.push(`D${profit}`);
      totals.honey.t += (s?.turnoverPence ?? 0) / 100;
      totals.honey.e += (s?.allowableExpensesPence ?? 0) / 100;
      totals.honey.p += (s?.profitPence ?? 0) / 100;
    }
    row++;
  }
  if (blocks.filter((b) => !b.other).length > 1) {
    const hr = summary.getRow(row++);
    hr.values = ['All self-employment together', '', 'Honey', 'This sheet', 'Difference'];
    hr.font = { bold: true };
    hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
    line('Turnover', '', totals.honey.t, totals.turnover.join('+'), { bold: true });
    line('Allowable expenses', '', totals.honey.e, totals.expenses.join('+'), { bold: true });
    line('Net profit', '', totals.honey.p, totals.profit.join('+'), { bold: true });
    row++;
  }
  const notes = [
    'Cash basis: money counts in the tax year it moved, not when it was invoiced.',
    'A cost’s business amount is its amount × Work %. Refunds (money back on a cost, or back to a client) count against the total.',
    'Box numbers follow HMRC’s full self-employment pages (SA103F); check them against this year’s form before filing.',
    'Profit here is before the £1,000 trading allowance; Honey’s Tax tab uses the allowance instead of actual costs when it gives the lower profit.',
    'Income from a payroll job, and personal or transfer lines, aren’t part of these figures.',
    'To bring changes back into Honey: export the Transactions sheet as CSV and use Settings → Spreadsheet & other banks.',
  ];
  for (const n of notes) {
    const c = summary.getCell(`A${row}`);
    c.value = `• ${n}`;
    c.alignment = { wrapText: true, vertical: 'top' };
    summary.mergeCells(`A${row}:E${row}`);
    summary.getRow(row).height = 28;
    row++;
  }
  summary.views = [{ state: 'frozen', ySplit: 3 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function fmt(pounds: number): string {
  return `£${pounds.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
