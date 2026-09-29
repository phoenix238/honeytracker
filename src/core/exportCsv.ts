import type { Stream, Transaction } from './types.js';
import { categoryInfo } from './hmrc.js';
import { businessEffect } from './ledger.js';
import { formatAmount } from './money.js';

// The year's ledger as a CSV an accountant (or a spreadsheet, or bridging software) can take
// as-is: one line per row, with the HMRC category and box beside it.

/**
 * Text from the bank (payee, reference, note) — neutralised so a spreadsheet can't run it as a
 * formula. Numbers must not go through this: a refund's "-12.00" would become the text "'-12.00".
 */
function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return quote(safe);
}

function quote(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function ledgerCsv(txns: readonly Transaction[], streams: readonly Stream[]): string {
  const streamName = new Map(streams.map((s) => [s.id, s.name]));
  const header = [
    'Date', 'Direction', 'Amount', 'Counterparty', 'Reference', 'Classification', 'Stream',
    'HMRC category', 'SA103F box', 'Business %', 'Business amount', 'Receipts', 'Source', 'Note',
  ];
  const lines = [header.join(',')];
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of sorted) {
    const cat = t.bucket === 'business_expense' && t.category ? categoryInfo(t.category) : null;
    const eff = businessEffect(t);
    const business = t.bucket === 'business_income' ? eff.income : t.bucket === 'business_expense' ? eff.expense : 0;
    lines.push(
      [
        quote(t.date),
        quote(t.direction),
        quote(formatAmount(t.amountPence)),
        cell(t.counterparty),
        cell(t.reference),
        quote(t.bucket),
        cell(t.streamId ? streamName.get(t.streamId) ?? '' : ''),
        quote(cat?.label ?? ''),
        quote(cat ? String(cat.box) : ''),
        quote(t.bucket === 'business_expense' ? String(t.businessPercent) : ''),
        quote(business ? formatAmount(business) : ''),
        quote(String(t.receiptIds.length)),
        quote(t.source),
        cell(t.note),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}
