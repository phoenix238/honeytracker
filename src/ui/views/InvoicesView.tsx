import { useEffect, useMemo, useState } from 'react';
import { T, fonts } from '../theme';
import { Button, Card, Chip, Empty, Field, Label, Money, Section, Sheet, Title, fmtDate, inputStyle } from '../components';
import { api, invoicePdfUrl } from '../api';
import { daysOverdue, formatInvoiceNumber, invoiceState, invoiceTotal, lateNoteFor, lineAmount, mentionsInvoice, owedSummary, paidDifference, pastClients, type InvoiceState } from '../../core/invoices';
import { CalendarPicker, InvoicePreview, NextNumber, TimeFields } from './invoiceParts';
import { addDays } from '../../core/dates';
import { formatAmount, formatGBP, parsePence } from '../../core/money';
import type { Invoice, InvoiceLine, Transaction } from '../../core/types';
import type { App } from '../useApp';

// Bills you send. They don't count as income until the money lands — then the bank payment
// that quotes the invoice number settles it by itself, and it's filed under its stream.

type Filter = 'owed' | 'draft' | 'paid' | 'all';

const STATE_LABEL: Record<InvoiceState, string> = { draft: 'Draft', open: 'Waiting', overdue: 'Overdue', paid: 'Paid', void: 'Void' };
const STATE_COLOR: Record<InvoiceState, string> = { draft: T.textMuted, open: T.blue, overdue: T.danger, paid: T.green, void: T.textFaint };

/** What actually came in for a paid invoice — and how far off the invoice it was. */
function paidLine(inv: Invoice, txns: readonly Transaction[]): string {
  const t = txns.find((x) => x.id === inv.paidTransactionId);
  if (!t) return 'Paid — counted as income under its stream.';
  const diff = paidDifference(t.amountPence, inv);
  const how = t.source === 'cash' ? 'in cash' : 'into the bank';
  return `Paid ${formatGBP(t.amountPence)} ${how} on ${fmtDate(t.date)}${diff ? ` — they ${diff} than the invoice` : ''}. Counted as income under its stream.`;
}

