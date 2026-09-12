import { formatGBP } from '../core/money';
import type { Income, Expense } from '../core/types';
import { T, fonts } from './theme';

interface Row {
  id: string;
  date: string;
  label: string;
  amountPence: number;
  isIncome: boolean;
  onDelete: () => void;
}

function buildRows(income: Income[], expenses: Expense[], onRemoveIncome: (id: string) => void, onRemoveExpense: (e: Expense) => void): Row[] {
  const rows: Row[] = [
    ...income.map((i) => ({
      id: i.id,
      date: i.date,
      label: i.client || (i.method === 'cash' ? 'Cash' : 'Income'),
      amountPence: i.grossPence,
      isIncome: true,
      onDelete: () => onRemoveIncome(i.id),
    })),
    ...expenses.map((e) => ({
      id: e.id,
      date: e.date,
      label: e.note || e.category,
      amountPence: e.amountPence,
      isIncome: false,
      onDelete: () => onRemoveExpense(e),
    })),
  ];
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

interface RecentListProps {
  income: Income[];
  expenses: Expense[];
  onRemoveIncome: (id: string) => void;
  onRemoveExpense: (e: Expense) => void;
}

export function RecentList({ income, expenses, onRemoveIncome, onRemoveExpense }: RecentListProps) {
  const rows = buildRows(income, expenses, onRemoveIncome, onRemoveExpense);
  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 13, color: T.textFaint, textAlign: 'center', padding: '16px 0' }}>
        No entries yet — add income or an expense above.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: T.textFaint, textTransform: 'uppercase' }}>
        Recent
      </div>
      {rows.map((r) => (
        <div
          key={r.id}
          style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
            <div style={{ fontSize: 11, color: T.textMuted }}>{r.date}</div>
          </div>
          <div style={{ fontFamily: fonts.mono, fontSize: 14, fontWeight: 600, color: r.isIncome ? T.green : T.expense }}>
            {r.isIncome ? '+' : '−'}
            {formatGBP(r.amountPence).replace('£', '£')}
          </div>
          <button
            onClick={r.onDelete}
            aria-label="Delete entry"
            style={{ background: 'none', border: 'none', color: T.textFaint, cursor: 'pointer', padding: 4, fontSize: 16, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
