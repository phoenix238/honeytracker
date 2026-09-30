import { useState } from 'react';
import { T } from '../theme';
import { Card, Chip, Empty, Label, Money, Sheet, fmtDate } from '../components';
import { TransactionSheet } from '../TransactionSheet';
import { businessEffect, type StreamSummary } from '../../core/ledger';
import { taxYearBounds, taxYearLabel, withinBounds } from '../../core/dates';
import { categoryInfo } from '../../core/hmrc';
import { formatGBP } from '../../core/money';
import type { ExpenseCategory, Transaction } from '../../core/types';
import type { App } from '../useApp';

// One income stream for the tax year: what came in, what it cost (by HMRC category), what's
// left — and every line behind those numbers, each one open to check or change.

export function StreamSheet({ app, summary, taxYear, onClose }: { app: App; summary: StreamSummary; taxYear: number; onClose: () => void }) {
  const data = app.data!;
  const stream = summary.streamId ? data.streams.find((s) => s.id === summary.streamId) ?? null : null;
  const [tab, setTab] = useState<'income' | 'costs'>(summary.turnoverPence > 0 || summary.allowableExpensesPence === 0 ? 'income' : 'costs');
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const bounds = taxYearBounds(taxYear);
  const rows = data.transactions
    .filter((t) => (t.streamId ?? null) === summary.streamId && withinBounds(t.date, bounds))
    .sort((a, b) => b.date.localeCompare(a.date));
  const income = rows.filter((t) => t.bucket === 'business_income');
  const costs = rows.filter((t) => t.bucket === 'business_expense');
  const shown = tab === 'income' ? income : costs.filter((t) => !category || (t.category ?? 'otherExpenses') === category);
  const byCategory = Object.entries(summary.expensesByCategory)
    .map(([k, v]) => [k as ExpenseCategory, v ?? 0] as const)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => b[1] - a[1]);
  const open = data.transactions.find((t) => t.id === openId) ?? null;

  return (
    <Sheet open onClose={onClose} title={stream?.name ?? 'No stream yet'}>
      <div style={{ fontSize: 12, color: T.textMuted, marginTop: -8 }}>Tax year {taxYearLabel(taxYear)}</div>
      {!summary.streamId && (
        <div style={{ fontSize: 12, color: T.accentBright, lineHeight: 1.5 }}>
          Business lines not given a stream yet. They still count — open one to say which work it was for.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Total label="In" pence={summary.turnoverPence} color={T.green} />
        <Total label="Costs" pence={summary.allowableExpensesPence} color={T.expense} />
        <Total label="Profit" pence={summary.profitPence} color={summary.profitPence >= 0 ? T.text : T.danger} />
      </div>
      {summary.disallowableExpensesPence > 0 && (
        <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
          Plus {formatGBP(summary.disallowableExpensesPence)} of costs HMRC doesn’t allow (e.g. entertaining) — recorded, not taken off the profit.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <Chip active={tab === 'income'} color={T.green} onClick={() => setTab('income')}>Income ({income.length})</Chip>
        <Chip active={tab === 'costs'} color={T.expense} onClick={() => setTab('costs')}>Costs ({costs.length})</Chip>
      </div>

      {tab === 'costs' && byCategory.length > 0 && (
        <Card style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Label>Costs by kind — tap one to see just those</Label>
          {byCategory.map(([cat, pence]) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(category === cat ? null : cat)}
              style={{
                display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 4px', background: category === cat ? T.expense + '22' : 'none',
                border: 'none', borderRadius: 8, color: T.text, fontSize: 13, cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span>{categoryInfo(cat).label}</span>
              <Money pence={pence} size={13} />
            </button>
          ))}
        </Card>
      )}

      {shown.length === 0 ? (
        <Empty>{tab === 'income' ? 'No income for this stream this year.' : 'No costs for this stream this year.'}</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {shown.map((t) => (
            <Line key={t.id} t={t} onOpen={() => setOpenId(t.id)} />
          ))}
        </div>
      )}

      <TransactionSheet app={app} txn={open} onClose={() => setOpenId(null)} />
    </Sheet>
  );
}

function Total({ label, pence, color }: { label: string; pence: number; color: string }) {
  return (
    <Card style={{ padding: 10 }}>
      <Label>{label}</Label>
      <div style={{ marginTop: 4 }}>
        <Money pence={pence} color={color} size={15} />
      </div>
    </Card>
  );
}

/** One line: who, when, what kind — and the amount that counts, with the share when it's partly business. */
function Line({ t, onOpen }: { t: Transaction; onOpen: () => void }) {
  const { income, expense } = businessEffect(t);
  const counts = t.bucket === 'business_income' ? income : expense;
  const partial = t.bucket === 'business_expense' && t.businessPercent !== 100;
  const detail = [
    fmtDate(t.date),
    t.bucket === 'business_expense' ? categoryInfo(t.category ?? 'otherExpenses').label : '',
    partial ? `${t.businessPercent}% of ${formatGBP(t.amountPence)}` : '',
    t.receiptIds.length ? '🧾' : '',
    t.note,
  ].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 2px', background: 'none', border: 'none', borderBottom: `1px solid ${T.border}`, textAlign: 'left', cursor: 'pointer', color: T.text, width: '100%' }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.counterparty || t.reference || '—'}</span>
        <span style={{ display: 'block', fontSize: 11, color: T.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
      </span>
      <Money pence={counts} color={t.bucket === 'business_income' ? T.green : T.text} size={14} />
    </button>
  );
}
