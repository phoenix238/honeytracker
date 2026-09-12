import { useMemo } from 'react';
import { deriveTotals } from '../../core/tax';
import { formatGBP } from '../../core/money';
import { ukTaxYearStart, taxYearLabel } from '../../core/dates';
import { T, fonts } from '../theme';
import { Tile } from '../components/Tile';
import type { Store } from '../useStore';

function thisMonthGrossPence(income: Store['income'], now: Date): number {
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return income.filter((i) => i.date.startsWith(prefix)).reduce((sum, i) => sum + i.grossPence, 0);
}

export function HomeView({ store, onSeeAll }: { store: Store; onSeeAll: () => void }) {
  const { income, expenses, settings } = store;
  const totals = useMemo(() => deriveTotals(income, expenses, settings), [income, expenses, settings]);
  const now = new Date();
  const monthGross = useMemo(() => thisMonthGrossPence(income, now), [income, now]);
  const year = ukTaxYearStart(now);
  const entryCount = income.length + expenses.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: fonts.display, fontSize: 26, fontWeight: 800, color: T.accent }}>Honey</div>
        <div style={{ fontFamily: fonts.mono, fontSize: 11, color: T.textMuted }}>Tax year {taxYearLabel(year)}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Tile label="Take home" value={formatGBP(totals.takeHomePence)} color={T.accentBright} />
        <Tile label="Tax stash" value={formatGBP(totals.taxStashPence)} color={T.danger} sub={`${settings.taxPercent}% after costs`} />
        <Tile label="Gross earned" value={formatGBP(totals.grossPence)} color={T.text} />
        <Tile label="Business costs" value={formatGBP(totals.deductibleExpensesPence)} color={T.expense} />
      </div>

      <div style={{ background: T.accent + '0f', border: `1px solid ${T.accent}44`, borderRadius: 14, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: T.accent, textTransform: 'uppercase' }}>Safe stash</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>If none of your costs are allowed — {settings.taxPercent}% of all gross</div>
        </div>
        <div style={{ fontFamily: fonts.mono, fontSize: 20, fontWeight: 700, color: T.accent }}>{formatGBP(totals.safeStashPence)}</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: T.textMuted }}>
        <span>This month in: {formatGBP(monthGross)}</span>
        <span>{entryCount} {entryCount === 1 ? 'entry' : 'entries'}</span>
      </div>

      {entryCount === 0 ? (
        <div style={{ fontSize: 13, color: T.textFaint, textAlign: 'center', padding: '20px 0', lineHeight: 1.5 }}>
          Nothing logged yet.<br />Tap <strong style={{ color: T.text }}>Money</strong> to add income or an expense.
        </div>
      ) : (
        <button
          onClick={onSeeAll}
          style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px', color: T.text, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}
        >
          See all activity in Money →
        </button>
      )}
    </div>
  );
}
