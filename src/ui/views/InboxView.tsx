import { useMemo, useState } from 'react';
import { T } from '../theme';
import { BUCKET_COLOR, BUCKET_LABEL, Button, Card, Chip, Empty, Label, Money, Title, fmtDate, inputStyle } from '../components';
import { TransactionSheet } from '../TransactionSheet';
import { needsReceipt } from '../../core/ledger';
import { taxYearBounds, taxYearLabel, taxYearOf, withinBounds } from '../../core/dates';
import { categoryInfo } from '../../core/hmrc';
import { api } from '../api';
import type { Transaction } from '../../core/types';
import type { App } from '../useApp';

// Every movement of money, and the review queue. The goal each week: this list's "To review"
// filter empty. Then the year-end return is already done.

type Filter = 'review' | 'ai' | 'old' | 'receipts' | 'auto' | 'all';

const fromOldApp = (t: Transaction) => t.source === 'import' || Boolean(t.meta.importedFrom);
const isBusiness = (t: Transaction) => t.bucket === 'business_income' || t.bucket === 'business_expense';

// Least certain first, so the ones worth a real look come to the top.
const CONF: Record<string, number> = { low: 0, medium: 1, high: 2 };

export function InboxView({ app }: { app: App }) {
  const data = app.data!;
  const currentYear = taxYearOf(data.today);
  const [filter, setFilter] = useState<Filter>('review');
  const [year, setYear] = useState<number | 'all'>(currentYear);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const streams = new Map(data.streams.map((s) => [s.id, s]));

  const rows = useMemo(() => {
    const bounds = year === 'all' ? null : taxYearBounds(year);
    const needle = q.trim().toLowerCase();
    return data.transactions.filter((t) => {
      if (bounds && !withinBounds(t.date, bounds)) return false;
      if (filter === 'review' && t.bucket !== 'unreviewed') return false;
      if (filter === 'receipts' && !needsReceipt(t, data.settings)) return false;
      if (filter === 'ai' && t.classifiedBy !== 'ai') return false;
      if (filter === 'old' && !fromOldApp(t)) return false;
      if (filter === 'auto' && t.classifiedBy !== 'rule' && t.classifiedBy !== 'cstl' && t.classifiedBy !== 'import' && t.classifiedBy !== 'invoice') return false;
      if (needle && !`${t.counterparty} ${t.reference} ${t.note}`.toLowerCase().includes(needle) && !(t.amountPence / 100).toFixed(2).includes(needle)) return false;
      return true;
    }).sort((a, b) =>
      filter === 'ai' ? CONF[a.meta.aiConfidence ?? 'low']! - CONF[b.meta.aiConfidence ?? 'low']!
      // Old-app records the new app doesn't count as business come first: those are the gap.
      : filter === 'old' ? Number(isBusiness(a)) - Number(isBusiness(b))
      : 0);
  }, [data, filter, year, q]);
  const aiRows = data.transactions.filter((t) => t.classifiedBy === 'ai');
  // Anything the AI has ever decided, confirmed or not — what "undo" can rewind.
  const aiTouched = data.transactions.some((t) => t.meta.aiReason);
  const oldRows = filter === 'old' ? rows : [];
  const sumOf = (list: Transaction[]) => list.reduce((a, t) => a + t.amountPence, 0);
  const oldCosts = oldRows.filter((t) => t.direction === 'out');
  const oldIncome = oldRows.filter((t) => t.direction === 'in');

  const open = data.transactions.find((t) => t.id === openId) ?? null;
  const unreviewed = data.transactions.filter((t) => t.bucket === 'unreviewed');
  // What the AI will look at: unsorted lines, plus business lines still missing a stream.
  const aiQueue = data.transactions.filter(
    (t) =>
      t.classifiedBy !== 'user' &&
      t.classifiedBy !== 'ai' &&
      !t.meta.aiTried &&
      (t.bucket === 'unreviewed' || ((t.bucket === 'business_income' || t.bucket === 'business_expense') && (!t.streamId || t.meta.aiRestream === '1'))),
  ).length;

  const nextUnreviewed = () => {
    // The row just saved has left the queue; move to the next one still in it.
    const remaining = app.data!.transactions.filter((t) => t.bucket === 'unreviewed' && t.id !== openId);
    if (remaining.length) setOpenId(remaining[0]!.id);
    else {
      setOpenId(null);
      setReviewing(false);
      app.notify('Inbox clear.');
    }
  };

  const years = [...new Set(data.transactions.map((t) => taxYearOf(t.date)))].sort((a, b) => b - a);
  if (!years.includes(currentYear)) years.unshift(currentYear);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Title>Money</Title>

      {unreviewed.length > 0 && (
        <Button
          tone="primary"
          onClick={() => {
            setReviewing(true);
            setOpenId(unreviewed[0]!.id);
          }}
        >
          Review {unreviewed.length} waiting
        </Button>
      )}

      {data.config.aiSort && aiQueue > 0 && !app.aiProgress && (
        <Button onClick={app.aiSortAll} disabled={app.busy}>
          🤖 Sort {aiQueue} with AI, then I’ll check
        </Button>
      )}
      {app.aiProgress && (
        <Card style={{ borderColor: T.accent + '66' }}>
          <Label color={T.accent}>AI sorting…</Label>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {app.aiProgress.sorted} sorted · about {app.aiProgress.remaining} to go. Keep this open; it works in batches of 40.
          </div>
        </Card>
      )}
      {filter === 'ai' && aiRows.length > 0 && (
        <Card style={{ borderColor: T.green + '66' }}>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            {aiRows.length} line{aiRows.length === 1 ? '' : 's'} sorted by AI, least certain first. Open any that look wrong and fix them; then confirm the rest.
          </div>
          <Button
            tone="green"
            style={{ marginTop: 10, width: '100%' }}
            disabled={app.busy}
            onClick={async () => {
              if (!window.confirm(`Confirm all ${aiRows.length} AI-sorted lines as they are?`)) return;
              await app.classifyMany(aiRows.map((t) => t.id), {});
            }}
          >
            Looks right — confirm all {aiRows.length}
          </Button>
        </Card>
      )}

      {aiTouched && !app.aiProgress && (
        <Button
          tone="quiet"
          disabled={app.busy}
          onClick={async () => {
            if (!window.confirm('Undo the AI’s sorting? Every line it sorted goes back to how it was before — lines you changed by hand yourself stay as they are. You can run the AI again afterwards.')) return;
            await app.aiUndo();
          }}
        >
          ↩︎ Undo AI sorting
        </Button>
      )}

      {filter === 'old' && (
        <Card>
          <Label>From your old app{year === 'all' ? '' : ` · ${taxYearLabel(year)}`}</Label>
          <div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}>
            Costs: {oldCosts.length} · <Money pence={sumOf(oldCosts)} size={13} /> — counted as business here: <Money pence={sumOf(oldCosts.filter(isBusiness))} size={13} />
            <br />
            Income: {oldIncome.length} · <Money pence={sumOf(oldIncome)} size={13} /> — counted as business here: <Money pence={sumOf(oldIncome.filter(isBusiness))} size={13} />
          </div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6, lineHeight: 1.5 }}>
            Ones not counted as business are listed first — open one to put it right. Only records your old app marked as business costs or paid income come across; its Bank tab “Spending” (all card spending) doesn’t.
          </div>
        </Card>
      )}

      {data.cstlOther.length > 0 && (
        <Card style={{ borderColor: T.blue + '66' }}>
          <Label color={T.blue}>CSTL sessions paid by card / other</Label>
          <div style={{ fontSize: 12, color: T.textMuted, margin: '6px 0 8px', lineHeight: 1.5 }}>
            Not added automatically — a card reader pays out to the bank in batches, so these may already be counted.
          </div>
          {data.cstlOther.map((o) => (
            <div key={o.bookingId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${T.border}` }}>
              <div style={{ flex: 1, fontSize: 13 }}>
                <Money pence={o.amountPence} size={13} /> · {fmtDate(o.date)}
                <div style={{ fontSize: 11, color: T.textMuted }}>{o.note}</div>
              </div>
              <Button
                style={{ padding: '6px 10px', fontSize: 12 }}
                onClick={async () => {
                  await app.addTransaction({
                    date: o.date, amountPence: o.amountPence, direction: 'in', counterparty: 'CSTL client', cstlBookingId: o.bookingId,
                    bucket: 'business_income', streamId: data.settings.cstlStreamId, note: o.note,
                  });
                  await app.reload();
                }}
              >
                Add
              </Button>
              <Button
                tone="quiet"
                style={{ padding: '6px 8px', fontSize: 12 }}
                onClick={async () => {
                  await api.dismissCstl(o.bookingId).catch(() => undefined);
                  await app.reload();
                }}
              >
                In bank
              </Button>
            </div>
          ))}
        </Card>
      )}

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        <Chip active={filter === 'review'} onClick={() => setFilter('review')}>To review</Chip>
        {aiRows.length > 0 && <Chip active={filter === 'ai'} color={T.green} onClick={() => setFilter('ai')}>AI: check ({aiRows.length})</Chip>}
        {data.transactions.some(fromOldApp) && <Chip active={filter === 'old'} onClick={() => setFilter('old')}>Old app</Chip>}
        <Chip active={filter === 'receipts'} onClick={() => setFilter('receipts')}>Needs receipt</Chip>
        <Chip active={filter === 'auto'} onClick={() => setFilter('auto')}>Auto-sorted</Chip>
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <select style={{ ...inputStyle, width: 'auto' }} value={String(year)} onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>{taxYearLabel(y)}</option>
          ))}
          <option value="all">All years</option>
        </select>
        <input style={inputStyle} placeholder="Search name, reference, amount" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {rows.length === 0 ? (
        <Empty>
          {filter === 'review' ? 'Nothing waiting. Every line is sorted.' : filter === 'receipts' ? 'Every business cost has its receipt.' : 'No transactions here.'}
          {!data.config.starling && filter !== 'receipts' && (
            <>
              <br />
              The bank isn’t connected yet — see Settings → Connections.
            </>
          )}
        </Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.slice(0, 400).map((t) => (
            <Row key={t.id} t={t} streamName={t.streamId ? streams.get(t.streamId)?.name : undefined} onOpen={() => setOpenId(t.id)} />
          ))}
          {rows.length > 400 && <Empty>Showing the first 400 — search or pick a year to narrow it down.</Empty>}
        </div>
      )}

      <TransactionSheet
        app={app}
        txn={open}
        onClose={() => {
          setOpenId(null);
          setReviewing(false);
        }}
        onNext={reviewing ? nextUnreviewed : undefined}
      />
    </div>
  );
}

function Row({ t, streamName, onOpen }: { t: Transaction; streamName?: string; onOpen: () => void }) {
  const detail =
    t.bucket === 'business_expense' && t.category
      ? categoryInfo(t.category).label
      : t.bucket === 'unreviewed'
        ? t.reference || (t.meta.account ?? '')
        : BUCKET_LABEL[t.bucket];
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 2px', background: 'none', border: 'none', borderBottom: `1px solid ${T.border}`, textAlign: 'left', cursor: 'pointer', color: T.text, width: '100%' }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 4, background: BUCKET_COLOR[t.bucket], flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t.counterparty || t.reference || '—'}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: T.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[t.classifiedBy === 'ai' ? `🤖 ${t.meta.aiConfidence ?? ''}` : '', fmtDate(t.date), detail, streamName, t.receiptIds.length ? '🧾' : '', t.source === 'cash' ? 'cash' : ''].filter(Boolean).join(' · ')}
        </span>
      </span>
      <Money pence={t.amountPence} signed={t.direction} color={t.direction === 'in' ? T.green : T.text} size={14} />
    </button>
  );
}
