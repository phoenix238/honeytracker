import { useEffect, useMemo, useState } from 'react';
import { T, fonts } from '../theme';
import { Button, Card, Chip, Empty, Field, Money, Sheet, fmtDate, inputStyle } from '../components';
import { api, type CalendarEvent } from '../api';
import { formatInvoiceNumber, hasWorkDates, hoursBetween, invoiceTotal, lineAmount, lineWhen } from '../../core/invoices';
import { addDays } from '../../core/dates';
import { formatGBP } from '../../core/money';
import type { BusinessProfile, InvoiceLine } from '../../core/types';
import type { App } from '../useApp';

// The pieces of the invoice screen: what number comes next, time worked as start–end, events
// picked straight from your calendar, and a preview of the invoice as the client will see it.

/** "Next invoice: INV57 · Change" — starting partway through the year means starting later than 1. */
export function NextNumber({ app }: { app: App }) {
  const data = app.data!;
  const profile = data.settings.profile;
  const [editing, setEditing] = useState(false);
  const [prefix, setPrefix] = useState(profile.invoicePrefix);
  const [n, setN] = useState(String(data.invoiceCounter));
  useEffect(() => {
    setPrefix(profile.invoicePrefix);
    setN(String(data.invoiceCounter));
  }, [profile.invoicePrefix, data.invoiceCounter]);

  const save = async () => {
    const saved = await api.saveSettingsWithCounter({ profile: { ...profile, invoicePrefix: prefix.trim() || 'INV' }, nextInvoiceNumber: Number(n) || 1 }).catch((e: Error) => {
      app.notify(e.message);
      return null;
    });
    if (!saved) return;
    await app.reload();
    setEditing(false);
  };

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: T.textMuted }}>
        <span style={{ flex: 1 }}>
          Next invoice: <strong style={{ color: T.text, fontFamily: fonts.mono }}>{formatInvoiceNumber(profile.invoicePrefix, data.invoiceCounter)}</strong>
        </span>
        <Button tone="quiet" onClick={() => setEditing(true)} style={{ padding: '4px 6px', fontSize: 12 }}>Change</Button>
      </div>
    );
  }
  return (
    <Card style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="Starts with"><input style={inputStyle} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="INV" /></Field>
        <Field label="Next number"><input style={inputStyle} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} /></Field>
      </div>
      <div style={{ fontSize: 12, color: T.textMuted }}>
        The next invoice will be <strong style={{ color: T.text }}>{formatInvoiceNumber(prefix.trim() || 'INV', Number(n) || 1)}</strong>. A number already used is skipped.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button tone="primary" onClick={save} style={{ flex: 1 }}>Save</Button>
        <Button tone="quiet" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </Card>
  );
}

/** Start and end times for a line: the hours and the wording fill themselves in. */
/** Start and end times for a line; the hours between them become its quantity. */
export function TimeFields({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (v: { start: string; end: string; hours: number | null }) => void;
}) {
  const set = (patch: Partial<{ start: string; end: string }>) => {
    const next = { start, end, ...patch };
    onChange({ ...next, hours: hoursBetween(next.start, next.end) });
  };
  const hours = hoursBetween(start, end);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'end' }}>
      <Field label="Start"><input style={inputStyle} type="time" value={start} onChange={(e) => set({ start: e.target.value })} /></Field>
      <Field label={hours ? `End · ${hours}h` : 'End'}><input style={inputStyle} type="time" value={end} onChange={(e) => set({ end: e.target.value })} /></Field>
    </div>
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
function monthRange(today: string, back: number): { from: string; to: string } {
  const d = new Date(`${today}T12:00:00Z`);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { from: iso(first), to: iso(last) };
}

