import { useRef, useState } from 'react';
import { T, fonts } from '../theme';
import { Button, Card, Label, Money, Section, Stat, Title, fmtDate, Sheet, Field, inputStyle, Chip } from '../components';
import { CameraIcon, RefreshIcon } from '../icons';
import { taxYearLabel } from '../../core/dates';
import { parsePence } from '../../core/money';
import type { App } from '../useApp';
import type { View } from '../Shell';

// The one-glance answer: how much should be in the tax pot right now, what HMRC wants next
// and when, and what's left to tidy.

export function HomeView({ app, go }: { app: App; go: (v: View) => void }) {
  const data = app.data!;
  const p = app.picture!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [cashOpen, setCashOpen] = useState(false);
  const streamName = new Map(data.streams.map((s) => [s.id, s]));
  const next = p.upcoming[0];
  const nextDateTotal = next ? p.upcoming.filter((x) => x.due === next.due).reduce((a, x) => a + x.amountPence, 0) : 0;
  const todo = p.review.unreviewed + p.review.missingReceipts + p.review.noStream;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Title right={<span style={{ fontFamily: fonts.mono, fontSize: 11, color: T.textMuted }}>Tax year {taxYearLabel(p.taxYear)}</span>}>Honey</Title>

      <Card style={{ background: T.accent + '14', borderColor: T.accent + '55' }}>
        <Label color={T.accent}>Your tax pot should hold</Label>
        <div style={{ marginTop: 6 }}>
          <Money pence={p.potTargetPence} color={T.accentBright} size={34} />
        </div>
        <div style={{ fontSize: 13, color: T.text, marginTop: 8, lineHeight: 1.5 }}>
          Put aside <strong>{Math.round(p.estimate.setAsideRate * 100)}%</strong> of every business payment from now on.
        </div>
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6, lineHeight: 1.5 }}>
          Tax on {taxYearLabel(p.taxYear)} so far{p.previous.stillOwedPence > 0 ? ` + ${taxYearLabel(p.previous.taxYear)}’s bill still to pay` : ''}
          {p.estimate.lowConfidence ? '. Early in the year — add your expected profit in Tax for a steadier figure.' : '.'}
        </div>
      </Card>

      {next && (
        <Card onClick={() => go('tax')}>
          <Label>Next HMRC payment</Label>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
            <Money pence={nextDateTotal} size={22} color={T.text} />
            <span style={{ fontSize: 13, color: T.textMuted }}>{fmtDate(next.due)}</span>
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
            {p.upcoming.filter((x) => x.due === next.due).map((x) => x.label).join(' + ')}
            {p.upcoming.some((x) => x.due === next.due && x.estimated) ? ' · estimate' : ''}
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Button tone="primary" onClick={() => fileRef.current?.click()} disabled={app.busy}>
          <CameraIcon size={18} color={T.bg} /> Snap receipt
        </Button>
        <Button onClick={() => setCashOpen(true)}>+ Cash in/out</Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void app.uploadReceipts(files);
        }}
      />

      {todo > 0 && (
        <Card onClick={() => go('inbox')} style={{ borderColor: T.accentBright + '66' }}>
          <Label color={T.accentBright}>To tidy</Label>
          <div style={{ fontSize: 14, color: T.text, marginTop: 6, lineHeight: 1.7 }}>
            {p.review.unreviewed > 0 && <div>{p.review.unreviewed} bank line{p.review.unreviewed === 1 ? '' : 's'} to classify</div>}
            {p.review.missingReceipts > 0 && <div>{p.review.missingReceipts} business cost{p.review.missingReceipts === 1 ? '' : 's'} without a receipt</div>}
            {p.review.noStream > 0 && <div>{p.review.noStream} business line{p.review.noStream === 1 ? '' : 's'} with no stream</div>}
          </div>
        </Card>
      )}

      <Section title={`This year by stream`}>
        {p.streams.length === 0 && <div style={{ fontSize: 13, color: T.textFaint }}>Nothing classified as business yet.</div>}
        {p.streams.map((s) => {
          const st = s.streamId ? streamName.get(s.streamId) : null;
          return (
            <Card key={s.streamId ?? 'none'} style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: st?.color ?? T.accentBright }}>{st?.name ?? 'No stream yet'}</span>
                <Money pence={s.profitPence} color={s.profitPence >= 0 ? T.green : T.danger} />
              </div>
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>
                In {(s.turnoverPence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })} · costs{' '}
                {(s.allowableExpensesPence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })}
              </div>
            </Card>
          );
        })}
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Stat label="Profit so far" pence={p.trading.profitPence} color={T.text} sub={p.trading.usesTradingAllowance ? 'Using the £1,000 trading allowance' : 'After allowable costs'} />
        <Stat label="Year projected" pence={p.estimate.projectedProfitPence} color={T.textMuted} sub={p.estimate.projectionBasis === 'expected' ? 'Your own estimate' : 'Scaled up from so far'} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 11, color: T.textFaint }}>
          {data.lastSync ? `Last synced ${new Date(data.lastSync.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Never synced'}
          {app.pending > 0 ? ` · ${app.pending} receipt${app.pending === 1 ? '' : 's'} waiting for signal` : ''}
        </span>
        <Button tone="quiet" onClick={app.sync} disabled={app.busy} style={{ padding: '6px 8px', fontSize: 12 }}>
          <RefreshIcon size={14} color={T.textMuted} /> Sync now
        </Button>
      </div>

      <CashSheet app={app} open={cashOpen} onClose={() => setCashOpen(false)} />
    </div>
  );
}

function CashSheet({ app, open, onClose }: { app: App; open: boolean; onClose: () => void }) {
  const data = app.data!;
  const streams = data.streams.filter((s) => !s.archived);
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [who, setWho] = useState('');
  const [date, setDate] = useState(data.today);
  const [streamId, setStreamId] = useState<string | null>(streams[0]?.id ?? null);

  const submit = async () => {
    const amountPence = parsePence(amount);
    if (amountPence <= 0) return;
    await app.addTransaction({
      date,
      amountPence,
      direction,
      counterparty: who.trim(),
      bucket: direction === 'in' ? 'business_income' : 'business_expense',
      streamId,
      category: direction === 'out' ? 'otherExpenses' : null,
    });
    setAmount('');
    setWho('');
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Cash in or out">
      <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
        Only for money that never touches the bank. Bank payments arrive by themselves — don’t add them here or they’ll count twice.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Chip active={direction === 'in'} color={T.green} onClick={() => setDirection('in')}>Cash received</Chip>
        <Chip active={direction === 'out'} color={T.expense} onClick={() => setDirection('out')}>Cash spent on the business</Chip>
      </div>
      <Field label="Amount">
        <input style={inputStyle} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 60.00" />
      </Field>
      <Field label={direction === 'in' ? 'From' : 'Paid to'}>
        <input style={inputStyle} value={who} onChange={(e) => setWho(e.target.value)} />
      </Field>
      <Field label="Date">
        <input style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {streams.length > 0 && (
        <Field label="Stream">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {streams.map((s) => (
              <Chip key={s.id} active={streamId === s.id} color={s.color} onClick={() => setStreamId(s.id)}>{s.name}</Chip>
            ))}
          </div>
        </Field>
      )}
      <Button tone={direction === 'in' ? 'green' : 'primary'} onClick={submit} disabled={app.busy}>
        Save
      </Button>
    </Sheet>
  );
}
