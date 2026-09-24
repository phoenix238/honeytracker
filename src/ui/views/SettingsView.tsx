import { useRef, useState } from 'react';
import { T } from '../theme';
import { BUCKET_LABEL, Button, Card, Chip, Field, Label, Section, Title, inputStyle } from '../components';
import { categoryInfo } from '../../core/hmrc';
import { formatAmount, parsePence } from '../../core/money';
import { parseHoneypotBackup, parseLocalV0, type ImportedItem } from '../../core/importers';
import { STORES, getAll } from '../../storage/db';
import { api } from '../api';
import type { BusinessProfile, Stream } from '../../core/types';
import type { App } from '../useApp';

const COLORS = ['#E0A92E', '#6E86D0', '#5BBF8A', '#D66E8E', '#9B7BD4', '#4FB6C4'];

export function SettingsView({ app }: { app: App }) {
  const data = app.data!;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Title>Settings</Title>
      <ProfileSection app={app} />
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
      <StorageSection app={app} />
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
          <span style={{ flex: 1, fontWeight: 600 }}>
            {s.name}
            {data.config.aiSort && !s.about && !s.archived && <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: T.accent }}>Tap to describe it — the AI sorts much better</span>}
          </span>
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
            await app.saveStream({ name: name.trim(), kind: 'self_employment', color: COLORS[data.streams.length % COLORS.length]!, archived: false, about: '' });
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
          <Field label="What this work is" hint="The AI reads this to tell your streams apart. Say who pays you, how, roughly how much, and what you spend on it.">
            <textarea
              style={{ ...inputStyle, minHeight: 84, resize: 'vertical' }}
              placeholder="e.g. Craniosacral sessions. Clients pay £60–70 by bank transfer, reference is usually their name. Costs: couch roll, oils, CPD courses, clinic room hire."
              value={editing.about}
              onChange={(e) => setEditing({ ...editing, about: e.target.value })}
            />
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
        {row(config.receiptsAi, 'Receipt reading', 'Set ANTHROPIC_API_KEY to read receipts and sort with AI. Use a key made inside a workspace — or add ANTHROPIC_WORKSPACE_ID too.')}
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
  // With several streams the old app can't say which is which, so by default the AI decides.
  const aiStreams = data.config.aiSort && data.streams.filter((s) => !s.archived).length > 1;
  const [streamId, setStreamId] = useState<string | null>(aiStreams ? null : data.streams[0]?.id ?? null);
  const [status, setStatus] = useState('');

  const [importing, setImporting] = useState(false);

  const send = async (items: ImportedItem[]) => {
    const totals = { linked: 0, created: 0, already: 0, unreadable: 0, receipts: 0, bigPhotos: 0 };
    // A single photo bigger than a request can carry would fail the whole batch: keep the
    // record, drop just that photo.
    const safeItems = items.map((it) => {
      if ((it.imageDataUrl?.length ?? 0) > 3_000_000) {
        totals.bigPhotos++;
        return { ...it, imageDataUrl: null };
      }
      return it;
    });
    // Small batches: old receipts carry their photos inline, and requests have a size limit.
    for (let i = 0; i < safeItems.length; ) {
      const batch: ImportedItem[] = [];
      let size = 0;
      while (i < safeItems.length && batch.length < 40 && size < 3_000_000) {
        const it = safeItems[i++]!;
        batch.push(it);
        size += (it.imageDataUrl?.length ?? 0) + 300;
      }
      setStatus(`Importing ${Math.min(i, safeItems.length)} of ${safeItems.length}… keep this screen open.`);
      const r = await api.importItems(batch, streamId);
      totals.linked += r.linked;
      totals.created += r.created;
      totals.already += r.already;
      totals.unreadable += r.unreadable;
      totals.receipts += r.receipts;
    }
    const done =
      `Import done: ${totals.linked} matched to bank lines, ${totals.created} added (not found in the bank feed — check these), ` +
      `${totals.receipts} receipt photos` +
      (totals.already ? `, ${totals.already} already imported earlier (skipped, nothing doubled)` : '') +
      (totals.unreadable ? `, ${totals.unreadable} unreadable (no valid date or amount)` : '') +
      (totals.bigPhotos ? `, ${totals.bigPhotos} photos too large to bring over (their records came in without them)` : '') +
      '.';
    setStatus(done);
    app.notify(done);
    await app.reload();
  };

  const fromFile = async (file: File) => {
    setImporting(true);
    setStatus(`Reading ${file.name}…`);
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        throw new Error(`“${file.name}” isn’t a Honey backup — it couldn’t be read as a backup file. In the old app use Settings → Export backup, and pick the .json file it saves.`);
      }
      const items = parseHoneypotBackup(raw);
      const income = items.filter((i) => i.kind === 'income').length;
      const expenses = items.length - income;
      const photos = items.filter((i) => i.imageDataUrl).length;
      setStatus(`Found ${income} paid income records and ${expenses} business expenses (${photos} with photos). Importing…`);
      await send(items);
    } catch (e) {
      const msg = `Import didn’t finish: ${(e as Error).message}`;
      setStatus(msg);
      app.notify(msg);
    } finally {
      setImporting(false);
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
          <Field label="File imported income and costs under" hint={streamId === null ? 'Each record comes in with no stream; then tap “Sort with AI” in Money and it picks the stream for each one, for you to check.' : 'Everything imported goes under this one stream.'}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Chip active={streamId === null} color={T.green} onClick={() => setStreamId(null)}>{data.config.aiSort ? '🤖 Sort streams later (AI)' : 'Decide later'}</Chip>
              {data.streams.filter((s) => !s.archived).map((s) => <Chip key={s.id} active={streamId === s.id} color={s.color} onClick={() => setStreamId(s.id)}>{s.name}</Chip>)}
            </div>
          </Field>
        )}
        <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void fromFile(f); }} />
        <Button tone="primary" disabled={importing} onClick={() => fileRef.current?.click()}>
          {importing ? 'Importing…' : 'Import a Honey backup file (Honeypot0101 → Export backup)'}
        </Button>
        <Button onClick={fromDevice}>Upload records saved on this device by the earlier version</Button>
        {status && (
          <div style={{ fontSize: 13, color: T.text, lineHeight: 1.5, background: T.bg, border: `1px solid ${status.startsWith('Import didn') ? T.danger : T.accent}`, borderRadius: 10, padding: '10px 12px' }}>
            {status}
          </div>
        )}
        {data.config.aiSort && data.transactions.some((t) => t.classifiedBy === 'import') && (
          <Button
            disabled={app.busy || Boolean(app.aiProgress)}
            onClick={async () => {
              if (!window.confirm('Put every imported record back through the AI to choose its stream? You’ll check its choices under Money → AI: check.')) return;
              const r = await api.aiRestreamImports().catch((e: Error) => { setStatus(e.message); return null; });
              if (!r) return;
              setStatus(`${r.marked} imported records queued — sorting now…`);
              await app.aiSortAll();
              setStatus('Done — check the results under Money → AI: check.');
            }}
          >
            🤖 Let AI re-sort the streams of imported records
          </Button>
        )}
        {data.transactions.some((t) => t.meta.aiReason) && (
          <Button
            tone="quiet"
            disabled={app.busy || Boolean(app.aiProgress)}
            onClick={async () => {
              if (!window.confirm('Undo the AI’s sorting? Every line it sorted goes back to how it was before — lines you changed by hand yourself stay as they are.')) return;
              await app.aiUndo();
              setStatus('AI sorting undone. Compare with your old app under Money → Old app (pick “All years”).');
            }}
          >
            ↩︎ Undo AI sorting
          </Button>
        )}
        <Label>Export</Label>
        <div style={{ fontSize: 12, color: T.textMuted }}>Each year’s ledger downloads as CSV from the Tax tab.</div>
      </Card>
    </Section>
  );
}