/** Pick sessions or shifts from your calendar; each becomes a line, by the hour or by the session. */
export function CalendarPicker({
  app,
  open,
  onClose,
  onAdd,
  rateHint,
}: {
  app: App;
  open: boolean;
  onClose: () => void;
  onAdd: (lines: { description: string; quantity: number; date: string; start: string | null; end: string | null }[]) => void;
  rateHint: string;
}) {
  const data = app.data!;
  const [range, setRange] = useState(() => monthRange(data.today, 0));
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [per, setPer] = useState<'hour' | 'session'>(() => {
    try {
      return localStorage.getItem('ht:calPer') === 'session' ? 'session' : 'hour';
    } catch {
      return 'hour';
    }
  });
  const linked = Boolean(data.settings.calendarUrl);

  useEffect(() => {
    if (!open || !linked) return;
    setEvents(null);
    setError('');
    api.calendarEvents(range.from, range.to).then((r) => setEvents(r.events)).catch((e: Error) => setError(e.message));
  }, [open, linked, range.from, range.to]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (events ?? []).filter((e) => !needle || `${e.title} ${e.location}`.toLowerCase().includes(needle));
  }, [events, q]);

  if (!open) return null;
  const add = () => {
    const chosen = (events ?? []).filter((e) => picked.has(e.id));
    try {
      localStorage.setItem('ht:calPer', per);
    } catch {
      /* only a convenience */
    }
    onAdd(chosen.map((e) => ({ description: e.title, quantity: per === 'hour' && e.hours ? e.hours : 1, date: e.date, start: e.start, end: e.end })));
    setPicked(new Set());
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="From your calendar">
      {!linked ? (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: T.textMuted }}>
          Link your calendar once in <strong style={{ color: T.text }}>Settings → Calendar</strong> (it takes a minute on a computer), then your sessions and shifts show up here to
          tick.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip active={range.from === monthRange(data.today, 0).from} onClick={() => setRange(monthRange(data.today, 0))}>This month</Chip>
            <Chip active={range.from === monthRange(data.today, 1).from} onClick={() => setRange(monthRange(data.today, 1))}>Last month</Chip>
            <Chip active={range.from === addDays(data.today, -13) && range.to === data.today} onClick={() => setRange({ from: addDays(data.today, -13), to: data.today })}>Last 2 weeks</Chip>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input style={inputStyle} type="date" value={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} aria-label="From" />
            <input style={inputStyle} type="date" value={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} aria-label="To" />
          </div>
          <input style={inputStyle} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — e.g. the client or place" />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: T.textMuted }}>
            Charge
            <Chip active={per === 'hour'} onClick={() => setPer('hour')}>by the hour</Chip>
            <Chip active={per === 'session'} onClick={() => setPer('session')}>per session</Chip>
            {rateHint && <span>at £{rateHint}</span>}
          </div>
          {error && <div style={{ fontSize: 13, color: T.danger, lineHeight: 1.5 }}>{error}</div>}
          {!events && !error && <div style={{ fontSize: 13, color: T.textMuted }}>Reading your calendar…</div>}
          {events && shown.length === 0 && <Empty>Nothing in the calendar for these dates{q ? ' matching that' : ''}.</Empty>}
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '45vh', overflowY: 'auto' }}>
            {shown.map((e) => (
              <label key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 2px', borderBottom: `1px solid ${T.border}`, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={picked.has(e.id)}
                  onChange={(ev) => {
                    const next = new Set(picked);
                    if (ev.target.checked) next.add(e.id);
                    else next.delete(e.id);
                    setPicked(next);
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{e.title}</span>
                  <span style={{ display: 'block', fontSize: 11, color: T.textMuted }}>
                    {fmtDate(e.date)}{e.start ? ` · ${e.start}–${e.end}` : ' · all day'}{e.location ? ` · ${e.location}` : ''}
                  </span>
                </span>
                <span style={{ fontFamily: fonts.mono, fontSize: 12, color: T.textMuted }}>{e.hours ? `${e.hours}h` : ''}</span>
              </label>
            ))}
          </div>
          <Button tone="primary" disabled={!picked.size} onClick={add}>
            Add {picked.size || ''} to the invoice
          </Button>
        </>
      )}
    </Sheet>
  );
}

