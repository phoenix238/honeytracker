import { useMemo } from 'react';
import { deriveTotals } from '../core/tax';
import { formatGBP } from '../core/money';
import { ukTaxYearStart, taxYearLabel } from '../core/dates';
import type { Income, Expense, Settings } from '../core/types';
import { T, fonts } from './theme';

interface HomeProps {
  income: Income[];
  expenses: Expense[];
  settings: Settings;
  onTaxPercentChange: (percent: number) => void;
}

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

export function Home({ income, expenses, settings, onTaxPercentChange }: HomeProps) {
  // Numbers are derived on render from the facts + current settings — never stored.
  const totals = useMemo(() => deriveTotals(income, expenses, settings), [income, expenses, settings]);
  const year = ukTaxYearStart();

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: fonts.display, fontSize: 26, fontWeight: 800, color: T.accent }}>Honey</div>
        <div style={{ fontFamily: fonts.mono, fontSize: 11, color: T.textMuted }}>Tax year {taxYearLabel(year)}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Tile label="Take home" value={formatGBP(totals.takeHomePence)} color={T.accentBright} />
        <Tile label="Tax stash" value={formatGBP(totals.taxStashPence)} color={T.danger} />
        <Tile label="Gross earned" value={formatGBP(totals.grossPence)} color={T.text} />
        <Tile label="Business costs" value={formatGBP(totals.deductibleExpensesPence)} color={T.expense} />
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label htmlFor="taxpct" style={{ fontSize: 13, color: T.textMuted, flex: 1 }}>
          Tax set-aside — drag to see every figure re-derive
        </label>
        <input
          id="taxpct"
          type="range"
          min={0}
          max={45}
          step={1}
          value={settings.taxPercent}
          onChange={(e) => onTaxPercentChange(Number(e.target.value))}
          style={{ accentColor: T.accent, width: 140 }}
        />
        <span style={{ fontFamily: fonts.mono, fontSize: 15, fontWeight: 700, color: T.accent, width: 44, textAlign: 'right' }}>
          {settings.taxPercent}%
        </span>
      </div>

      <p style={{ fontSize: 12, color: T.textFaint, lineHeight: 1.5, margin: 0 }}>
        Every figure above is computed from stored facts (gross amounts and expenses) against the
        current set-aside rate — nothing is frozen at entry time, so changing the rate corrects
        all of them at once.
      </p>
    </div>
  );
}