function ProfileSection({ app }: { app: App }) {
  const data = app.data!;
  const [p, setP] = useState<BusinessProfile>(data.settings.profile);
  const [next, setNext] = useState(String(data.invoiceCounter));
  const [open, setOpen] = useState(!data.settings.profile.sortCode && !data.settings.profile.name);
  const set = (k: keyof BusinessProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setP((x) => ({ ...x, [k]: k === 'paymentTermsDays' ? Number(e.target.value) || 0 : e.target.value }));
  const save = async () => {
    const saved = await api.saveSettingsWithCounter({ profile: p, nextInvoiceNumber: Number(next) || 1 }).catch((e: Error) => {
      app.notify(e.message);
      return null;
    });
    if (saved) {
      await app.reload();
      app.notify('Details saved.');
      setOpen(false);
    }
  };
  return (
    <Section title="Your details (on invoices)" right={<Button tone="quiet" onClick={() => setOpen(!open)} style={{ padding: '2px 6px', fontSize: 12 }}>{open ? 'Close' : 'Edit'}</Button>}>
      {!open ? (
        <Card style={{ padding: 12, fontSize: 13, color: T.textMuted, lineHeight: 1.6 }}>
          {p.businessName || p.name || 'No name yet'}
          {p.sortCode || p.accountNumber ? ` · ${p.sortCode} ${p.accountNumber}` : ' · no bank details yet'}
        </Card>
      ) : (
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Your name"><input style={inputStyle} value={p.name} onChange={set('name')} /></Field>
          <Field label="Business / trading name (optional)"><input style={inputStyle} value={p.businessName} onChange={set('businessName')} /></Field>
          <Field label="Address (optional)"><textarea style={{ ...inputStyle, minHeight: 56 }} value={p.address} onChange={set('address')} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Email"><input style={inputStyle} value={p.email} onChange={set('email')} /></Field>
            <Field label="Phone"><input style={inputStyle} value={p.phone} onChange={set('phone')} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Sort code"><input style={inputStyle} inputMode="numeric" value={p.sortCode} onChange={set('sortCode')} placeholder="00-00-00" /></Field>
            <Field label="Account number"><input style={inputStyle} inputMode="numeric" value={p.accountNumber} onChange={set('accountNumber')} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field label="Number prefix"><input style={inputStyle} value={p.invoicePrefix} onChange={set('invoicePrefix')} /></Field>
            <Field label="Next number"><input style={inputStyle} inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
            <Field label="Pay within (days)"><input style={inputStyle} inputMode="numeric" value={String(p.paymentTermsDays)} onChange={set('paymentTermsDays')} /></Field>
          </div>
          <Field label="Footer line"><input style={inputStyle} value={p.footer} onChange={set('footer')} /></Field>
          <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
            Carrying on from old invoices? Set “Next number” one above your last invoice so numbers never repeat.
          </div>
          <Button tone="primary" onClick={save} disabled={app.busy}>Save details</Button>
        </Card>
      )}
    </Section>
  );
}

function StorageSection({ app }: { app: App }) {
  const { usedBytes, limitBytes } = app.data!.storage;
  const pct = limitBytes ? Math.min(100, (usedBytes / limitBytes) * 100) : 0;
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  const color = pct >= 90 ? T.danger : pct >= 75 ? T.accentBright : T.green;
  return (
    <Section title="Storage">
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span>{mb(usedBytes)} of {mb(limitBytes)} used</span>
          <span style={{ color, fontWeight: 700 }}>{pct.toFixed(pct < 1 ? 1 : 0)}%</span>
        </div>
        <div style={{ height: 8, background: T.bg, borderRadius: 4, marginTop: 8, overflow: 'hidden' }}>
          <div style={{ width: `${Math.max(pct, 1)}%`, height: '100%', background: color }} />
        </div>
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 8, lineHeight: 1.5 }}>
          Receipt photos take almost all the space (about 0.25 MB each). Home warns you at 75%. If you upgrade the Neon plan, set DB_STORAGE_LIMIT_MB in Vercel to the new size.
        </div>
      </Card>
    </Section>
  );
}