/** The invoice as the client will see it — the same layout as the PDF. */
export function InvoicePreview({
  open,
  onClose,
  number,
  numberPending,
  issueDate,
  dueDate,
  clientName,
  clientEmail,
  clientAddress,
  lines,
  notes,
  lateNote,
  profile,
  onPdf,
}: {
  open: boolean;
  onClose: () => void;
  number: string;
  numberPending: boolean;
  issueDate: string;
  dueDate: string;
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  lines: InvoiceLine[];
  notes: string;
  /** The late-payment note, or '' when this invoice's stream has late fees off. */
  lateNote: string;
  profile: BusinessProfile;
  onPdf?: () => void;
}) {
  if (!open) return null;
  const ink = '#1a1a1a';
  const muted = '#6b6b6b';
  const gold = '#bd871a';
  const from = [profile.businessName && profile.name ? profile.name : '', ...profile.address.split('\n'), profile.email, profile.phone].filter(Boolean);
  const to = [...clientAddress.split('\n'), clientEmail].filter(Boolean);
  const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0$/, ''));
  const dated = hasWorkDates(lines);
  // What an invoice should carry that this one doesn't yet — shown to you, not on the invoice.
  const missing = [
    !profile.name && 'your name',
    !profile.address.trim() && 'your address',
    !profile.sortCode && !profile.accountNumber && 'your bank details',
    lines.some((l) => !l.date) && 'the date worked on every line',
  ].filter(Boolean) as string[];
  return (
    <Sheet open onClose={onClose} title="Preview">
      <div style={{ background: '#fff', color: ink, borderRadius: 6, padding: '22px 20px', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 12, lineHeight: 1.45, boxShadow: '0 4px 18px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{profile.businessName || profile.name || 'Your name — add it in Settings'}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: gold }}>INVOICE</div>
        </div>
        {from.map((l, i) => <div key={i} style={{ color: muted, fontSize: 10 }}>{l}</div>)}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 16 }}>
          <div>
            <div style={{ color: muted, fontSize: 10, fontWeight: 700 }}>Bill to</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{clientName || '—'}</div>
            {to.map((l, i) => <div key={i} style={{ color: muted, fontSize: 10 }}>{l}</div>)}
          </div>
          <div style={{ textAlign: 'right', fontSize: 11 }}>
            <div><span style={{ color: muted }}>Invoice no. </span><strong>{number}</strong>{numberPending && <span style={{ color: muted }}> (given when saved)</span>}</div>
            <div><span style={{ color: muted }}>Date </span><strong>{fmtDate(issueDate)}</strong></div>
            <div><span style={{ color: muted }}>Due </span><strong>{fmtDate(dueDate)}</strong></div>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 18, fontSize: 11 }}>
          <thead>
            <tr style={{ color: muted, textAlign: 'left', borderBottom: `1px solid ${muted}` }}>
              {dated && <th style={{ padding: '4px 6px 4px 0', fontWeight: 700 }}>Date</th>}
              <th style={{ padding: '4px 0', fontWeight: 700 }}>Description</th>
              <th style={{ padding: '4px 4px', textAlign: 'right' }}>Qty</th>
              <th style={{ padding: '4px 4px', textAlign: 'right' }}>Rate</th>
              <th style={{ padding: '4px 0', textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} style={{ verticalAlign: 'top' }}>
                {dated && (
                  <td style={{ padding: '6px 6px 6px 0', whiteSpace: 'nowrap' }}>
                    {lineWhen(l).day}
                    {lineWhen(l).time && <div style={{ color: muted, fontSize: 10 }}>{lineWhen(l).time}</div>}
                  </td>
                )}
                <td style={{ padding: '6px 0' }}>{l.description || '—'}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>{qty(l.quantity)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatGBP(l.unitPence)}</td>
                <td style={{ padding: '6px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatGBP(lineAmount(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, borderTop: `1px solid ${muted}`, marginTop: 4, paddingTop: 8, fontWeight: 700 }}>
          <span>Total due</span>
          <span style={{ fontSize: 14 }}>{formatGBP(invoiceTotal({ lines }))}</span>
        </div>
        {(profile.sortCode || profile.accountNumber) && (
          <div style={{ marginTop: 18, fontSize: 11 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>How to pay</div>
            {[['Account name', profile.businessName || profile.name], ['Sort code', profile.sortCode], ['Account number', profile.accountNumber], ['Reference', number]]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 10 }}>
                  <span style={{ color: muted, width: 100 }}>{k}</span>
                  <span style={{ fontWeight: k === 'Reference' ? 700 : 400 }}>{v}</span>
                </div>
              ))}
            <div style={{ color: muted, fontSize: 10, marginTop: 6 }}>Please use {number} as the payment reference so it’s matched to this invoice.</div>
          </div>
        )}
        {[notes, lateNote, profile.footer].filter(Boolean).map((b, i) => (
          <div key={i} style={{ color: muted, fontSize: 10, marginTop: 10, whiteSpace: 'pre-wrap' }}>{b}</div>
        ))}
      </div>
      {missing.length > 0 && (
        <div style={{ fontSize: 12, color: T.accentBright, lineHeight: 1.5 }}>
          Before you send: add {missing.join(', ').replace(/, ([^,]*)$/, ' and $1')}.
          {missing.some((m) => m !== 'the date worked on every line') && ' Your details are in Settings → Your details.'}
        </div>
      )}
      {onPdf && <Button onClick={onPdf}>Open the PDF</Button>}
      <div style={{ fontSize: 11, color: T.textMuted }}>Total <Money pence={invoiceTotal({ lines })} size={11} /></div>
    </Sheet>
  );
}
