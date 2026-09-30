import { useRef, useState, type ReactNode } from 'react';
import { T } from '../theme';
import { Button, Card, Chip, Empty, Field, Label, Money, Section, Sheet, Title, fmtDate, inputStyle } from '../components';
import { CameraIcon } from '../icons';
import { api, receiptFileUrl } from '../api';
import { ReceiptViewer } from '../ReceiptViewer';
import { receiptCandidates, receiptOrigin } from '../../core/receiptMatch';
import { CATEGORIES } from '../../core/hmrc';
import { parsePence, formatAmount, formatGBP } from '../../core/money';
import type { Receipt } from '../../core/types';
import type { App } from '../useApp';

// Snap it, and it finds its own bank line. The ones that don't attach themselves split two ways:
// ones with a bank line that fits (one tap to attach), and ones with none — mostly personal buys
// the Gmail finder kept, or things paid from an account Honey doesn't see yet. Those need nothing
// from you unless they were business costs, so they can be moved out of the way in one go.

export function ReceiptsView({ app }: { app: App }) {
  const data = app.data!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAside, setShowAside] = useState(false);
  const [showMatched, setShowMatched] = useState(false);
  const loose = data.receipts.filter((r) => !r.transactionId);
  const byDate = (a: Receipt, b: Receipt) => (b.date ?? '').localeCompare(a.date ?? '');
  const fits = new Map(loose.map((r) => [r.id, receiptCandidates(r, data.transactions)]));
  const ready = loose.filter((r) => !r.notNeeded && fits.get(r.id)!.length > 0).sort(byDate);
  const noLine = loose.filter((r) => !r.notNeeded && fits.get(r.id)!.length === 0).sort(byDate);
  const aside = loose.filter((r) => r.notNeeded).sort(byDate);
  const matched = data.receipts.filter((r) => r.transactionId);
  const open = data.receipts.find((r) => r.id === openId) ?? null;

  const moveAside = async (ids: string[], notNeeded: boolean) => {
    await api.receiptsAside(ids, notNeeded).catch((e: Error) => app.notify(`Not moved — ${e.message}`));
    await app.reload();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Title>Receipts</Title>
      <Button tone="primary" onClick={() => fileRef.current?.click()} disabled={app.busy} style={{ padding: 16, fontSize: 16 }}>
        <CameraIcon size={20} color={T.bg} /> Snap or upload receipts
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void app.uploadReceipts(files);
        }}
      />
      {!data.config.receiptsAi && (
        <div style={{ fontSize: 12, color: T.accentBright, lineHeight: 1.5 }}>
          Automatic reading is off (no ANTHROPIC_API_KEY) — receipts are still saved; you’ll type the amount and date yourself.
        </div>
      )}
      {app.pending > 0 && <div style={{ fontSize: 12, color: T.textMuted }}>{app.pending} waiting on this phone for signal.</div>}

      {ready.length > 0 && (
        <Section title={`Ready to attach (${ready.length})`}>
          <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>A bank line with the same amount near the date. Tap Attach, or open one to check it first.</div>
          {ready.map((r) => {
            const [t, ...more] = fits.get(r.id)!;
            return (
              <ReceiptRow key={r.id} r={r} onOpen={() => setOpenId(r.id)}>
                {more.length === 0 ? (
                  <Button tone="green" style={{ padding: '6px 10px', fontSize: 12 }} disabled={app.busy} onClick={() => app.updateReceipt(r.id, { transactionId: t!.id })}>
                    Attach
                  </Button>
                ) : (
                  <Button style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setOpenId(r.id)}>Choose</Button>
                )}
              </ReceiptRow>
            );
          })}
        </Section>
      )}

      <Section title={`No bank line found (${noLine.length})`}>
        {noLine.length === 0 ? (
          <Empty>Nothing waiting.</Empty>
        ) : (
          <>
            <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
              These need nothing from you unless they were business costs. Most are personal buys the Gmail finder kept, or were paid from Monzo, PayPal or cash —
              they attach themselves when that account’s statement comes in. Move them out of the way here; nothing is deleted.
            </div>
            <Button
              tone="quiet"
              disabled={app.busy}
              onClick={async () => {
                if (window.confirm(`Move all ${noLine.length} out of the way? They stay in “Moved aside”, and still attach themselves if their bank line turns up.`)) await moveAside(noLine.map((r) => r.id), true);
              }}
            >
              Move all {noLine.length} aside
            </Button>
            {noLine.map((r) => (
              <ReceiptRow key={r.id} r={r} onOpen={() => setOpenId(r.id)}>
                <Button tone="quiet" style={{ padding: '6px 8px', fontSize: 12 }} onClick={() => moveAside([r.id], true)}>Not needed</Button>
              </ReceiptRow>
            ))}
          </>
        )}
      </Section>

      {aside.length > 0 && (
        <Section title={`Moved aside (${aside.length})`} right={<Toggle open={showAside} onClick={() => setShowAside(!showAside)} />}>
          {showAside &&
            aside.map((r) => (
              <ReceiptRow key={r.id} r={r} onOpen={() => setOpenId(r.id)}>
                <Button tone="quiet" style={{ padding: '6px 8px', fontSize: 12 }} onClick={() => moveAside([r.id], false)}>Bring back</Button>
              </ReceiptRow>
            ))}
        </Section>
      )}

      <Section title={`Attached (${matched.length})`} right={<Toggle open={showMatched} onClick={() => setShowMatched(!showMatched)} />}>
        {showMatched && matched.slice(0, 100).map((r) => <ReceiptRow key={r.id} r={r} onOpen={() => setOpenId(r.id)} />)}
      </Section>

      {open && <ReceiptSheet app={app} receipt={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Toggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 12, cursor: 'pointer', padding: 0 }}>
      {open ? 'Hide ▴' : 'Show ▾'}
    </button>
  );
}

