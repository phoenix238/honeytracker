import { useMemo, useState } from 'react';
import { parsePence, formatAmount, formatGBP, percentOf } from '../../core/money';
import { mkId } from '../../core/id';
import { today } from '../../core/dates';
import type { Income } from '../../core/types';
import { fonts, pageBackground, type Theme } from '../theme';
import { MoneyRings } from '../components/Rings';
import { Glass } from '../components/Glass';
import { FieldRow, TextFieldPill } from '../components/FieldRow';
import { PillButton } from '../components/PillButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { Avatar } from '../components/Avatar';
import { ChevronRightIcon } from '../icons';
import type { Store } from '../useStore';

type Mode = 'day' | 'hourly' | 'fixed';

function monthLabel(now: Date): string {
  return now.toLocaleDateString('en-GB', { month: 'long' });
}

export function LogWorkView({ store, T, onDone }: { store: Store; T: Theme; onDone: () => void }) {
  const { settings } = store;
  const [client, setClient] = useState('');
  const [mode, setMode] = useState<Mode>('day');
  const [units, setUnits] = useState('1');
  const [rate, setRate] = useState(formatAmount(settings.defaultRatePence));
  const [fixed, setFixed] = useState('');

  const grossPence = useMemo(() => {
    if (mode === 'fixed') return parsePence(fixed);
    return Math.round(parsePence(units) * parsePence(rate));
  }, [mode, units, rate, fixed]);

  const taxPence = percentOf(grossPence, settings.taxPercent);
  const takeHomePence = grossPence - taxPence;
  const taxPercentOfRing = grossPence > 0 ? Math.min(100, (taxPence / grossPence) * 100) : 0;

  const submit = () => {
    if (grossPence <= 0) return;
    const record: Income = {
      id: mkId(),
      date: today(),
      grossPence,
      method: 'bank',
      client: client.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    store.addIncome(record);
    onDone();
  };

  const segOption = (value: Mode, label: string) => (
    <span
      onClick={() => setMode(value)}
      style={{
        flex: 1,
        textAlign: 'center',
        padding: 9,
        borderRadius: 999,
        background: mode === value ? T.bg : 'transparent',
        boxShadow: mode === value ? T.shadowSm : undefined,
        fontWeight: mode === value ? 700 : 400,
        fontSize: 13,
        color: mode === value ? T.text : T.textMuted,
        cursor: 'pointer',
      }}
    >
      {label}
    </span>
  );

  return (
    <div style={{ background: pageBackground(T, 'accent'), borderRadius: 32, padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ScreenHeader T={T} title="Log work" onBack={onDone} right={<span style={{ fontSize: 12, color: T.textMuted }}>{monthLabel(new Date())}</span>} />

      <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
        <MoneyRings
          size={172}
          T={T}
          cutoutColor={T.bg}
          rings={[{ percent: taxPercentOfRing, color: T.ramp.accent[500], track: T.ramp.accent2[500] }]}
          center={
            <>
              <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted }}>This entry</span>
              <span style={{ fontFamily: fonts.display, fontSize: 34, lineHeight: 1.05, color: T.text }}>{formatGBP(grossPence)}</span>
            </>
          }
        />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, background: T.mode === 'dark' ? 'rgba(158,176,132,0.18)' : 'rgba(226,238,204,0.7)', fontSize: 12, color: T.mode === 'dark' ? T.ramp.accent2[100] : T.ramp.accent2[900] }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: T.ramp.accent2[500] }} />Tax {formatGBP(taxPence)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, background: T.mode === 'dark' ? 'rgba(224,146,90,0.18)' : 'rgba(255,236,222,0.7)', fontSize: 12, color: T.mode === 'dark' ? T.ramp.accent[100] : T.ramp.accent[900] }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: T.ramp.accent[500] }} />Take-home {formatGBP(takeHomePence)}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted, padding: '0 4px 6px' }}>Client</div>
          <Glass T={T} pill style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px 10px 10px' }}>
            <Avatar label={client || '?'} size={38} bg={T.ramp.accent2[T.mode === 'dark' ? 600 : 400]} color={T.mode === 'dark' ? T.ramp.accent2[100] : T.ramp.accent2[900]} />
            <input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Who from"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', font: 'inherit', fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: T.text }}
            />
            <ChevronRightIcon size={18} color={T.textMuted} />
          </Glass>
        </div>

        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted, padding: '0 4px 6px' }}>How you charge</div>
          <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 999, background: T.surface }}>
            {segOption('day', 'Day rate')}
            {segOption('hourly', 'Hourly')}
            {segOption('fixed', 'Fixed')}
          </div>
        </div>

        {mode === 'fixed' ? (
          <TextFieldPill T={T} label="Amount" value={fixed} onChange={setFixed} placeholder="0.00" inputMode="decimal" />
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted, padding: '0 4px 6px' }}>{mode === 'day' ? 'Days' : 'Hours'}</div>
              <Glass T={T} pill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48 }}>
                <input
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                  inputMode="decimal"
                  style={{ width: '100%', textAlign: 'center', background: 'none', border: 'none', outline: 'none', fontFamily: fonts.display, fontSize: 17, color: T.text }}
                />
              </Glass>
            </div>
            <div style={{ flex: 2 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted, padding: '0 4px 6px' }}>Rate</div>
              <Glass T={T} pill style={{ display: 'flex', alignItems: 'center', padding: '0 18px', height: 48, gap: 8 }}>
                <span style={{ fontFamily: fonts.display, fontSize: 17, color: T.text }}>£</span>
                <input
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  inputMode="decimal"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontFamily: fonts.display, fontSize: 17, color: T.text }}
                />
                <span style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: 700, color: T.textMuted }}>/ {mode === 'day' ? 'day' : 'hr'}</span>
              </Glass>
            </div>
          </div>
        )}

        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted, padding: '0 4px 6px' }}>When</div>
          <FieldRow T={T} label="" labelWidth={0}>
            <span style={{ fontWeight: 700, fontSize: 14, color: T.text }}>Today · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
          </FieldRow>
        </div>
      </div>

      <PillButton T={T} onClick={submit} disabled={grossPence <= 0}>Add to {monthLabel(new Date())}</PillButton>
    </div>
  );
}
