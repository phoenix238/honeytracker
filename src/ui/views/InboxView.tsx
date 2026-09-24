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

type Filter = 'review' | 'receipts' | 'auto' | 'all';

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
      if (filter === 'auto' && t.classifiedBy !== 'rule' && t.classifiedBy !== 'cstl' && t.classifiedBy !== 'import') return false;
      if (needle && !`${t.counterparty} ${t.reference} ${t.note}`.toLowerCase().includes(needle) && !(t.amountPence / 100).toFixed(2).includes(needle)) return false;
      return true;
    });
  }, [data, filter, year, q]);

  const open = data.transactions.find((t) => t.id === openId) ?? null;
  const unreviewed = data.transactions.filter((t) => t.bucket === 'unreviewed');

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
          {[fmtDate(t.date), detail, streamName, t.receiptIds.length ? '🧾' : '', t.source === 'cash' ? 'cash' : ''].filter(Boolean).join(' · ')}
        </span>
      </span>
      <Money pence={t.amountPence} signed={t.direction} color={t.direction === 'in' ? T.green : T.text} size={14} />
    </button>
  );
}