function ReceiptRow({ r, onOpen, children }: { r: Receipt; onOpen: () => void; children?: ReactNode }) {
  return (
    <Card style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
      <button type="button" onClick={onOpen} style={{ flex: 1, minWidth: 0, display: 'flex', gap: 12, alignItems: 'center', background: 'none', border: 'none', padding: 0, textAlign: 'left', color: T.text, cursor: 'pointer' }}>
        {r.mime.startsWith('image/') ? (
          <img src={receiptFileUrl(r.id)} alt="" loading="lazy" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, background: T.bg, flexShrink: 0 }} />
        ) : (
          <div style={{ width: 44, height: 44, borderRadius: 8, background: T.bg, display: 'grid', placeItems: 'center', fontSize: 11, color: T.textMuted, flexShrink: 0 }}>
            {r.mime === 'application/pdf' ? 'PDF' : 'Email'}
          </div>
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.merchant || r.filename}</span>
          <span style={{ display: 'block', fontSize: 11, color: T.textMuted }}>
            {r.date ? fmtDate(r.date) : 'No date'} · {r.totalPence != null ? formatGBP(r.totalPence) : <span style={{ color: T.accentBright }}>needs amount</span>} · {receiptOrigin(r)}
          </span>
        </span>
      </button>
      {children}
    </Card>
  );
}