export function InvoicesView({ app }: { app: App }) {
  const data = app.data!;
  const [filter, setFilter] = useState<Filter>('owed');
  const [openId, setOpenId] = useState<string | 'new' | null>(null);
  const owed = owedSummary(data.invoices, data.today);
  const streams = new Map(data.streams.map((s) => [s.id, s]));
  const profileMissing = !data.settings.profile.sortCode && !data.settings.profile.accountNumber;

  const rows = data.invoices.filter((inv) => {
    const st = invoiceState(inv, data.today);
    if (filter === 'owed') return st === 'open' || st === 'overdue';
    if (filter === 'draft') return st === 'draft';
    if (filter === 'paid') return st === 'paid';
    return true;
  });
  const open = openId === 'new' ? null : data.invoices.find((i) => i.id === openId) ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Title right={<Button tone="primary" onClick={() => setOpenId('new')} style={{ padding: '9px 14px' }}>+ New invoice</Button>}>Invoices</Title>

      <NextNumber app={app} />

      {profileMissing && (
        <div style={{ fontSize: 12, color: T.accentBright, lineHeight: 1.5 }}>
          Add your bank details in Settings → Your details, so invoices say how to pay you.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Card>
          <Label>Owed to you</Label>
          <div style={{ marginTop: 6 }}><Money pence={owed.totalPence} size={20} color={T.text} /></div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>{owed.count} invoice{owed.count === 1 ? '' : 's'}</div>
        </Card>
        <Card style={{ borderColor: owed.overdueCount ? T.danger + '88' : T.border }}>
          <Label color={owed.overdueCount ? T.danger : T.textMuted}>Overdue</Label>
          <div style={{ marginTop: 6 }}><Money pence={owed.overduePence} size={20} color={owed.overdueCount ? T.danger : T.textMuted} /></div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>{owed.overdueCount} to chase</div>
        </Card>
      </div>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        <Chip active={filter === 'owed'} onClick={() => setFilter('owed')}>Waiting</Chip>
        <Chip active={filter === 'draft'} onClick={() => setFilter('draft')}>Drafts</Chip>
        <Chip active={filter === 'paid'} onClick={() => setFilter('paid')}>Paid</Chip>
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
      </div>

      {rows.length === 0 ? (
        <Empty>{filter === 'owed' ? 'Nobody owes you anything right now.' : 'No invoices here yet.'}</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((inv) => {
            const st = invoiceState(inv, data.today);
            const stream = inv.streamId ? streams.get(inv.streamId) : null;
            return (
              <button
                key={inv.id}
                type="button"
                onClick={() => setOpenId(inv.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 2px', background: 'none', border: 'none', borderBottom: `1px solid ${T.border}`, textAlign: 'left', cursor: 'pointer', color: T.text, width: '100%' }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inv.clientName || 'No client yet'}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                    {[inv.number, stream?.name, st === 'overdue' ? `${daysOverdue(inv, data.today)} days late` : st === 'open' ? `due ${fmtDate(inv.dueDate)}` : fmtDate(inv.issueDate)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <Money pence={invoiceTotal(inv)} size={14} />
                  <span style={{ display: 'block', fontSize: 10, fontWeight: 700, color: STATE_COLOR[st], marginTop: 2, fontFamily: fonts.mono, textTransform: 'uppercase' }}>{STATE_LABEL[st]}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {openId && <InvoiceSheet app={app} invoice={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

interface LineDraft {
  description: string;
  quantity: string;
  rate: string;
  /** The day worked. */
  date: string;
  /** Start and end, when the line is entered as times rather than hours. */
  timed: boolean;
  start: string;
  end: string;
}

const toDraft = (l: InvoiceLine): LineDraft => ({
  description: l.description,
  quantity: String(l.quantity),
  rate: formatAmount(l.unitPence),
  date: l.date ?? '',
  timed: Boolean(l.start && l.end),
  start: l.start ?? '',
  end: l.end ?? '',
});
const fromDraft = (l: LineDraft): InvoiceLine => ({
  description: l.description.trim(),
  quantity: Number(l.quantity) || 0,
  unitPence: parsePence(l.rate),
  date: l.date || null,
  start: l.timed && l.start && l.end ? l.start : null,
  end: l.timed && l.start && l.end ? l.end : null,
});
const blankLine = (date: string, rate = ''): LineDraft => ({ description: '', quantity: '1', rate, date, timed: false, start: '', end: '' });

function InvoiceSheet({ app, invoice, onClose }: { app: App; invoice: Invoice | null; onClose: () => void }) {
  const data = app.data!;
  const streams = data.streams.filter((s) => !s.archived);
  const terms = data.settings.profile.paymentTermsDays;
  const [id, setId] = useState<string | null>(invoice?.id ?? null);
  const current = data.invoices.find((i) => i.id === id) ?? invoice;
  const st = current ? invoiceState(current, data.today) : 'draft';
  const locked = st === 'paid' || st === 'void';

  const [clientName, setClientName] = useState(invoice?.clientName ?? '');
  const [clientEmail, setClientEmail] = useState(invoice?.clientEmail ?? '');
  const [clientAddress, setClientAddress] = useState(invoice?.clientAddress ?? '');
  const [streamId, setStreamId] = useState<string | null>(invoice?.streamId ?? streams[0]?.id ?? null);
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? data.today);
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? addDays(data.today, terms));
  const [lines, setLines] = useState<LineDraft[]>(invoice?.lines.length ? invoice.lines.map(toDraft) : [blankLine(data.today)]);
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [paying, setPaying] = useState(false);
  const [candidates, setCandidates] = useState<Transaction[] | null>(null);
  const [paidDate, setPaidDate] = useState(data.today);
  const [previewing, setPreviewing] = useState(false);
  const [picking, setPicking] = useState(false);

  const clients = useMemo(() => pastClients(data.invoices).slice(0, 8), [data.invoices]);
  const total = lines.reduce((sum, l) => sum + lineAmount(fromDraft(l)), 0);

  useEffect(() => {
    if (!paying || !id) return;
    api.invoiceCandidates(id).then(setCandidates).catch(() => setCandidates([]));
  }, [paying, id]);

  const payload = () => ({
    clientName: clientName.trim(),
    clientEmail: clientEmail.trim(),
    clientAddress: clientAddress.trim(),
    streamId,
    issueDate,
    dueDate,
    lines: lines.map(fromDraft).filter((l) => l.description || l.unitPence),
    notes,
  });

  const save = async (status?: Invoice['status']) => {
    const saved = await app.saveInvoice(id, status ? { ...payload(), status } : payload());
    if (!saved) return null;
    setId(saved.id);
    // A brand-new invoice has to exist before it can be sent.
    if (status && !id) return app.saveInvoice(saved.id, { status });
    return saved;
  };

  const share = async (invId: string, number: string, paid: boolean) => {
    const url = invoicePdfUrl(invId);
    try {
      const blob = await (await fetch(url, { credentials: 'same-origin' })).blob();
      const file = new File([blob], `${paid ? 'receipt' : 'invoice'}-${number}.pdf`, { type: 'application/pdf' });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: `${paid ? 'Receipt' : 'Invoice'} ${number}` });
        return;
      }
    } catch {
      /* fall through to opening it */
    }
    window.open(url, '_blank');
  };

  const pickClient = (c: (typeof clients)[number]) => {
    setClientName(c.name);
    setClientEmail(c.email);
    setClientAddress(c.address);
    if (c.streamId) setStreamId(c.streamId);
    // The same kind of work again — but on this invoice's day, not the old one's.
    if (c.lastLine && lines.length === 1 && !lines[0]!.description && !lines[0]!.rate) setLines([{ ...toDraft(c.lastLine), quantity: '1', date: lines[0]!.date, timed: false, start: '', end: '' }]);
  };

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const lastRate = [...lines].reverse().find((l) => l.rate)?.rate ?? '';
  const withoutBlank = (ls: LineDraft[]) => ls.filter((l) => l.description.trim() || l.rate || l.timed);
  const preview = {
    number: current?.number ?? formatInvoiceNumber(data.settings.profile.invoicePrefix, data.invoiceCounter),
    numberPending: !current,
    issueDate, dueDate, clientName, clientEmail, clientAddress, notes,
    lines: lines.map(fromDraft).filter((l) => l.description || l.unitPence),
    lateNote: lateNoteFor(streamId, data.streams, data.settings.profile),
    profile: data.settings.profile,
  };

  return (
    <Sheet open onClose={onClose} title={current ? `${current.number} · ${STATE_LABEL[st]}` : 'New invoice'}>
      {locked && current ? (
        <>
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            <strong>{current.clientName}</strong> · <Money pence={invoiceTotal(current)} size={14} />
            <div style={{ fontSize: 12, color: T.textMuted }}>
              {st === 'paid' ? paidLine(current, data.transactions) : 'Void — kept for your records, not owed.'}
            </div>
          </div>
          <Button tone="primary" onClick={() => share(current.id, current.number, st === 'paid')}>
            {st === 'paid' ? 'Share receipt (PDF)' : 'View PDF'}
          </Button>
          {st === 'paid' && (
            <Button tone="quiet" onClick={async () => { if (window.confirm('Mark this invoice unpaid again?')) await app.unpayInvoice(current.id); }}>
              Mark unpaid
            </Button>
          )}
        </>
      ) : (
        <>
          {clients.length > 0 && !clientName && (
            <Field label="Invoice someone again">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {clients.map((c) => <Chip key={c.name} active={false} onClick={() => pickClient(c)}>{c.name}</Chip>)}
              </div>
            </Field>
          )}
          <Field label="Client"><input style={inputStyle} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Name or company" /></Field>
          <Field label="Client email (optional)"><input style={inputStyle} type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} /></Field>
          <Field label="Client address (optional)"><textarea style={{ ...inputStyle, minHeight: 56 }} value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} /></Field>

          {streams.length > 0 && (
            <Field label="Which stream is this work?">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {streams.map((s) => <Chip key={s.id} active={streamId === s.id} color={s.color} onClick={() => setStreamId(s.id)}>{s.name}</Chip>)}
              </div>
            </Field>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Date">
              <input style={inputStyle} type="date" value={issueDate} onChange={(e) => { setIssueDate(e.target.value); setDueDate(addDays(e.target.value, terms)); }} />
            </Field>
            <Field label="Due"><input style={inputStyle} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          </div>

          <Section title="Work">
            {lines.map((l, i) => (
              <Card key={i} style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input style={inputStyle} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="e.g. Session, Shift, Filming" aria-label="What the work was" />
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8, alignItems: 'end' }}>
                  <Field label="Date worked"><input style={inputStyle} type="date" value={l.date} onChange={(e) => setLine(i, { date: e.target.value })} /></Field>
                  <button
                    type="button"
                    onClick={() => setLine(i, { timed: !l.timed })}
                    style={{ background: 'none', border: 'none', color: l.timed ? T.textMuted : T.accent, fontSize: 12, textAlign: 'left', cursor: 'pointer', padding: '0 0 12px' }}
                  >
                    {l.timed ? 'Remove times' : '⏱ Add start & end times'}
                  </button>
                </div>
                {l.timed && (
                  <TimeFields
                    start={l.start}
                    end={l.end}
                    onChange={(v) => setLine(i, { start: v.start, end: v.end, ...(v.hours ? { quantity: String(v.hours) } : {}) })}
                  />
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 10, color: T.textMuted, marginBottom: -4 }}>
                  <span>Hours / qty</span><span>Rate £</span><span style={{ textAlign: 'right' }}>Amount</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, alignItems: 'center' }}>
                  <input style={inputStyle} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label="Hours or quantity" placeholder="Qty / hrs" />
                  <input style={inputStyle} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} aria-label="Rate in pounds" placeholder="Rate £" />
                  <span style={{ textAlign: 'right' }}><Money pence={lineAmount(fromDraft(l))} size={14} /></span>
                </div>
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 12, cursor: 'pointer', padding: 0, alignSelf: 'flex-end' }}>
                    Remove line
                  </button>
                )}
              </Card>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Button tone="quiet" onClick={() => setLines((ls) => [...ls, blankLine(ls[ls.length - 1]?.date || issueDate, ls[ls.length - 1]?.rate ?? '')])}>+ Add a line</Button>
              <Button tone="quiet" onClick={() => setPicking(true)}>📅 From calendar</Button>
            </div>
          </Section>
          <CalendarPicker
            app={app}
            open={picking}
            onClose={() => setPicking(false)}
            rateHint={lastRate}
            onAdd={(picked) =>
              setLines((ls) => [
                ...withoutBlank(ls),
                ...picked.map((p) => ({
                  description: p.description, quantity: String(p.quantity), rate: lastRate,
                  date: p.date, timed: Boolean(p.start && p.end), start: p.start ?? '', end: p.end ?? '',
                })),
              ])
            }
          />

          <Field label="Note on the invoice (optional)"><input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Label>Total</Label>
            <Money pence={total} size={22} color={T.accentBright} />
          </div>

          <Button onClick={() => setPreviewing(true)}>👁 Preview</Button>
          <InvoicePreview open={previewing} onClose={() => setPreviewing(false)} {...preview} onPdf={current ? () => share(current.id, current.number, false) : undefined} />

          {st === 'draft' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => save()} disabled={app.busy} style={{ flex: 1 }}>Save draft</Button>
              <Button
                tone="primary"
                disabled={app.busy || !clientName.trim() || total <= 0}
                style={{ flex: 1 }}
                onClick={async () => {
                  const sent = await save('sent');
                  if (sent) await share(sent.id, sent.number, false);
                }}
              >
                Send
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => save()} disabled={app.busy} style={{ flex: 1 }}>Save changes</Button>
              {current && <Button tone="primary" onClick={() => share(current.id, current.number, false)} style={{ flex: 1 }}>Share PDF</Button>}
            </div>
          )}
          <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
            “Send” opens your phone’s share sheet with the PDF — pick Mail, WhatsApp, anything. The invoice asks them to pay with {current?.number ?? 'its number'} as the reference, so the payment matches itself.
          </div>

          {current && st !== 'draft' && (
            <Section title="Been paid?">
              {!paying ? (
                <Button tone="green" onClick={() => setPaying(true)}>Mark as paid</Button>
              ) : (
                <>
                  <Label>Money in that could be it — tap the one that paid this</Label>
                  {candidates === null && <span style={{ fontSize: 13, color: T.textMuted }}>Looking…</span>}
                  {candidates?.length === 0 && (
                    <span style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
                      Nothing has come into the bank since {fmtDate(addDays(current.issueDate, -7))} that could be it. When it lands it shows here — and if they used {current.number} as the reference for the full amount, it marks itself paid.
                    </span>
                  )}
                  {candidates?.map((t) => {
                    const diff = paidDifference(t.amountPence, current);
                    return (
                      <Card key={t.id} onClick={() => app.payInvoice(current.id, { transactionId: t.id }).then((ok) => ok && onClose())} style={{ padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 14, wordBreak: 'break-word' }}>{t.counterparty || t.reference || 'No name from the bank'}</span>
                          <Money pence={t.amountPence} size={14} />
                        </div>
                        <div style={{ fontSize: 11, color: T.textMuted }}>
                          {fmtDate(t.date)}{t.reference ? ` · ${t.reference}` : ''}
                          {' · '}
                          <span style={{ color: diff ? T.accent : T.green }}>{diff || 'exact amount'}</span>
                          {mentionsInvoice(t, current.number) ? <span style={{ color: T.green }}> · quotes {current.number}</span> : null}
                        </div>
                      </Card>
                    );
                  })}
                  <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
                      Paid in cash (or anywhere that isn’t your bank)? This adds {formatGBP(invoiceTotal(current))} as a new income line. Don’t use it for a bank payment — that would count the money twice.
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input style={{ ...inputStyle, flex: 1 }} type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
                      <Button onClick={() => app.payInvoice(current.id, { date: paidDate, method: 'cash' }).then((ok) => ok && onClose())}>Record cash</Button>
                    </div>
                  </div>
                </>
              )}
            </Section>
          )}

          {current && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              {st === 'draft' ? (
                <button type="button" onClick={async () => { if (window.confirm('Delete this draft?') && (await app.deleteInvoice(current.id))) onClose(); }}
                  style={{ background: 'none', border: 'none', color: T.danger, fontSize: 12, cursor: 'pointer', padding: 0 }}>Delete draft</button>
              ) : (
                <button type="button" onClick={async () => { if (window.confirm('Void this invoice? It stays in your records but is no longer owed.')) { await app.saveInvoice(current.id, { status: 'void' }); onClose(); } }}
                  style={{ background: 'none', border: 'none', color: T.danger, fontSize: 12, cursor: 'pointer', padding: 0 }}>Void invoice</button>
              )}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
