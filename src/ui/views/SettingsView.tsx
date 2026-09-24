import { useRef, useState } from 'react';
import { T } from '../theme';
import { BUCKET_LABEL, Button, Card, Chip, Field, Label, Section, Title, inputStyle } from '../components';
import { categoryInfo } from '../../core/hmrc';
import { formatAmount, parsePence } from '../../core/money';
import { parseHoneypotBackup, parseLocalV0, type ImportedItem } from '../../core/importers';
import { STORES, getAll } from '../../storage/db';
import { api } from '../api';
import type { Stream } from '../../core/types';
import type { App } from '../useApp';

const COLORS = ['#E0A92E', '#6E86D0', '#5BBF8A', '#D66E8E', '#9B7BD4', '#4FB6C4'];

export function SettingsView({ app }: { app: App }) {
  const data = app.data!;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Title>Settings</Title>
      <StreamsSection app={app} />
      <ConnectionsSection app={app} />
      <RulesSection app={app} />
      <Section title="Receipts">
        <Card>
          <Field label="Ask for a receipt on business costs over (£)" hint="HMRC expects records for every cost; set 0 to be asked about all of them.">
            <input
              style={inputStyle}
              inputMode="decimal"
              defaultValue={formatAmount(data.settings.receiptThresholdPence)}
              onBlur={(e) => app.saveSettings({ receiptThresholdPence: parsePence(e.target.value) })}
            />
          </Field>
        </Card>
      </Section>
      <ImportSection app={app} />
      <Button tone="danger" onClick={app.signOut}>Sign out</Button>
    </div>
  );
}

function StreamsSection({ app }: { app: App }) {
  const data = app.data!;
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Stream | null>(null);
  return (
    <Section title="Income streams">
      <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
        One per kind of work — each self-employment gets its own pages on the tax return. “Not taxed here” is for money you want to track but that isn’t self-employment.
      </div>
      {data.streams.map((s) => (
        <Card key={s.id} style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10, opacity: s.archived ? 0.5 : 1 }} onClick={() => setEditing(s)}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: s.color }} />
          <span style={{ flex: 1, fontWeight: 600 }}>{s.name}</span>
          <span style={{ fontSize: 11, color: T.textMuted }}>
            {s.kind === 'other' ? 'Not taxed here' : 'Self-employment'}
            {data.settings.cstlStreamId === s.id ? ' · CSTL' : ''}
            {s.archived ? ' · archived' : ''}
          </span>
        </Card>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={inputStyle} placeholder="e.g. CSTL practice, Freelance design" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          tone="primary"
          disabled={!name.trim() || app.busy}
          onClick={async () => {
            await app.saveStream({ name: name.trim(), kind: 'self_employment', color: COLORS[data.streams.length % COLORS.length]!, archived: false });
            setName('');
          }}
        >
          Add
        </Button>
      </div>
      {editing && (
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Name">
            <input style={inputStyle} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </Field>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Chip active={editing.kind === 'self_employment'} onClick={() => setEditing({ ...editing, kind: 'self_employment' })}>Self-employment</Chip>
            <Chip active={editing.kind === 'other'} onClick={() => setEditing({ ...editing, kind: 'other' })}>Not taxed here</Chip>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => setEditing({ ...editing, color: c })}
                style={{ width: 28, height: 28, borderRadius: 14, background: c, border: editing.color === c ? `3px solid ${T.text}` : 'none', cursor: 'pointer' }} />
            ))}
          </div>
          <label style={{ fontSize: 13, display: 'flex', gap: 8 }}>
            <input type="checkbox" checked={data.settings.cstlStreamId === editing.id} onChange={(e) => app.saveSettings({ cstlStreamId: e.target.checked ? editing.id : null })} />
            CSTL session income goes here
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button tone="primary" onClick={async () => { await app.saveStream(editing); setEditing(null); }}>Save</Button>
            <Button onClick={async () => { await app.saveStream({ ...editing, archived: !editing.archived }); setEditing(null); }}>
              {editing.archived ? 'Unarchive' : 'Archive'}
            </Button>
            <Button tone="quiet" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </Card>
      )}
    </Section>
  );
}

