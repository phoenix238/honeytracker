import { useEffect, useMemo, useState } from 'react';
import { T, fonts } from '../theme';
import { Button, Card, Chip, Empty, Field, Label, Money, Section, Sheet, Title, fmtDate, inputStyle } from '../components';
import { api, invoicePdfUrl } from '../api';
import { daysOverdue, invoiceState, invoiceTotal, lineAmount, owedSummary, pastClients, type InvoiceState } from '../../core/invoices';
import { addDays } from '../../core/dates';
import { formatAmount, formatGBP, parsePence } from '../../core/money';
import type { Invoice, InvoiceLine, Transaction } from '../../core/types';
import type { App } from '../useApp';

// Bills you send. They don't count as income until the money lands — then the bank payment
// that quotes the invoice number settles it by itself, and it's filed under its stream.

type Filter = 'owed' | 'draft' | 'paid' | 'all';

const STATE_LABEL: Record<InvoiceState, string> = { draft: 'Draft', open: 'Waiting', overdue: 'Overdue', paid: 'Paid', void: 'Void' };
const STATE_COLOR: Record<InvoiceState, string> = { draft: T.textMuted, open: T.blue, overdue: T.danger, paid: T.green, void: T.textFaint };

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
}

const toDraft = (l: InvoiceLine): LineDraft => ({ description: l.description, quantity: String(l.quantity), rate: formatAmount(l.unitPence) });
const fromDraft = (l: LineDraft): InvoiceLine => ({ description: l.description.trim(), quantity: Number(l.quantity) || 0, unitPence: parsePence(l.rate) });

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
  const [lines, setLines] = useState<LineDraft[]>(invoice?.lines.length ? invoice.lines.map(toDraft) : [{ description: '', quantity: '1', rate: '' }]);
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [paying, setPaying] = useState(false);
  const [candidates, setCandidates] = useState<Transaction[] | null>(null);
  const [paidDate, setPaidDate] = useState(data.today);

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
    if (c.lastLine && lines.length === 1 && !lines[0]!.description && !lines[0]!.rate) setLines([{ ...toDraft(c.lastLine), quantity: '1' }]);
  };

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Sheet open onClose={onClose} title={current ? `${current.number} · ${STATE_LABEL[st]}` : 'New invoice'}>
      {locked && current ? (
        <>
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            <strong>{current.clientName}</strong> · <Money pence={invoiceTotal(current)} size={14} />
            <div style={{ fontSize: 12, color: T.textMuted }}>
              {st === 'paid' ? 'Paid — counted as income under its stream.' : 'Void — kept for your records, not owed.'}
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
                <input style={inputStyle} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="e.g. Shoot, 10:00–13:00" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 10, color: T.textMuted, marginBottom: -4 }}>
                  <span>Hours / qty</span><span>Rate £</span><span style={{ textAlign: 'right' }}>Amount</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, alignItems: 'center' }}>
                  <input style={inputStyle} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label="Hours or quantity" placeholder="Qty / hrs" />
                  <input style={inputStyle} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} aria-label="Rate in pounds" placeholder="Rate £" />
                  <span style={{ textAlign: 'right' }}><Money pence={lineAmount(fromDraft(l))} size={14} /></span>
                </div>
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 12, textAlign: 'left', cursor: 'pointer', padding: 0 }}>
                    Remove line
                  </button>
                )}
              </Card>
            ))}
            <Button tone="quiet" onClick={() => setLines((ls) => [...ls, { description: '', quantity: '1', rate: ls[ls.length - 1]?.rate ?? '' }])}>+ Add a line</Button>
          </Section>

          <Field label="Note on the invoice (optional)"><input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Label>Total</Label>
            <Money pence={total} size={22} color={T.accentBright} />
          </div>

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
                  <Label>Bank payments that fit</Label>
                  {candidates === null && <span style={{ fontSize: 13, color: T.textMuted }}>Looking…</span>}
                  {candidates?.length === 0 && (
                    <span style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
                      No payment of {formatGBP(invoiceTotal(current))} in the bank yet. If it was cash, record it below; otherwise it’ll match itself when it arrives.
                    </span>
                  )}
                  {candidates?.map((t) => (
                    <Card key={t.id} onClick={() => app.payInvoice(current.id, { transactionId: t.id }).then((ok) => ok && onClose())} style={{ padding: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 14 }}>{t.counterparty || t.reference}</span>
                        <Money pence={t.amountPence} size={14} />
                      </div>
                      <div style={{ fontSize: 11, color: T.textMuted }}>{fmtDate(t.date)}{t.reference ? ` · ${t.reference}` : ''} · tap if this is it</div>
                    </Card>
                  ))}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input style={{ ...inputStyle, flex: 1 }} type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
                    <Button onClick={() => app.payInvoice(current.id, { date: paidDate, method: 'cash' }).then((ok) => ok && onClose())}>Paid in cash</Button>
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
