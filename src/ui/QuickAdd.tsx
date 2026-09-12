import { useState } from 'react';
import { parsePence } from '../core/money';
import { mkId } from '../core/id';
import { today } from '../core/dates';
import type { Income, Expense, IncomeMethod } from '../core/types';
import { T, fonts } from './theme';

interface QuickAddProps {
  onAddIncome: (income: Income) => void;
  onAddExpense: (expense: Expense) => void;
}

const inputStyle: React.CSSProperties = {
  background: T.bg,
  border: `1px solid ${T.border}`,
  borderRadius: 9,
  padding: '9px 11px',
  color: T.text,
  fontSize: 14,
  fontFamily: fonts.body,
  width: '100%',
};

export function QuickAdd({ onAddIncome, onAddExpense }: QuickAddProps) {
  const [kind, setKind] = useState<'income' | 'expense'>('income');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [method, setMethod] = useState<IncomeMethod>('bank');

  const submit = () => {
    const pence = parsePence(amount);
    if (pence <= 0) return;
    if (kind === 'income') {
      onAddIncome({
        id: mkId(),
        date: today(),
        grossPence: pence,
        method,
        client: label.trim() || undefined,
        createdAt: new Date().toISOString(),
      });
    } else {
      onAddExpense({
        id: mkId(),
        date: today(),
        amountPence: pence,
        category: label.trim() || 'other',
        deductible: true,
        createdAt: new Date().toISOString(),
      });
    }
    setAmount('');
    setLabel('');
  };

  const tab = (value: 'income' | 'expense', text: string, color: string) => (
    <button
      onClick={() => setKind(value)}
      style={{
        flex: 1,
        background: kind === value ? color + '22' : 'transparent',
        border: `1px solid ${kind === value ? color : T.border}`,
        color: kind === value ? color : T.textMuted,
        borderRadius: 9,
        padding: '8px',
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: fonts.body,
      }}
    >
      {text}
    </button>
  );

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {tab('income', 'Income', T.green)}
        {tab('expense', 'Expense', T.expense)}
      </div>
      <input
        style={inputStyle}
        inputMode="decimal"
        placeholder="Amount, e.g. 120.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <input
        style={inputStyle}
        placeholder={kind === 'income' ? 'Who from (optional)' : 'Category, e.g. travel'}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {kind === 'income' && (
        <div style={{ display: 'flex', gap: 8 }}>
          {(['bank', 'cash', 'other'] as IncomeMethod[]).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              style={{
                flex: 1,
                background: method === m ? T.accent + '22' : 'transparent',
                border: `1px solid ${method === m ? T.accent : T.border}`,
                color: method === m ? T.accent : T.textMuted,
                borderRadius: 8,
                padding: '6px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'capitalize',
                fontFamily: fonts.body,
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={submit}
        style={{
          background: kind === 'income' ? T.green : T.expense,
          color: T.bg,
          border: 'none',
          borderRadius: 9,
          padding: '11px',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: fonts.body,
        }}
      >
        Add {kind}
      </button>
    </div>
  );
}
