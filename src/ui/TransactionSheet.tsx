import { useEffect, useRef, useState } from 'react';
import type { Bucket, ExpenseCategory, Receipt, Transaction } from '../core/types';
import { CATEGORIES } from '../core/hmrc';
import { looseReceiptsFor, receiptOrigin } from '../core/receiptMatch';
import { formatGBP } from '../core/money';
import { suggestPattern } from '../core/rules';
import { T, fonts } from './theme';
import { BUCKET_COLOR, BUCKET_LABEL, Button, Chip, Field, Label, Money, Sheet, fmtDate, inputStyle } from './components';
import { api } from './api';
import { ReceiptViewer } from './ReceiptViewer';
import type { App } from './useApp';
import { CameraIcon } from './icons';

// One row, fully explained: what the bank said, what you've decided it is, the evidence
// behind it, and every change ever made to it.

const CHOICES: { bucket: Exclude<Bucket, 'unreviewed'>; when: 'in' | 'out' | 'both' }[] = [
  { bucket: 'business_income', when: 'in' },
  { bucket: 'business_expense', when: 'out' },
  { bucket: 'personal', when: 'both' },
  { bucket: 'transfer', when: 'both' },
  { bucket: 'business_expense', when: 'in' }, // a refund of a business cost
  { bucket: 'business_income', when: 'out' }, // a refund to a client
];

