import { useMemo } from 'react';
import { deriveTotals } from '../../core/tax';
import { formatGBP } from '../../core/money';
import { invoiceTotalPence } from '../../core/invoice';
import { fonts, pageBackground, type Theme } from '../theme';
import { MoneyRings } from '../components/Rings';
import { LegendRow, ActivityRow } from '../components/Rows';
import { PillButton } from '../components/PillButton';
import { Avatar } from '../components/Avatar';
import type { Store } from '../useStore';

function monthLabel(now: Date): string {
  return now.toLocaleDateString('en-GB', { month: 'long' });
}

interface FeedItem {
  key: string;
  date: string;
  title: string;
  subtitle: string;
  amountPence: number;
  isIncome: boolean;
}

function recentActivity(store: Store): FeedItem[] {
  const items: FeedItem[] = [
    ...store.income.map((i) => ({
      key: 'i' + i.id,
      date: i.date,
      title: i.client || (i.method === 'cash' ? 'Cash payment' : 'Income'),
      subtitle: `${i.date} · ${i.documentId ? 'paid' : 'not invoiced'}`,
      amountPence: i.grossPence,
      isIncome: true,
    })),
    ...store.expenses.map((e) => ({
      key: 'e' + e.id,
      date: e.date,
      title: e.note || e.category,
      subtitle: `${e.date} · ${e.category}`,
      amountPence: e.amountPence,
      isIncome: false,
    })),
  ];
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 3);
}

export function HomeView({
  store,
  T,
  onSeeAll,
  onOpenLogWork,
  onOpenInvoice,
  onOpenReceipt,
  onOpenPaidIn,
  onOpenTaxStash,
}: {
  store: Store;
  T: Theme;
  onSeeAll: () => void;
  onOpenLogWork: () => void;
  onOpenInvoice: () => void;
  onOpenReceipt: () => void;
  onOpenPaidIn: () => void;
  onOpenTaxStash: () => void;
}) {
  const { income, expenses, invoices, settings } = store;
  const totals = useMemo(() => deriveTotals(income, expenses, settings), [income, expenses, settings]);
  const now = new Date();
  const pendingInvoices = useMemo(() => invoices.filter((i) => i.status === 'sent'), [invoices]);
  const pendingPence = useMemo(() => pendingInvoices.reduce((sum, i) => sum + invoiceTotalPence(i), 0), [pendingInvoices]);
  const entryCount = income.length + expenses.length;
  const feed = useMemo(() => recentActivity(store), [store.income, store.expenses]);

  const base = totals.grossPence || 1;
  const taxPercent = Math.min(100, (totals.taxStashPence / base) * 100);
  const pendingPercent = Math.min(100, (pendingPence / base) * 100);

  return (
    <div style={{ background: pageBackground(T, 'accent'), borderRadius: 32, padding: '4px 4px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0' }}>
        <div style={{ fontFamily: fonts.display, fontSize: 22, color: T.text }}>{monthLabel(now)}</div>
        <Avatar label={settings.name || 'You'} bg={T.ramp.accent2[T.mode === 'dark' ? 700 : 300]} color={T.mode === 'dark' ? T.ramp.accent2[100] : T.ramp.accent2[800]} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 2px' }}>
        <MoneyRings
          size={250}
          cutoutColor={T.bg}
          T={T}
          rings={[
            { percent: 100, color: T.ramp.accent[500], track: T.ramp.accent[500] },
            { percent: taxPercent, color: T.ramp.accent2[500], track: T.mode === 'dark' ? T.ramp.accent2[800] : T.ramp.accent2[200] },
            { percent: pendingPercent, color: T.ramp.neutral[T.mode === 'dark' ? 400 : 500], track: T.mode === 'dark' ? T.ramp.neutral[700] : T.ramp.neutral[300] },
          ]}
          center={
            <>
              <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted }}>Take-home</span>
              <span style={{ fontFamily: fonts.display, fontSize: 28, lineHeight: 1.1, color: T.text }}>{formatGBP(totals.takeHomePence)}</span>
            </>
          }
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px 4px' }}>
        <LegendRow T={T} dot={T.ramp.accent[500]} label="Total earned" value={formatGBP(totals.grossPence)} />
        <button onClick={onOpenTaxStash} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
          <LegendRow T={T} dot={T.ramp.accent2[500]} label={`Tax stash · ${settings.taxPercent}%`} value={formatGBP(totals.taxStashPence)} />
        </button>
        <LegendRow
          T={T}
          dot={T.ramp.neutral[500]}
          label={`Pending · ${pendingInvoices.length} ${pendingInvoices.length === 1 ? 'invoice' : 'invoices'}`}
          value={formatGBP(pendingPence)}
        />
      </div>

      <div style={{ padding: '4px 12px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted }}>Activity</span>
          {entryCount > 0 && (
            <button onClick={onSeeAll} style={{ background: 'none', border: 'none', color: T.accent, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              See all →
            </button>
          )}
        </div>
        {feed.length === 0 ? (
          <div style={{ fontSize: 13, color: T.textFaint, textAlign: 'center', padding: '16px 0', lineHeight: 1.5 }}>
            Nothing logged yet.<br />Tap <strong style={{ color: T.text }}>Log work</strong> below to add your first entry.
          </div>
        ) : (
          feed.map((r) => (
            <ActivityRow
              key={r.key}
              T={T}
              avatar={
                <Avatar
                  label={r.title}
                  size={40}
                  bg={r.isIncome ? T.ramp.accent2[T.mode === 'dark' ? 600 : 400] : T.ramp.accent[T.mode === 'dark' ? 600 : 300]}
                  color={r.isIncome ? (T.mode === 'dark' ? T.ramp.accent2[100] : T.ramp.accent2[900]) : T.mode === 'dark' ? T.ramp.accent[100] : T.ramp.accent[900]}
                />
              }
              title={r.title}
              subtitle={r.subtitle}
              amount={`${r.isIncome ? '' : '−'}${formatGBP(r.amountPence)}`}
            />
          ))
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, padding: '10px 12px 0' }}>
        <PillButton T={T} onClick={onOpenLogWork} height={50} fontSize={15}>Log work</PillButton>
        <PillButton T={T} onClick={onOpenInvoice} variant="glass" height={50} fontSize={15}>Invoice</PillButton>
        <PillButton T={T} onClick={onOpenReceipt} variant="glass" height={42} fontSize={13}>Scan receipt</PillButton>
        <PillButton T={T} onClick={onOpenPaidIn} variant="glass" height={42} fontSize={13}>Paid in</PillButton>
      </div>
    </div>
  );
}
