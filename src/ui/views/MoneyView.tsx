import { useMemo, useState } from 'react';
import { formatGBP } from '../../core/money';
import { findDuplicates } from '../../core/duplicates';
import type { Income, Expense } from '../../core/types';
import { fonts, type Theme } from '../theme';
import { QuickAdd } from '../QuickAdd';
import { InIcon, OutIcon } from '../icons';
import type { Store } from '../useStore';

type Filter = 'all' | 'in' | 'out';

interface FeedRow {
  key: string;
  date: string;
  label: string;
  tag: string;
  amountPence: number;
  isIncome: boolean;
  duplicate: boolean;
  onDelete: () => void;
}

function buildFeed(store: Store): FeedRow[] {
  const dupIncome = findDuplicates(store.income, (i) => i.client ?? '', (i) => i.grossPence);
  const dupExpense = findDuplicates(store.expenses, (e) => e.note ?? e.category, (e) => e.amountPence);

  const rows: FeedRow[] = [
    ...store.income.map((i: Income) => ({
      key: 'i' + i.id,
      date: i.date,
      label: i.client || (i.method === 'cash' ? 'Cash payment' : 'Income'),
      tag: i.method,
      amountPence: i.grossPence,
      isIncome: true,
      duplicate: dupIncome.has(i.id),
      onDelete: () => store.removeIncome(i.id),
    })),
    ...store.expenses.map((e: Expense) => ({
      key: 'e' + e.id,
      date: e.date,
      label: e.note || e.category,
      tag: e.deductible ? e.category : `${e.category} · personal`,
      amountPence: e.amountPence,
      isIncome: false,
      duplicate: dupExpense.has(e.id),
      onDelete: () => store.removeExpense(e),
    })),
  ];
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function MoneyView({ store, T }: { store: Store; T: Theme }) {
  const [filter, setFilter] = useState<Filter>('all');
  const feed = useMemo(() => buildFeed(store), [store.income, store.expenses]);
  const shown = feed.filter((r) => (filter === 'all' ? true : filter === 'in' ? r.isIncome : !r.isIncome));

  const chip = (value: Filter, text: string) => (
    <button
      onClick={() => setFilter(value)}
      style={{
        background: filter === value ? T.accent + '22' : 'transparent',
        border: `1px solid ${filter === value ? T.accent : T.border}`,
        color: filter === value ? T.accent : T.textMuted,
        borderRadius: 999,
        padding: '5px 14px',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: fonts.body,
      }}
    >
      {text}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontFamily: fonts.display, fontSize: 22, color: T.text }}>Money</div>

      <QuickAdd T={T} onAddIncome={store.addIncome} onAddExpense={store.addExpense} />

      <div style={{ display: 'flex', gap: 8 }}>
        {chip('all', 'All')}
        {chip('in', 'In')}
        {chip('out', 'Out')}
      </div>

      {shown.length === 0 ? (
        <div style={{ fontSize: 13, color: T.textFaint, textAlign: 'center', padding: '16px 0' }}>Nothing here yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shown.map((r) => (
            <div key={r.key} style={{ background: T.surface, border: `1px solid ${r.duplicate ? T.danger : T.surfaceBorder}`, borderRadius: 14, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 26, height: 26, borderRadius: 999, background: (r.isIncome ? T.accent2 : T.accent) + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {r.isIncome ? <InIcon size={14} color={T.accent2} /> : <OutIcon size={14} color={T.accent} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
                <div style={{ fontSize: 11, color: T.textMuted }}>
                  {r.date} · <span style={{ textTransform: 'capitalize' }}>{r.tag}</span>
                  {r.duplicate && <span style={{ color: T.danger }}> · possible duplicate</span>}
                </div>
              </div>
              <div style={{ fontFamily: fonts.display, fontSize: 15, color: r.isIncome ? T.accent2 : T.accent }}>
                {r.isIncome ? '+' : '−'}
                {formatGBP(r.amountPence)}
              </div>
              <button onClick={r.onDelete} aria-label="Delete entry" style={{ background: 'none', border: 'none', color: T.textFaint, cursor: 'pointer', padding: 4, fontSize: 16, lineHeight: 1 }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
