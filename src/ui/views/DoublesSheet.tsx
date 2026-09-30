import { useState } from 'react';
import { T } from '../theme';
import { Button, Card, Empty, Label, Money, Section, Sheet, fmtDate } from '../components';
import { api } from '../api';
import { copyKind, findDoubles, ownMoneyAsIncome, unbackedOldRecords, type Double } from '../../core/doubles';
import { formatGBP } from '../../core/money';
import type { Transaction } from '../../core/types';
import type { App } from '../useApp';

// "Check for doubles" — everything that makes the totals too high, in one place:
// the same money recorded twice (bank + a copy; or the bank feed + a statement file), old-app
// records the bank doesn't back up, and money from your own accounts counted as income.
// The bank is the record: its lines are always the ones kept.

export function yourNames(app: App): string[] {
  const s = app.data!.settings;
  return [s.profile.name || s.name, s.profile.businessName].filter(Boolean);
}

/** What the check would show — for the cards that point to it. */
export function checkCounts(app: App): { twice: number; unbacked: number; own: number; total: number } {
  const txns = app.data!.transactions;
  const doubles = findDoubles(txns);
  const twice = doubles.length;
  const unbacked = unbackedOldRecords(txns, doubles).length;
  const own = ownMoneyAsIncome(txns, yourNames(app)).length;
  return { twice, unbacked, own, total: twice + unbacked + own };
}

/** "3 counted twice · 12 old app records not in your bank" */
export function checkSummary(c: ReturnType<typeof checkCounts>): string {
  return [
    c.twice ? `${c.twice} counted twice` : '',
    c.unbacked ? `${c.unbacked} old app record${c.unbacked === 1 ? '' : 's'} not in your bank` : '',
    c.own ? `${c.own} from your own account${c.own === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ');
}

export function DoublesSheet({ app, onClose }: { app: App; onClose: () => void }) {
  const data = app.data!;
  const doubles = findDoubles(data.transactions);
  const unbacked = unbackedOldRecords(data.transactions, doubles);
  const own = ownMoneyAsIncome(data.transactions, yourNames(app));
  const noMonzo = !data.transactions.some((t) => t.source === 'monzo');
  const unbackedIn = unbacked.filter((t) => t.direction === 'in').reduce((a, t) => a + t.amountPence, 0);
  const unbackedOut = unbacked.filter((t) => t.direction === 'out').reduce((a, t) => a + t.amountPence, 0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      setDone(await work());
    } catch (e) {
      setDone(`Didn’t finish — ${(e as Error).message}`);
    }
    await app.reload();
    setBusy(false);
  };
  const merge = (list: Double[]) =>
    act(async () => {
      const res = await api.mergeDoubles(list.map((d) => ({ bankId: d.bank.id, copyId: d.copy.id })));
      return `${res.merged} merged${res.errors.length ? ` · ${res.errors.length} couldn’t be: ${res.errors[0]}` : ''}.`;
    });
  const oldRecords = (action: 'remove' | 'keep-cash', list: Transaction[]) =>
    act(async () => {
      const res = await api.oldRecords(action, list.map((t) => t.id));
      return action === 'remove' ? `${res.changed} removed.` : `${res.changed} kept as cash.`;
    });

  return (
    <Sheet open onClose={onClose} title="Check for doubles">
      <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
        Your bank is the record. Anything counted twice alongside it, or that it can’t back up, makes your totals too high. Go down the list — the bank’s lines are always the
        ones kept.
      </div>
      {done && <div style={{ fontSize: 13, color: T.green }}>{done}</div>}
      {doubles.length === 0 && unbacked.length === 0 && own.length === 0 && <Empty>Nothing to check — no doubles, and every old-app record matches your bank.</Empty>}

      {doubles.length > 0 && (
        <Section title={`1 · Same money, twice (${doubles.length})`}>
          <Button
            tone="primary"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Merge all ${doubles.length}? Each keeps the bank’s line, with the other one’s note, receipts and stream moved onto it.`)) void merge(doubles);
            }}
          >
            {doubles.length === 1 ? 'Merge it' : `They’re all the same money — merge all ${doubles.length}`}
          </Button>
          {doubles.map((d) => (
            <Card key={`${d.bank.id}:${d.copy.id}`} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Side label="In your bank — kept" t={d.bank} />
              <Side label={`${copyKind(d.copy)} — the copy`} t={d.copy} muted />
              <div style={{ fontSize: 11, color: T.textMuted }}>
                {d.exact ? 'Same amount' : 'A penny apart'}, {d.days === 0 ? 'same day' : `${d.days} day${d.days === 1 ? '' : 's'} apart`}
                {d.sameName ? ', same name' : ''}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button tone="green" disabled={busy} onClick={() => merge([d])} style={{ flex: 1, padding: '8px 10px', fontSize: 13 }}>Same money — merge</Button>
                <Button tone="quiet" disabled={busy} onClick={() => act(async () => { await api.keepBoth(d.bank.id, d.copy.id); return 'Kept both.'; })} style={{ flex: 1, padding: '8px 10px', fontSize: 13 }}>
                  Two payments
                </Button>
              </div>
            </Card>
          ))}
        </Section>
      )}

      {unbacked.length > 0 && (
        <Section title={`${doubles.length ? '2' : '1'} · Old app records your bank doesn’t show (${unbacked.length})`}>
          <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
            No bank payment matches these ({formatGBP(unbackedIn)} in{unbackedOut ? `, ${formatGBP(unbackedOut)} out` : ''}). If one was <strong>cash</strong>, keep it — cash income is
            still taxable. If it went into your bank or never happened, remove it. Removed records don’t come back if you import the backup again; their receipts stay in Receipts.
          </div>
          {noMonzo && (
            <div style={{ fontSize: 12, color: T.accentBright, lineHeight: 1.5 }}>
              Your Monzo statement isn’t in yet — anything paid into Monzo shows here too. Bring it in first (Settings → Spreadsheet & other banks), then come back.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              tone="danger"
              disabled={busy}
              style={{ flex: 1 }}
              onClick={() => {
                if (window.confirm(`Remove all ${unbacked.length} (${formatGBP(unbackedIn)} of income${unbackedOut ? `, ${formatGBP(unbackedOut)} of costs` : ''})? Only do this if none were cash.`)) void oldRecords('remove', unbacked);
              }}
            >
              Remove all {unbacked.length}
            </Button>
            <Button tone="quiet" disabled={busy} style={{ flex: 1 }} onClick={() => oldRecords('keep-cash', unbacked)}>All were cash</Button>
          </div>
          {unbacked.map((t) => (
            <Card key={t.id} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Side label="" t={t} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Button tone="quiet" disabled={busy} onClick={() => oldRecords('keep-cash', [t])} style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}>Cash — keep</Button>
                <Button tone="quiet" disabled={busy} onClick={() => oldRecords('remove', [t])} style={{ flex: 1, padding: '6px 10px', fontSize: 13, color: T.danger }}>Remove</Button>
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
