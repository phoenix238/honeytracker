import { useMemo } from 'react';
import { deriveTotals } from '../core/tax';
import { formatGBP } from '../core/money';
import { ukTaxYearStart, taxYearLabel } from '../core/dates';
import { T, fonts } from './theme';
import type { Store } from './useStore';
import { QuickAdd } from './QuickAdd';
import { RecentList } from './RecentList';

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: T.textMuted, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: fonts.mono, fontSize: 24, fontWeight: 700, color, marginTop: 6 }}>{value}</div>
    </div>
  );
}

export function Home({ store }: { store: Store }) {
  const { income, expenses, settings, error } = store;
  const totals = useMemo(() => deriveTotals(income, expenses, settings), [income, expenses, settings]);
  const year = ukTaxYearStart();

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: fonts.display, fontSize: 26, fontWeight: 800, color: T.accent }}>Honey</div>
        <div style={{ fontFamily: fonts.mono, fontSize: 11, color: T.textMuted }}>Tax year {taxYearLabel(year)}</div>
      </div>

      {error && (
        <div style={{ background: 'rgba(184,57,47,0.12)', border: `1px solid ${T.danger}`, borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, fontSize: 13, color: T.text, lineHeight: 1.5 }}>
            <strong style={{ color: T.danger }}>Not saved.</strong> {error}
          </div>
          <button onClick={store.clearError} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 18, fontWeight: 700, cursor: 'pointer', padding: '0 4px' }}>
            ×
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Tile label="Take home" value={formatGBP(totals.takeHomePence)} color={T.accentBright} />
        <Tile label="Tax stash" value={formatGBP(totals.taxStashPence)} color={T.danger} />
        <Tile label="Gross earned" value={formatGBP(totals.grossPence)} color={T.text} />
        <Tile label="Business costs" value={formatGBP(totals.deductibleExpensesPence)} color={T.expense} />
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label htmlFor="taxpct" style={{ fontSize: 13, color: T.textMuted, flex: 1 }}>
          Tax set-aside
        </label>
        <input
          id="taxpct"
          type="range"
          min={0}
          max={45}
          step={1}
          value={settings.taxPercent}
          onChange={(e) => store.updateSettings({ taxPercent: Number(e.target.value) })}
          style={{ accentColor: T.accent, width: 140 }}
        />
        <span style={{ fontFamily: fonts.mono, fontSize: 15, fontWeight: 700, color: T.accent, width: 44, textAlign: 'right' }}>
          {settings.taxPercent}%
        </span>
      </div>

      <QuickAdd onAddIncome={store.addIncome} onAddExpense={store.addExpense} />

      <RecentList
        income={income}
        expenses={expenses}
        onRemoveIncome={store.removeIncome}
        onRemoveExpense={store.removeExpense}
      />
    </div>
  );
}