function ConnectionsSection({ app }: { app: App }) {
  const { config, lastSync } = app.data!;
  const row = (ok: boolean, name: string, how: string) => (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: `1px solid ${T.border}` }}>
      <span style={{ color: ok ? T.green : T.accentBright, fontWeight: 700 }}>{ok ? '●' : '○'}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
        {!ok && <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>{how}</div>}
      </div>
    </div>
  );
  return (
    <Section title="Connections">
      <Card style={{ paddingTop: 8 }}>
        {row(config.starling, 'Starling bank feed', 'Set STARLING_TOKEN in Vercel (a read-only personal access token from the Starling developer portal). Several accounts: STARLING_TOKENS, comma-separated.')}
        {row(config.cstl, 'CSTL sessions', 'Set CSTL_URL and CSTL_FINANCE_TOKEN here, and the same token as FINANCE_API_TOKEN in the CSTL app.')}
        {row(config.receiptsAi, 'Receipt reading', 'Set ANTHROPIC_API_KEY to read receipts automatically.')}
        {row(config.cron, 'Daily automatic sync', 'Set CRON_SECRET so the daily sync can run by itself.')}
        {lastSync?.errors.length ? <div style={{ fontSize: 12, color: T.danger, marginTop: 8 }}>Last sync: {lastSync.errors.join(' — ')}</div> : null}
      </Card>
    </Section>
  );
}

function RulesSection({ app }: { app: App }) {
  const data = app.data!;
  const streams = new Map(data.streams.map((s) => [s.id, s.name]));
  return (
    <Section title={`Auto-sort rules (${data.rules.length})`}>
      {data.rules.length === 0 && (
        <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
          None yet. When you classify a bank line, tick “Always do this” and every future one like it sorts itself.
        </div>
      )}
      {data.rules.map((r) => (
        <Card key={r.id} style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
            <strong>“{r.pattern}”</strong> {r.direction === 'in' ? '(money in)' : r.direction === 'out' ? '(money out)' : ''} →{' '}
            {BUCKET_LABEL[r.bucket]}
            {r.streamId ? ` · ${streams.get(r.streamId) ?? ''}` : ''}
            {r.category ? ` · ${categoryInfo(r.category).label}` : ''}
            {r.bucket === 'business_expense' && r.businessPercent !== 100 ? ` · ${r.businessPercent}%` : ''}
          </div>
          <Button tone="quiet" onClick={() => app.deleteRule(r.id)} style={{ padding: '4px 8px' }}>Remove</Button>
        </Card>
      ))}
    </Section>
  );
}

function ImportSection({ app }: { app: App }) {
  const data = app.data!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [streamId, setStreamId] = useState<string | null>(data.streams[0]?.id ?? null);
  const [status, setStatus] = useState('');

  const send = async (items: ImportedItem[]) => {
    const totals = { linked: 0, created: 0, skipped: 0, receipts: 0 };
    // Small batches: old receipts carry their photos inline, and requests have a size limit.
    for (let i = 0; i < items.length; ) {
      const batch: ImportedItem[] = [];
      let size = 0;
      while (i < items.length && batch.length < 50 && size < 3_000_000) {
        const it = items[i++]!;
        batch.push(it);
        size += (it.imageDataUrl?.length ?? 0) + 300;
      }
      setStatus(`Importing ${Math.min(i, items.length)} of ${items.length}…`);
      const r = await api.importItems(batch, streamId);
      totals.linked += r.linked;
      totals.created += r.created;
      totals.skipped += r.skipped;
      totals.receipts += r.receipts;
    }
    setStatus(
      `Done: ${totals.linked} matched to bank lines, ${totals.created} added (not in the bank feed — check these), ${totals.receipts} receipt photos, ${totals.skipped} already imported or unreadable.`,
    );
    await app.reload();
  };

  const fromFile = async (file: File) => {
    try {
      const items = parseHoneypotBackup(JSON.parse(await file.text()));
      await send(items);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const fromDevice = async () => {
    try {
      const [income, expenses] = await Promise.all([getAll<Record<string, unknown>>(STORES.income), getAll<Record<string, unknown>>(STORES.expenses)]);
      const items = parseLocalV0(income, expenses);
      if (!items.length) {
        setStatus('Nothing stored on this device from the earlier version.');
        return;
      }
      await send(items);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  return (
    <Section title="Bring in old records">
      <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
          Sync the bank first, so old records can be matched to their bank lines instead of counted twice. Anything with no bank line (cash) is added and marked for you to check.
        </div>
        {data.streams.length > 0 && (
          <Field label="File imported income under">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {data.streams.map((s) => <Chip key={s.id} active={streamId === s.id} color={s.color} onClick={() => setStreamId(s.id)}>{s.name}</Chip>)}
            </div>
          </Field>
        )}
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void fromFile(f); }} />
        <Button onClick={() => fileRef.current?.click()}>Import a Honey backup file (Honeypot0101 → Export backup)</Button>
        <Button onClick={fromDevice}>Upload records saved on this device by the earlier version</Button>
        {status && <div style={{ fontSize: 12, color: T.text, lineHeight: 1.5 }}>{status}</div>}
        <Label>Export</Label>
        <div style={{ fontSize: 12, color: T.textMuted }}>Each year’s ledger downloads as CSV from the Tax tab.</div>
      </Card>
    </Section>
  );
}