function ReceiptSheet({ app, receipt, onClose }: { app: App; receipt: Receipt; onClose: () => void }) {
  const data = app.data!;
  const streams = data.streams.filter((s) => !s.archived);
  const [merchant, setMerchant] = useState(receipt.merchant);
  const [date, setDate] = useState(receipt.date ?? '');
  const [amount, setAmount] = useState(receipt.totalPence != null ? formatAmount(receipt.totalPence) : '');
  const [category, setCategory] = useState(receipt.suggestedCategory ?? 'otherExpenses');
  const [streamId, setStreamId] = useState<string | null>(streams[0]?.id ?? null);
  const [viewing, setViewing] = useState(false);
  const draft: Receipt = { ...receipt, date: date || null, totalPence: amount ? parsePence(amount) : null };
  const candidates = receipt.transactionId ? [] : receiptCandidates(draft, data.transactions).slice(0, 5);
  const linked = data.transactions.find((t) => t.id === receipt.transactionId);

  const saveFields = () =>
    app.updateReceipt(receipt.id, { merchant, date: date || null, totalPence: amount ? parsePence(amount) : null, suggestedCategory: category });

  return (
    <Sheet open onClose={onClose} title={receipt.merchant || 'Receipt'}>
      {receipt.mime.startsWith('image/') ? (
        <button type="button" onClick={() => setViewing(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'zoom-in' }}>
          <img src={receiptFileUrl(receipt.id)} alt="Receipt" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 10, background: T.surface }} />
        </button>
      ) : (
        <Button onClick={() => setViewing(true)}>{receipt.mime === 'application/pdf' ? '📄 View the PDF' : '✉️ Read the email'}</Button>
      )}
      {viewing && <ReceiptViewer receipt={receipt} onClose={() => setViewing(false)} />}
      <Field label="Shop / supplier"><input style={inputStyle} value={merchant} onChange={(e) => setMerchant(e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Date"><input style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Total £"><input style={inputStyle} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      <Field label="Category">
        <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </Field>
      <Button onClick={saveFields} disabled={app.busy}>Save details</Button>

      {linked ? (
        <Card>
          <Label>Attached to</Label>
          <div style={{ fontSize: 14, marginTop: 6 }}>
            {linked.counterparty || linked.reference} · <Money pence={linked.amountPence} size={14} /> · {fmtDate(linked.date)}
          </div>
          <Button tone="quiet" onClick={() => app.updateReceipt(receipt.id, { transactionId: null })} style={{ padding: '8px 0', marginTop: 4 }}>
            Detach
          </Button>
        </Card>
      ) : (
        <>
          <Section title="Is it one of these?">
            {candidates.length === 0 && (
              <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
                No bank line with this amount near this date{draft.totalPence == null ? ' (add the total above)' : ''}. If it just happened, it’ll match itself when the bank sends it.
              </div>
            )}
            {candidates.map((t) => (
              <Card key={t.id} onClick={() => app.updateReceipt(receipt.id, { transactionId: t.id }).then(onClose)} style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 14 }}>{t.counterparty || t.reference}</span>
                  <Money pence={t.amountPence} size={14} />
                </div>
                <div style={{ fontSize: 11, color: T.textMuted }}>{fmtDate(t.date)} · tap to attach</div>
              </Card>
            ))}
          </Section>
          <Section title="Paid in cash or on a card that isn’t synced?">
            {streams.length > 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {streams.map((s) => <Chip key={s.id} active={streamId === s.id} color={s.color} onClick={() => setStreamId(s.id)}>{s.name}</Chip>)}
              </div>
            )}
            <Button
              tone="primary"
              disabled={app.busy || !date || !amount}
              onClick={() =>
                app.receiptToExpense(receipt.id, { streamId, category, date, amountPence: parsePence(amount) }).then(onClose)
              }
            >
              Record it as a business cost
            </Button>
          </Section>
        </>
      )}
      {!linked && (
        <Button tone="quiet" onClick={() => app.updateReceipt(receipt.id, { notNeeded: !receipt.notNeeded }).then(onClose)}>
          {receipt.notNeeded ? 'Bring it back to the list' : 'Not needed — move it aside'}
        </Button>
      )}
      <Button
        tone="danger"
        onClick={async () => {
          if (!window.confirm('Delete this receipt? The file is gone for good.')) return;
          await app.deleteReceipt(receipt.id);
          onClose();
        }}
      >
        Delete receipt
      </Button>
    </Sheet>
  );
}
