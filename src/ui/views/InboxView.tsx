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
import { DoublesSheet, doublesCount } from './DoublesSheet';

// Every movement of money. Sorting happens in the swipe deck; this is where you look things up,
// see the totals, and find what you swiped away ("Not business") to put it back. Records brought
// over from the old app are just rows like any other — no separate place to look.

type Filter = 'review' | 'income' | 'costs' | 'notbusiness' | 'all' | 'in' | 'out' | 'ai' | 'receipts' | 'auto';

/** Filters you rarely need, kept behind "More" so the everyday four stay clear. */
const MORE_FILTERS: readonly Filter[] = ['in', 'out', 'receipts', 'auto', 'ai'];

// Least certain first, so the ones worth a real look come to the top.
const CONF: Record<string, number> = { low: 0, medium: 1, high: 2 };

export function InboxView({ app, sort, toSort }: { app: App; sort: () => void; toSort: number }) {
  const data = app.data!;
  const currentYear = taxYearOf(data.today);
  const [filter, setFilter] = useState<Filter>('review');
  const [year, setYear] = useState<number | 'all'>(currentYear);
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);
  const [doublesOpen, setDoublesOpen] = useState(false);
  const twice = doublesCount(app);
  const [openId, setOpenId] = useState<string | null>(null);
  const streams = new Map(data.streams.map((s) => [s.id, s]));

  const rows = useMemo(() => {
    const bounds = year === 'all' ? null : taxYearBounds(year);
    const needle = q.trim().toLowerCase();
    return data.transactions.filter((t) => {
      if (bounds && !withinBounds(t.date, bounds)) return false;
      if (filter === 'review' && t.bucket !== 'unreviewed') return false;
      if (filter === 'income' && t.bucket !== 'business_income') return false;
      if (filter === 'costs' && t.bucket !== 'business_expense') return false;
      if (filter === 'notbusiness' && t.bucket !== 'personal' && t.bucket !== 'transfer') return false;
      if (filter === 'in' && t.direction !== 'in') return false;
      if (filter === 'out' && t.direction !== 'out') return false;
      if (filter === 'receipts' && !needsReceipt(t, data.settings)) return false;
      if (filter === 'ai' && t.classifiedBy !== 'ai') return false;
      if (filter === 'auto' && t.classifiedBy !== 'rule' && t.classifiedBy !== 'cstl' && t.classifiedBy !== 'import' && t.classifiedBy !== 'invoice') return false;
      if (needle && !`${t.counterparty} ${t.reference} ${t.note}`.toLowerCase().includes(needle) && !(t.amountPence / 100).toFixed(2).includes(needle)) return false;
      return true;
    }).sort((a, b) =>
      filter === 'ai' ? CONF[a.meta.aiConfidence ?? 'low']! - CONF[b.meta.aiConfidence ?? 'low']! : 0);
  }, [data, filter, year, q]);
  const aiRows = data.transactions.filter((t) => t.classifiedBy === 'ai');
  // Anything the AI has ever decided, confirmed or not — what "undo" can rewind.
  const aiTouched = data.transactions.some((t) => t.meta.aiReason);
  const showMore = more || MORE_FILTERS.includes(filter);

  const open = data.transactions.find((t) => t.id === openId) ?? null;
  // What the list adds up to, where a total means something.
  const total =
    filter === 'income' ? { label: 'Business income', pence: rows.reduce((a, t) => a + (t.direction === 'in' ? t.amountPence : -t.amountPence), 0) }
    : filter === 'costs' ? { label: 'Business costs', pence: rows.reduce((a, t) => a + (t.direction === 'out' ? t.amountPence : -t.amountPence), 0) }
    : filter === 'notbusiness' ? { label: 'Not counted', pence: rows.reduce((a, t) => a + t.amountPence, 0) }
    : filter === 'in' ? { label: 'All money in', pence: rows.reduce((a, t) => a + t.amountPence, 0) }
    : filter === 'out' ? { label: 'All money out', pence: rows.reduce((a, t) => a + t.amountPence, 0) }
    : null;
  // What the AI will look at: unsorted lines, plus business lines still missing a stream.
  const aiQueue = data.transactions.filter(
    (t) =>
      t.classifiedBy !== 'user' &&
      t.classifiedBy !== 'ai' &&
      !t.meta.aiTried &&
      (t.bucket === 'unreviewed' || ((t.bucket === 'business_income' || t.bucket === 'business_expense') && (!t.streamId || t.meta.aiRestream === '1'))),
  ).length;

  const years = [...new Set(data.transactions.map((t) => taxYearOf(t.date)))].sort((a, b) => b - a);
  if (!years.includes(currentYear)) years.unshift(currentYear);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Title>Money</Title>

      {toSort > 0 && (
        <Button tone="primary" onClick={sort}>
          Sort {toSort} — one at a time
        </Button>
      )}

      {twice > 0 && (
        <Card onClick={() => setDoublesOpen(true)} style={{ borderColor: T.danger + '66' }}>
          <Label color={T.danger}>Counted twice?</Label>
          <div style={{ fontSize: 14, marginTop: 6 }}>{twice} look{twice === 1 ? 's' : ''} like the same money recorded twice — tap to check</div>
        </Card>
      )}
      {doublesOpen && <DoublesSheet app={app} onClose={() => setDoublesOpen(false)} />}

      {app.aiProgress && (
        <Card style={{ borderColor: T.accent + '66' }}>
          <Label color={T.accent}>{app.aiProgress.photos ? 'AI reading your old receipt photos…' : 'AI sorting…'}</Label>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {app.aiProgress.photos
              ? `${app.aiProgress.sorted} read · ${app.aiProgress.remaining} to go. Then it sorts. Keep this open.`
              : `${app.aiProgress.sorted} sorted · about ${app.aiProgress.remaining} to go. Keep this open; it works in batches of 20, thinking each one through.`}
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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip active={filter === 'review'} onClick={() => setFilter('review')}>To sort</Chip>
        <Chip active={filter === 'income'} color={T.green} onClick={() => setFilter('income')}>Income</Chip>
        <Chip active={filter === 'costs'} color={T.expense} onClick={() => setFilter('costs')}>Costs</Chip>
        <Chip active={filter === 'notbusiness'} color={T.textMuted} onClick={() => setFilter('notbusiness')}>Not business</Chip>
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
        <Chip active={MORE_FILTERS.includes(filter)} onClick={() => { if (showMore && MORE_FILTERS.includes(filter)) setFilter('review'); setMore(!showMore); }}>
          More {showMore ? '▴' : '▾'}
        </Chip>
      </div>
      {showMore && (
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Chip active={filter === 'in'} color={T.green} onClick={() => setFilter('in')}>Money in</Chip>
            <Chip active={filter === 'out'} onClick={() => setFilter('out')}>Money out</Chip>
            <Chip active={filter === 'receipts'} onClick={() => setFilter('receipts')}>Needs receipt</Chip>
            <Chip active={filter === 'auto'} onClick={() => setFilter('auto')}>Sorted automatically</Chip>
            {aiRows.length > 0 && <Chip active={filter === 'ai'} color={T.green} onClick={() => setFilter('ai')}>AI: check ({aiRows.length})</Chip>}
          </div>
          {data.config.aiSort && aiQueue > 0 && !app.aiProgress && (
            <Button onClick={app.aiSortAll} disabled={app.busy}>
              🤖 Sort {aiQueue} with AI, then I’ll check
            </Button>
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
        </Card>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <select style={{ ...inputStyle, width: 'auto' }} value={String(year)} onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>{taxYearLabel(y)}</option>
          ))}
          <option value="all">All years</option>
        </select>
        <input style={inputStyle} placeholder="Search name, reference, amount" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {total && rows.length > 0 && (
        <div style={{ background: T.text, color: T.bg, borderRadius: 12, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{total.label} · {rows.length}</span>
          <Money pence={total.pence} color={T.bg} size={16} />
        </div>
      )}
      {filter === 'notbusiness' && rows.length > 0 && (
        <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
          What you swiped away. Nothing is deleted — tap one and “Put back to sort” if it was business after all.
        </div>
      )}

      {rows.length === 0 ? (
        <Empty>
          {filter === 'review' ? 'Nothing waiting. Every line is sorted.' : filter === 'receipts' ? 'Every business cost has its receipt.' : filter === 'notbusiness' ? 'Nothing swiped away yet.' : 'No transactions here.'}
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

      <TransactionSheet app={app} txn={open} onClose={() => setOpenId(null)} />
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
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 2px 12px 10px', background: 'none', border: 'none', borderLeft: `3px solid ${BUCKET_COLOR[t.bucket]}`, borderBottom: `1px solid ${T.border}`, textAlign: 'left', cursor: 'pointer', color: T.text, width: '100%' }}
    >
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