export function TransactionSheet({
  app,
  txn,
  onClose,
  onNext,
}: {
  app: App;
  txn: Transaction | null;
  onClose: () => void;
  /** When reviewing the inbox, move on to the next row after a decision. */
  onNext?: () => void;
}) {
  const data = app.data!;
  const streams = data.streams.filter((s) => !s.archived);
  const [bucket, setBucket] = useState<Bucket>('unreviewed');
  const [streamId, setStreamId] = useState<string | null>(null);
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [percent, setPercent] = useState(100);
  const [note, setNote] = useState('');
  const [always, setAlways] = useState(false);
  const [pattern, setPattern] = useState('');
  const [history, setHistory] = useState<{ at: string; action: string; detail: unknown }[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [viewing, setViewing] = useState<Receipt | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!txn) return;
    const lastStream = localStorage.getItem('ht:lastStream');
    setBucket(txn.bucket);
    setStreamId(txn.streamId ?? (streams.length === 1 ? streams[0]!.id : streams.find((s) => s.id === lastStream)?.id ?? null));
    setCategory(txn.category);
    setPercent(txn.businessPercent);
    setNote(txn.note);
    setAlways(false);
    setPattern(suggestPattern(txn).pattern);
    setHistory(null);
    setFinding(false);
  }, [txn?.id]);

  if (!txn) return null;
  const business = bucket === 'business_income' || bucket === 'business_expense';
  const receipts = data.receipts.filter((r) => r.transactionId === txn.id);
  const looseCount = data.receipts.filter((r) => !r.transactionId).length;
  const canEditFacts = txn.source === 'cash' || txn.source === 'manual';
  const choices = CHOICES.filter((c) => c.when === 'both' || c.when === txn.direction);

  const save = async () => {
    if (business && !streamId && streams.length > 0) {
      app.notify('Pick which stream this belongs to.');
      return;
    }
    const patch = {
      bucket,
      streamId: business ? streamId : null,
      category: bucket === 'business_expense' ? category ?? 'otherExpenses' : null,
      businessPercent: bucket === 'business_expense' ? percent : 100,
      note,
    };
    const saved = await app.classify(txn.id, patch);
    if (!saved) return;
    if (streamId) {
      try {
        localStorage.setItem('ht:lastStream', streamId);
      } catch {
        /* storage unavailable — only a convenience */
      }
    }
    if (always && bucket !== 'unreviewed' && pattern.trim().length >= 2) {
      const { field } = suggestPattern(txn);
      await app.addRule({
        field,
        pattern: pattern.trim(),
        direction: txn.direction,
        bucket,
        streamId: patch.streamId,
        category: patch.category,
        businessPercent: patch.businessPercent,
      });
    }
    if (onNext) onNext();
    else onClose();
  };

  return (
    <Sheet open onClose={onClose} title={txn.counterparty || txn.reference || 'Transaction'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Money pence={txn.amountPence} signed={txn.direction} color={txn.direction === 'in' ? T.green : T.text} size={26} />
        <span style={{ fontSize: 13, color: T.textMuted }}>{fmtDate(txn.date)}</span>
      </div>
      <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6 }}>
        {txn.reference && <div>Reference: <strong style={{ color: T.text }}>{txn.reference}</strong></div>}
        <div>
          From {txn.source === 'starling' ? `Starling${txn.meta.account ? ` · ${txn.meta.account}` : ''}`
            : txn.source === 'monzo' || txn.source === 'bankcsv' ? `${txn.meta.account || 'a bank'} statement`
            : txn.source === 'cstl' ? 'CSTL' : txn.source === 'import' ? 'old Honey app' : 'you (cash / manual)'}
          {txn.classifiedBy && txn.classifiedBy !== 'user' && ` · classified by ${txn.classifiedBy === 'rule' ? 'a rule' : txn.classifiedBy === 'cstl' ? 'CSTL' : txn.classifiedBy === 'ai' ? 'AI' : txn.classifiedBy === 'invoice' ? 'its invoice' : 'the import'}`}
        </div>
        {txn.classifiedBy === 'ai' && (
          <div style={{ color: T.accentBright }}>
            🤖 AI sorted this ({txn.meta.aiConfidence ?? 'low'} confidence): {txn.meta.aiReason || 'no reason given'}. Save to confirm it, or change it first.
          </div>
        )}
        {txn.meta.cstlRef && <div>CSTL client ref {txn.meta.cstlRef}{txn.meta.cstlReceipt ? ` · receipt ${txn.meta.cstlReceipt}` : ''}</div>}
      </div>

      <Field label="What is it?">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {choices.map((c) => (
            <Chip key={`${c.bucket}-${c.when}`} active={bucket === c.bucket} color={BUCKET_COLOR[c.bucket]} onClick={() => setBucket(c.bucket)}>
              {c.bucket === 'business_expense' && txn.direction === 'in'
                ? 'Refund of a business cost'
                : c.bucket === 'business_income' && txn.direction === 'out'
                  ? 'Refund to a client'
                  : BUCKET_LABEL[c.bucket]}
            </Chip>
          ))}
        </div>
      </Field>

      {business && (
        <Field label="Which stream?">
          {streams.length === 0 ? (
            <span style={{ fontSize: 13, color: T.textMuted }}>Add your income streams in Settings — it’ll still count until then.</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {streams.map((s) => (
                <Chip key={s.id} active={streamId === s.id} color={s.color} onClick={() => setStreamId(s.id)}>
                  {s.name}
                </Chip>
              ))}
            </div>
          )}
        </Field>
      )}

      {bucket === 'business_expense' && (
        <>
          <Field label="HMRC category">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  style={{
                    textAlign: 'left',
                    background: category === c.key ? T.expense + '22' : T.surface,
                    border: `1px solid ${category === c.key ? T.expense : T.border}`,
                    borderRadius: 10,
                    padding: '9px 12px',
                    cursor: 'pointer',
                    fontFamily: fonts.body,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: c.disallowable ? T.textMuted : T.text }}>
                    {c.label} <span style={{ fontFamily: fonts.mono, fontSize: 10, color: T.textFaint }}>box {c.box}</span>
                  </div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{c.hint}</div>
                </button>
              ))}
            </div>
          </Field>
          <Field label={`Business use: ${percent}%`} hint="For things you also use personally (phone, broadband): claim only the business share.">
            <input type="range" min={0} max={100} step={5} value={percent} onChange={(e) => setPercent(Number(e.target.value))} />
          </Field>
        </>
      )}

      <Field label="Note">
        <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. which client, what for" />
      </Field>

      {bucket !== 'unreviewed' && bucket !== txn.bucket && (
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: T.text }}>
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ flex: 1 }}>
            Always do this when it says
            <input style={{ ...inputStyle, marginTop: 6, fontSize: 13, padding: '7px 10px' }} value={pattern} onChange={(e) => setPattern(e.target.value)} />
          </span>
        </label>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Label>Evidence</Label>
        {receipts.length === 0 && (
          <span style={{ fontSize: 13, color: txn.bucket === 'business_expense' ? T.accentBright : T.textMuted }}>
            {txn.bucket === 'business_expense' ? 'No receipt yet — add one so this cost stands up.' : 'None attached.'}
          </span>
        )}
        {receipts.map((r) => (
          <button key={r.id} type="button" onClick={() => setViewing(r)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontSize: 13, color: T.blue }}>
            🧾 {r.merchant || r.filename} {r.totalPence != null ? `· ${formatGBP(r.totalPence)}` : ''}
          </button>
        ))}
        <ReceiptViewer receipt={viewing} onClose={() => setViewing(null)} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) void app.uploadReceipts(files, txn.id);
          }}
        />
        {finding && (
          <FindReceipt
            app={app}
            txn={txn}
            onView={setViewing}
            onDone={() => setFinding(false)}
          />
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {txn.direction === 'out' && !finding && looseCount > 0 && (
            <Button onClick={() => setFinding(true)} style={{ flex: 1 }}>🔎 Find its receipt</Button>
          )}
          <Button onClick={() => fileRef.current?.click()} disabled={app.busy} style={{ flex: 1 }}>
            <CameraIcon size={18} color={T.text} /> Add receipt
          </Button>
        </div>
      </div>

      {(txn.bucket === 'personal' || txn.bucket === 'transfer') && (
        <Button
          onClick={async () => {
            const saved = await app.classify(txn.id, { bucket: 'unreviewed' });
            if (saved) {
              app.notify('Put back — it’s waiting in the sort pile.');
              onClose();
            }
          }}
          disabled={app.busy}
        >
          ↩︎ Put back to sort
        </Button>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button tone="primary" onClick={save} disabled={app.busy} style={{ flex: 1 }}>
          {onNext ? 'Save & next' : 'Save'}
        </Button>
        {onNext && (
          <Button tone="quiet" onClick={onNext}>
            Skip
          </Button>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          type="button"
          onClick={async () => setHistory(await api.history(txn.id).catch(() => []))}
          style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 12, cursor: 'pointer', fontFamily: fonts.body, padding: 0 }}
        >
          Show change history
        </button>
        {canEditFacts && (
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm('Delete this entry?')) return;
              await app.deleteTransaction(txn.id);
              onClose();
            }}
            style={{ background: 'none', border: 'none', color: T.danger, fontSize: 12, cursor: 'pointer', fontFamily: fonts.body, padding: 0 }}
          >
            Delete entry
          </button>
        )}
      </div>
      {history && (
        <div style={{ fontFamily: fonts.mono, fontSize: 11, color: T.textMuted, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {history.length === 0 && <span>No changes recorded.</span>}
          {history.map((h, i) => (
            <div key={i}>
              {h.at.slice(0, 16).replace('T', ' ')} · {h.action} {JSON.stringify(h.detail)}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Pick the receipt for this line by hand, from everything brought in but not yet attached —
 * emails and Drive files the Google finder kept, and photos you snapped. Best guesses first.
 */
function FindReceipt({ app, txn, onView, onDone }: { app: App; txn: Transaction; onView: (r: Receipt) => void; onDone: () => void }) {
  const list = looseReceiptsFor(txn, app.data!.receipts);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
        Receipts not attached to anything yet, closest first. Tap one to attach it; 👁 to look first.
      </div>
      {list.map((r) => {
        const off = r.totalPence == null ? null : r.totalPence - txn.amountPence;
        return (
          <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '10px 12px' }}>
            <button
              type="button"
              disabled={app.busy}
              onClick={async () => { await app.updateReceipt(r.id, { transactionId: txn.id }); onDone(); }}
              style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, textAlign: 'left', color: T.text, cursor: 'pointer' }}
            >
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.merchant || r.filename}
                {r.totalPence != null ? ` · ${formatGBP(r.totalPence)}` : ''}
              </span>
              <span style={{ display: 'block', fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                {[r.date ? fmtDate(r.date) : 'no date', receiptOrigin(r)].join(' · ')}
                {' · '}
                <span style={{ color: off === 0 || (off != null && Math.abs(off) <= 1) ? T.green : T.accent }}>
                  {off == null ? 'no total read' : Math.abs(off) <= 1 ? 'same amount' : `${formatGBP(Math.abs(off))} ${off > 0 ? 'more' : 'less'}`}
                </span>
              </span>
            </button>
            <button type="button" onClick={() => onView(r)} aria-label="Look at this receipt" style={{ background: 'none', border: 'none', padding: 0, fontSize: 16, cursor: 'pointer' }}>👁</button>
          </div>
        );
      })}
      <button type="button" onClick={onDone} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 12, cursor: 'pointer', padding: 0, alignSelf: 'flex-start' }}>
        Close
      </button>
    </div>
  );
}
