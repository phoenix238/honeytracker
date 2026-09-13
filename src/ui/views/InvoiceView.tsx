import { useMemo, useState } from 'react';
import { formatGBP, parsePence, percentOf, sumPence } from '../../core/money';
import { mkId } from '../../core/id';
import { nextInvoiceNumber } from '../../core/invoice';
import type { Invoice, InvoiceLine } from '../../core/types';
import { fonts, pageBackground, type Theme } from '../theme';
import { Glass } from '../components/Glass';
import { PillButton } from '../components/PillButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { Avatar } from '../components/Avatar';
import { PlusIcon, ClockIcon } from '../icons';
import type { Store } from '../useStore';

interface DraftLine {
  id: string;
  label: string;
  qty: string;
  rate: string;
}

function dueInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function lineAmount(l: DraftLine): number {
  return Math.round((parseFloat(l.qty) || 0) * parsePence(l.rate));
}

export function InvoiceView({ store, T, onDone }: { store: Store; T: Theme; onDone: () => void }) {
  const [client, setClient] = useState('');
  const [email, setEmail] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ id: mkId(), label: '', qty: '1', rate: '' }]);

  const subtotal = useMemo(() => sumPence(lines.map(lineAmount)), [lines]);
  const taxSetAside = percentOf(subtotal, store.settings.taxPercent);
  const number = useMemo(() => nextInvoiceNumber(store.invoices), [store.invoices]);
  const dueDate = dueInDays(14);

  const updateLine = (id: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, { id: mkId(), label: '', qty: '1', rate: '' }]);
  const removeLine = (id: string) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const canSend = client.trim().length > 0 && subtotal > 0;

  const send = () => {
    if (!canSend) return;
    const invoiceLines: InvoiceLine[] = lines
      .filter((l) => lineAmount(l) > 0)
      .map((l) => ({ id: l.id, label: l.label.trim() || 'Work', qty: parseFloat(l.qty) || 0, unitPence: parsePence(l.rate) }));
    const invoice: Invoice = {
      id: mkId(),
      number,
      client: client.trim(),
      clientEmail: email.trim() || undefined,
      lines: invoiceLines,
      dueDate,
      status: 'sent',
      createdAt: new Date().toISOString(),
    };
    store.addInvoice(invoice);
    onDone();
  };

  return (
    <div style={{ background: pageBackground(T, 'accent'), borderRadius: 32, padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ScreenHeader
        T={T}
        title="Invoice"
        onBack={onDone}
        right={
          <span style={{ padding: '5px 12px', borderRadius: 999, background: T.mode === 'dark' ? T.ramp.accent2[800] : T.ramp.accent2[200], color: T.mode === 'dark' ? T.ramp.accent2[100] : T.ramp.accent2[900], fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}>
            DRAFT
          </span>
        }
      />

      <Glass T={T} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
        <Avatar label={client || '?'} size={44} bg={T.ramp.accent2[T.mode === 'dark' ? 600 : 400]} color={T.mode === 'dark' ? T.ramp.accent2[100] : T.ramp.accent2[900]} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="Client name"
            style={{ background: 'none', border: 'none', outline: 'none', fontFamily: fonts.body, fontWeight: 700, fontSize: 15, color: T.text }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.textMuted }}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@email.co"
              style={{ background: 'none', border: 'none', outline: 'none', font: 'inherit', color: 'inherit', width: '55%' }}
            />
            <span>· {number}</span>
          </div>
        </div>
      </Glass>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted }}>Lines</span>

        {lines.map((l) => (
          <Glass key={l.id} T={T} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <input
                value={l.label}
                onChange={(e) => updateLine(l.id, { label: e.target.value })}
                placeholder="Line item"
                style={{ background: 'none', border: 'none', outline: 'none', fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: T.text }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMuted }}>
                <input
                  value={l.qty}
                  onChange={(e) => updateLine(l.id, { qty: e.target.value })}
                  inputMode="decimal"
                  style={{ width: 26, background: 'none', border: 'none', outline: 'none', font: 'inherit', color: 'inherit' }}
                />
                <span>×</span>
                <span>£</span>
                <input
                  value={l.rate}
                  onChange={(e) => updateLine(l.id, { rate: e.target.value })}
                  inputMode="decimal"
                  placeholder="0.00"
                  style={{ width: 54, background: 'none', border: 'none', outline: 'none', font: 'inherit', color: 'inherit' }}
                />
              </div>
            </div>
            <span style={{ fontFamily: fonts.display, fontSize: 16, color: T.text, flexShrink: 0 }}>{formatGBP(lineAmount(l))}</span>
            <button onClick={() => removeLine(l.id)} aria-label="Remove line" style={{ background: 'none', border: 'none', color: T.textFaint, cursor: 'pointer', fontSize: 16, padding: '0 2px' }}>×</button>
          </Glass>
        ))}

        <button
          onClick={addLine}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 18px', borderRadius: 20, border: `1px dashed ${T.mode === 'dark' ? T.ramp.neutral[600] : T.ramp.neutral[400]}`, color: T.textMuted, fontSize: 13, fontWeight: 700, background: 'none', cursor: 'pointer' }}
        >
          <PlusIcon size={16} color={T.textMuted} /> Add a line
        </button>
      </div>

      <Glass T={T} strong style={{ padding: '16px 20px', boxShadow: T.shadowSm }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: T.text, paddingBottom: 6 }}>
          <span>Subtotal</span><span style={{ fontWeight: 700 }}>{formatGBP(subtotal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: T.mode === 'dark' ? T.ramp.accent2[300] : T.ramp.accent2[800], paddingBottom: 10 }}>
          <span>You'll set aside {store.settings.taxPercent}%</span><span style={{ fontWeight: 700 }}>{formatGBP(taxSetAside)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
          <span style={{ fontWeight: 700, color: T.text }}>Total due</span>
          <span style={{ fontFamily: fonts.display, fontSize: 26, color: T.text }}>{formatGBP(subtotal)}</span>
        </div>
      </Glass>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: T.textMuted }}>
        <ClockIcon size={16} color={T.textMuted} /> Due in 14 days · {new Date(dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
      </div>

      <PillButton T={T} onClick={send} disabled={!canSend}>Send invoice</PillButton>
    </div>
  );
}
