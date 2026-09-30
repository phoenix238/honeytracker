import { useState } from 'react';
import { T } from '../theme';
import { Button, Card, Empty, Label, Money, Section, Sheet, fmtDate } from '../components';
import { api } from '../api';
import { copyKind, findDoubles, ownMoneyAsIncome, type Double } from '../../core/doubles';
import type { Transaction } from '../../core/types';
import type { App } from '../useApp';

// "Counted twice?" — the same money recorded by the bank and again somewhere else (the old
// app, CSTL, an invoice marked paid in cash, a line added by hand), and money from your own
// accounts counted as income. Each pair: keep the bank's line (the copy's note, receipts and
// stream move onto it), or say they really are two payments.

export function yourNames(app: App): string[] {
  const s = app.data!.settings;
  return [s.profile.name || s.name, s.profile.businessName].filter(Boolean);
}

/** How many things the check would show — for the cards that point to it. */
export function doublesCount(app: App): number {
  const txns = app.data!.transactions;
  return findDoubles(txns).length + ownMoneyAsIncome(txns, yourNames(app)).length;
}

export function DoublesSheet({ app, onClose }: { app: App; onClose: () => void }) {
  const data = app.data!;
  const doubles = findDoubles(data.transactions);
  const own = ownMoneyAsIncome(data.transactions, yourNames(app));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const merge = async (list: Double[]) => {
    setBusy(true);
    const res = await api.mergeDoubles(list.map((d) => ({ bankId: d.bank.id, copyId: d.copy.id }))).catch((e: Error) => ({ merged: 0, errors: [e.message] }));
    setDone(`${res.merged} merged${res.errors.length ? ` · ${res.errors.length} couldn’t be: ${res.errors[0]}` : ''}.`);
    await app.reload();
    setBusy(false);
  };
  const different = async (d: Double) => {
    setBusy(true);
    await api.keepBoth(d.bank.id, d.copy.id).catch(() => undefined);
    await app.reload();
    setBusy(false);
  };

  return (
    <Sheet open onClose={onClose} title="Counted twice?">
      <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
        The same money recorded by your bank <em>and</em> somewhere else counts twice. For each pair, keep the bank’s line — the other one’s note, receipts and stream move onto
        it — unless they really are two different payments.
      </div>
      {done && <div style={{ fontSize: 13, color: T.green }}>{done}</div>}

      {doubles.length === 0 && own.length === 0 && <Empty>Nothing looks counted twice.</Empty>}

      {doubles.length > 0 && (
        <Section title={`Same money, twice (${doubles.length})`}>
          {doubles.length > 1 && (
            <Button
              tone="primary"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Merge all ${doubles.length}? Each keeps the bank’s line, with the other one’s note, receipts and stream moved onto it.`)) void merge(doubles);
              }}
            >
              They’re all the same money — merge all {doubles.length}
            </Button>
          )}
          {doubles.map((d) => (
            <Card key={`${d.bank.id}:${d.copy.id}`} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Side label="In your bank — kept" t={d.bank} />
              <Side label={`${copyKind(d.copy)} — the copy`} t={d.copy} muted />
              <div style={{ fontSize: 11, color: T.textMuted }}>
                {d.exact ? 'Same amount' : 'A penny apart'}, {d.days === 0 ? 'same day' : `${d.days} day${d.days === 1 ? '' : 's'} apart`}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button tone="green" disabled={busy} onClick={() => merge([d])} style={{ flex: 1, padding: '8px 10px', fontSize: 13 }}>Same money — merge</Button>
                <Button tone="quiet" disabled={busy} onClick={() => different(d)} style={{ flex: 1, padding: '8px 10px', fontSize: 13 }}>Two payments</Button>
              </div>
            </Card>
          ))}
        </Section>
      )}

      {own.length > 0 && (
        <Section title={`From your own accounts, counted as income (${own.length})`}>
          <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
            Money you moved from another account of yours isn’t new income — it was counted when it first came in, or it was never income.
          </div>
          <Button disabled={busy || app.busy} onClick={() => app.classifyMany(own.map((t) => t.id), { bucket: 'transfer' })}>
            Not income — my own money ({own.length})
          </Button>
          {own.map((t) => <Side key={t.id} label="" t={t} />)}
        </Section>
      )}
    </Sheet>
  );
}

function Side({ label, t, muted }: { label: string; t: Transaction; muted?: boolean }) {
  return (
    <div style={{ opacity: muted ? 0.8 : 1 }}>
      {label && <Label color={muted ? T.textMuted : T.green}>{label}</Label>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.counterparty || t.reference || '—'}</span>
        <Money pence={t.amountPence} signed={t.direction} color={t.direction === 'in' ? T.green : T.text} size={14} />
      </div>
      <div style={{ fontSize: 11, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {[fmtDate(t.date), t.meta.account, t.note].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}
