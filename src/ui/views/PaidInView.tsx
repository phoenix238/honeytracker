import { useMemo, useState } from 'react';
import { formatGBP, percentOf } from '../../core/money';
import { invoiceTotalPence } from '../../core/invoice';
import { mkId } from '../../core/id';
import { today } from '../../core/dates';
import type { Income, IncomeMethod, Invoice } from '../../core/types';
import { fonts, pageBackground, type Theme } from '../theme';
import { MoneyRings } from '../components/Rings';
import { Glass } from '../components/Glass';
import { FieldRow } from '../components/FieldRow';
import { PillButton } from '../components/PillButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { Avatar } from '../components/Avatar';
import { CheckIcon } from '../icons';
import type { Store } from '../useStore';

export function PaidInView({ store, T, onDone }: { store: Store; T: Theme; onDone: () => void }) {
  const pending = useMemo(() => store.invoices.filter((i) => i.status === 'sent'), [store.invoices]);
  const [selectedId, setSelectedId] = useState<string | undefined>(pending.length === 1 ? pending[0]?.id : undefined);
  const [method, setMethod] = useState<IncomeMethod>('bank');
  const selected = pending.find((i) => i.id === selectedId);

  const markPaid = (invoice: Invoice) => {
    const grossPence = invoiceTotalPence(invoice);
    const record: Income = {
      id: mkId(),
      date: today(),
      grossPence,
      method,
      client: invoice.client,
      documentId: invoice.id,
      createdAt: new Date().toISOString(),
    };
    store.addIncome(record);
    store.updateInvoice({ ...invoice, status: 'paid', incomeId: record.id });
    onDone();
  };

  if (pending.length === 0) {
    return (
      <div style={{ background: pageBackground(T, 'accent'), borderRadius: 32, padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ScreenHeader T={T} title="Paid in" onBack={onDone} />
        <div style={{ fontSize: 13, color: T.textFaint, textAlign: 'center', padding: '32px 12px', lineHeight: 1.6 }}>
          No invoices waiting to be paid.<br />Send one from <strong style={{ color: T.text }}>Invoice</strong> first.
        </div>
      </div>
    );
  }

  if (!selected) {
    return (
      <div style={{ background: pageBackground(T, 'accent'), borderRadius: 32, padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ScreenHeader T={T} title="Paid in" onBack={onDone} />
        <div style={{ fontSize: 12, color: T.textMuted, padding: '0 4px' }}>Which invoice landed?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pending.map((inv) => (
            <button key={inv.id} onClick={() => setSelectedId(inv.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
              <Glass T={T} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                <Avatar label={inv.client} size={38} bg={T.ramp.accent[T.mode === 'dark' ? 600 : 300]} color={T.mode === 'dark' ? T.ramp.accent[100] : T.ramp.accent[900]} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: T.text }}>{inv.client}</div>
                  <div style={{ fontSize: 11, color: T.textMuted }}>{inv.number}</div>
                </div>
                <span style={{ fontFamily: fonts.display, fontSize: 16, color: T.text }}>{formatGBP(invoiceTotalPence(inv))}</span>
              </Glass>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const total = invoiceTotalPence(selected);
  const taxCut = percentOf(total, store.settings.taxPercent);
  const takeHome = total - taxCut;

  const methodChip = (value: IncomeMethod, label: string) => (
    <span
      onClick={() => setMethod(value)}
      style={{
        flex: 1,
        textAlign: 'center',
        padding: '8px 6px',
        borderRadius: 999,
        background: method === value ? T.accent + '22' : 'transparent',
        border: `1px solid ${method === value ? T.accent : T.border}`,
        color: method === value ? T.accent : T.textMuted,
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {label}
    </span>
  );

  return (
    <div style={{ background: pageBackground(T, 'accent'), borderRadius: 32, padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ScreenHeader T={T} title="Paid in" onBack={onDone} />

      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
        <MoneyRings
          size={196}
          T={T}
          cutoutColor={T.bg}
          rings={[{ percent: 100, color: T.ramp.accent2[500], track: T.ramp.accent2[500] }]}
          centerGlass
          center={
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 999, background: T.ramp.accent2[500], color: '#fff', marginBottom: 2 }}>
                <CheckIcon size={20} color="#fff" />
              </span>
              <span style={{ fontFamily: fonts.display, fontSize: 32, lineHeight: 1.05, color: T.text }}>{formatGBP(total)}</span>
              <span style={{ fontSize: 11, color: T.textMuted }}>received</span>
            </>
          }
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 4px 0' }}>
        <Avatar label={selected.client} size={42} bg={T.ramp.accent[T.mode === 'dark' ? 600 : 400]} color={T.mode === 'dark' ? T.ramp.accent[100] : T.ramp.accent[900]} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>{selected.client}</div>
          <div style={{ fontSize: 12, color: T.textMuted }}>Invoice {selected.number} · settled in full</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <FieldRow T={T} label="When" labelWidth={70}>
          <span style={{ fontWeight: 700, fontSize: 15, color: T.text }}>Today · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        </FieldRow>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted, padding: '0 4px 6px' }}>Method</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {methodChip('bank', 'Bank')}
            {methodChip('cash', 'Cash')}
            {methodChip('other', 'Other')}
          </div>
        </div>

        <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted, padding: '6px 4px 0' }}>Splits into</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <Glass T={T} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 16px', background: T.mode === 'dark' ? 'rgba(158,176,132,0.16)' : 'rgba(226,238,204,0.6)' }}>
            <span style={{ fontFamily: fonts.display, fontSize: 20, color: T.mode === 'dark' ? T.ramp.accent2[200] : T.ramp.accent2[900] }}>{formatGBP(taxCut)}</span>
            <span style={{ fontSize: 11, color: T.mode === 'dark' ? T.ramp.accent2[300] : T.ramp.accent2[800] }}>to tax stash</span>
          </Glass>
          <Glass T={T} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 16px', background: T.mode === 'dark' ? 'rgba(224,146,90,0.16)' : 'rgba(255,236,222,0.6)' }}>
            <span style={{ fontFamily: fonts.display, fontSize: 20, color: T.mode === 'dark' ? T.ramp.accent[200] : T.ramp.accent[900] }}>{formatGBP(takeHome)}</span>
            <span style={{ fontSize: 11, color: T.mode === 'dark' ? T.ramp.accent[300] : T.ramp.accent[800] }}>take-home</span>
          </Glass>
        </div>
      </div>

      <PillButton T={T} onClick={() => markPaid(selected)}>Mark as paid</PillButton>
    </div>
  );
}
