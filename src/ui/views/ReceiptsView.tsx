import { useRef, useState } from 'react';
import { T } from '../theme';
import { Button, Card, Chip, Empty, Field, Label, Money, Section, Sheet, Title, fmtDate, inputStyle } from '../components';
import { CameraIcon } from '../icons';
import { receiptFileUrl } from '../api';
import { receiptCandidates } from '../../core/receiptMatch';
import { CATEGORIES, categoryInfo } from '../../core/hmrc';
import { parsePence, formatAmount } from '../../core/money';
import type { Receipt } from '../../core/types';
import type { App } from '../useApp';

// Snap it, and it finds its own bank line. The ones that can't be matched — paid in cash, or
// the bank line hasn't arrived yet — wait here with the likely candidates.

export function ReceiptsView({ app }: { app: App }) {
  const data = app.data!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const loose = data.receipts.filter((r) => !r.transactionId);
  const matched = data.receipts.filter((r) => r.transactionId);
  const open = data.receipts.find((r) => r.id === openId) ?? null;

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

      <Section title={`Not matched yet (${loose.length})`}>
        {loose.length === 0 && <Empty>Every receipt is attached to a transaction.</Empty>}
        {loose.map((r) => (
          <ReceiptRow key={r.id} r={r} onOpen={() => setOpenId(r.id)} />
        ))}
      </Section>

      <Section title={`Matched (${matched.length})`}>
        {matched.slice(0, 50).map((r) => (
          <ReceiptRow key={r.id} r={r} onOpen={() => setOpenId(r.id)} />
        ))}
      </Section>

      {open && <ReceiptSheet app={app} receipt={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ReceiptRow({ r, onOpen }: { r: Receipt; onOpen: () => void }) {
  return (
    <Card onClick={onOpen} style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
      {r.mime.startsWith('image/') ? (
        <img src={receiptFileUrl(r.id)} alt="" loading="lazy" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, background: T.bg }} />
      ) : (
        <div style={{ width: 44, height: 44, borderRadius: 8, background: T.bg, display: 'grid', placeItems: 'center', fontSize: 11, color: T.textMuted }}>PDF</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.merchant || r.filename}</div>
        <div style={{ fontSize: 11, color: T.textMuted }}>
          {r.date ? fmtDate(r.date) : 'No date'}
          {r.suggestedCategory ? ` · ${categoryInfo(r.suggestedCategory).label}` : ''}
        </div>
      </div>
      {r.totalPence != null ? <Money pence={r.totalPence} size={14} /> : <span style={{ fontSize: 12, color: T.accentBright }}>Needs amount</span>}
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
  const draft: Receipt = { ...receipt, date: date || null, totalPence: amount ? parsePence(amount) : null };
  const candidates = receipt.transactionId ? [] : receiptCandidates(draft, data.transactions).slice(0, 5);
  const linked = data.transactions.find((t) => t.id === receipt.transactionId);

  const saveFields = () =>
    app.updateReceipt(receipt.id, { merchant, date: date || null, totalPence: amount ? parsePence(amount) : null, suggestedCategory: category });

  return (
    <Sheet open onClose={onClose} title={receipt.merchant || 'Receipt'}>
      <a href={receiptFileUrl(receipt.id)} target="_blank" rel="noreferrer">
        {receipt.mime.startsWith('image/') ? (
          <img src={receiptFileUrl(receipt.id)} alt="Receipt" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 10, background: T.surface }} />
        ) : (
          <span style={{ color: T.blue, fontSize: 14 }}>Open PDF</span>
        )}
      </a>
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
      <Button
        tone="danger"
        onClick={async () => {
          if (!window.confirm('Delete this receipt? The image is gone for good.')) return;
          await app.deleteReceipt(receipt.id);
          onClose();
        }}
      >
        Delete receipt
      </Button>
    </Sheet>
  );
}
