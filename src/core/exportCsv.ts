import type { Stream, Transaction } from './types.js';
import { categoryInfo } from './hmrc.js';
import { businessEffect } from './ledger.js';
import { formatAmount } from './money.js';

// The year's ledger as a CSV an accountant (or a spreadsheet, or bridging software) can take
// as-is: one line per row, with the HMRC category and box beside it.

function cell(v: string): string {
  // Also neutralise spreadsheet formula injection from bank-supplied text.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
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
        t.date,
        t.direction,
        formatAmount(t.amountPence),
        t.counterparty,
        t.reference,
        t.bucket,
        t.streamId ? streamName.get(t.streamId) ?? '' : '',
        cat?.label ?? '',
        cat ? String(cat.box) : '',
        t.bucket === 'business_expense' ? String(t.businessPercent) : '',
        business ? formatAmount(business) : '',
        String(t.receiptIds.length),
        t.source,
        t.note,
      ]
        .map(cell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}
