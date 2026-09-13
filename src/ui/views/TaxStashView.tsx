import { useMemo } from 'react';
import { deriveTotals } from '../../core/tax';
import { formatGBP, percentOf } from '../../core/money';
import { nextJan31 } from '../../core/dates';
import { fonts, pageBackground, type Theme } from '../theme';
import { MoneyRings } from '../components/Rings';
import { Glass } from '../components/Glass';
import { PillButton } from '../components/PillButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { Avatar } from '../components/Avatar';
import { ActivityRow } from '../components/Rows';
import { ClockIcon } from '../icons';
import type { Store } from '../useStore';

export function TaxStashView({ store, T, onDone }: { store: Store; T: Theme; onDone: () => void }) {
  const { income, expenses, settings } = store;
  const totals = useMemo(() => deriveTotals(income, expenses, settings), [income, expenses, settings]);

  const stash = totals.taxStashPence;
  const saved = Math.min(settings.taxSavedPence, stash);
  const toGo = Math.max(0, stash - saved);
  const progress = stash > 0 ? Math.min(100, (saved / stash) * 100) : 0;

  const held = useMemo(
    () =>
      [...income]
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 8)
        .map((i) => ({ ...i, cut: percentOf(i.grossPence, settings.taxPercent) })),
    [income, settings.taxPercent],
  );

  const moveToSavings = () => store.updateSettings({ taxSavedPence: stash });

  return (
    <div style={{ background: pageBackground(T, 'accent2'), borderRadius: 32, padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ScreenHeader T={T} title="Tax stash" onBack={onDone} />

      <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 2px' }}>
        <MoneyRings
          size={238}
          T={T}
          cutoutColor={T.bg}
          rings={[{ percent: progress, color: T.ramp.accent2[500], track: T.mode === 'dark' ? T.ramp.accent2[800] : T.ramp.accent2[200] }]}
          center={
            <>
              <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted }}>Set aside</span>
              <span style={{ fontFamily: fonts.display, fontSize: 40, lineHeight: 1.05, color: T.mode === 'dark' ? T.ramp.accent2[200] : T.ramp.accent2[900] }}>{formatGBP(stash)}</span>
              <span style={{ fontSize: 11, color: T.textMuted }}>{Math.round(progress)}% moved to savings</span>
            </>
          }
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 11, color: T.textMuted, padding: '2px 0 4px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 999, background: T.ramp.accent2[500] }} />Saved {formatGBP(saved)}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 999, background: T.mode === 'dark' ? T.ramp.accent2[800] : T.ramp.accent2[200] }} />To go {formatGBP(toGo)}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted }}>Held back from</span>
        {held.length === 0 ? (
          <div style={{ fontSize: 13, color: T.textFaint, textAlign: 'center', padding: '12px 0' }}>No income logged yet.</div>
        ) : (
          held.map((i) => (
            <ActivityRow
              key={i.id}
              T={T}
              avatar={<Avatar label={i.client || 'Income'} size={38} bg={T.ramp.accent2[T.mode === 'dark' ? 600 : 400]} color={T.mode === 'dark' ? T.ramp.accent2[100] : T.ramp.accent2[900]} />}
              title={i.client || (i.method === 'cash' ? 'Cash payment' : 'Income')}
              subtitle={`${i.date} · ${settings.taxPercent}% of ${formatGBP(i.grossPence)}`}
              amount={formatGBP(i.cut)}
              amountColor={T.mode === 'dark' ? T.ramp.accent2[300] : T.ramp.accent2[800]}
            />
          ))
        )}
      </div>

      <Glass T={T} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: T.mode === 'dark' ? 'rgba(158,176,132,0.16)' : 'rgba(226,238,204,0.6)' }}>
        <ClockIcon size={20} color={T.mode === 'dark' ? T.ramp.accent2[300] : T.ramp.accent2[800]} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: T.mode === 'dark' ? T.ramp.accent2[100] : T.ramp.accent2[900] }}>Self-assessment balancing payment</div>
          <div style={{ fontSize: 11, color: T.mode === 'dark' ? T.ramp.accent2[200] : T.ramp.accent2[800] }}>Due {new Date(nextJan31()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · est. {formatGBP(stash)}</div>
        </div>
      </Glass>

      <PillButton T={T} variant="glass" onClick={moveToSavings} disabled={toGo <= 0}>
        {toGo <= 0 ? 'Fully moved to savings' : 'Move to savings'}
      </PillButton>
    </div>
  );
}
