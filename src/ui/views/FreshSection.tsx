import { useRef, useState } from 'react';
import { T } from '../theme';
import { Button, Card, Label, Money, Section, fmtDate } from '../components';
import { api, freshTemplateUrl, type FreshPreview } from '../api';
import { XLSX, shareOrDownload } from '../download';
import { addDays, taxYearLabel } from '../../core/dates';
import type { App } from '../useApp';

// Start fresh from one clean spreadsheet of everything. 1: Honey gives you the spreadsheet —
// your bank lines already in, the columns to fill in marked, every choice a dropdown. 2: you
// sort it on the laptop, adding Monzo and cash. 3: you bring it back; Honey shows what it read
// before changing anything, then replaces everything up to its last date. Undo is there after.

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Couldn’t read that file'));
    reader.readAsDataURL(file);
  });

export function FreshSection({ app }: { app: App }) {
  const data = app.data!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ name: string; data: string } | null>(null);
  const [preview, setPreview] = useState<FreshPreview | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const fresh = data.fresh;

  const download = async (prefill: boolean) => {
    setStatus('');
    try {
      await shareOrDownload(freshTemplateUrl(prefill), `honey-${prefill ? 'my-payments' : 'blank'}.xlsx`, XLSX);
    } catch (e) {
      setStatus(`Couldn’t download — ${(e as Error).message}`);
    }
  };

  const choose = async (file: File) => {
    setBusy(true);
    setPreview(null);
    setStatus(`Reading ${file.name}…`);
    try {
      const b64 = await fileToBase64(file);
      const p = await api.freshPreview(b64);
      setUpload({ name: file.name, data: b64 });
      setPreview(p);
      setStatus('');
    } catch (e) {
      setStatus((e as Error).message);
    }
    setBusy(false);
  };

  const replace = async () => {
    if (!upload || !preview?.plan) return;
    const p = preview.plan;
    if (!window.confirm(`Replace everything up to ${fmtDate(p.cutoff)} with your spreadsheet? ${p.removing.total} lines in Honey now make way for your ${p.count}. You can undo this afterwards.`)) return;
    setBusy(true);
    try {
      const res = await api.freshApply(upload.data, p.cutoff);
      setStatus(`Done — ${res.inserted} payments from your spreadsheet are in${res.streamsMade.length ? `, and new streams made: ${res.streamsMade.join(', ')}` : ''}. From ${fmtDate(addDays(res.cutoff, 1))} your bank feed carries on.`);
      setPreview(null);
      setUpload(null);
      await app.reload();
    } catch (e) {
      setStatus(`Nothing was changed — ${(e as Error).message}`);
    }
    setBusy(false);
  };

  const undo = async () => {
    if (!window.confirm('Undo starting fresh? Everything goes back to how it was before — your spreadsheet’s payments come out, the lines they replaced come back.')) return;
    setBusy(true);
    try {
      const res = await api.freshUndo();
      setStatus(`Undone — ${res.restored} lines back as they were.`);
      await app.reload();
    } catch (e) {
      setStatus((e as Error).message);
    }
    setBusy(false);
  };

  const p = preview?.plan;
  const skipped = preview?.read.problems.filter((x) => x.skipped) ?? [];
  const guessed = preview?.read.problems.filter((x) => !x.skipped) ?? [];

  return (
    <Section title="Start fresh from a spreadsheet">
      <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {fresh && (
          <div style={{ fontSize: 13, lineHeight: 1.5, background: T.green + '18', border: `1px solid ${T.green}55`, borderRadius: 10, padding: '10px 12px' }}>
            ✓ Your spreadsheet is the record up to <strong>{fmtDate(fresh.cutoff)}</strong>. From {fmtDate(addDays(fresh.cutoff, 1))} your bank feed, statements and CSTL fill in as usual.
            {fresh.canUndo && (
              <button type="button" onClick={undo} disabled={busy} style={{ display: 'block', marginTop: 6, background: 'none', border: 'none', padding: 0, color: T.textMuted, textDecoration: 'underline', fontSize: 12, cursor: 'pointer' }}>
                Undo starting fresh
              </button>
            )}
          </div>
        )}
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <strong>1 · Get your spreadsheet.</strong> It has every payment Honey has from your bank already in (the old app’s records left out), the columns to fill in in yellow,
          and a dropdown for every choice.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button tone="primary" onClick={() => download(true)} style={{ flex: 2 }}>Download my payments</Button>
          <Button tone="quiet" onClick={() => download(false)} style={{ flex: 1 }}>Blank</Button>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <strong>2 · Sort it on your laptop.</strong> Fill in the yellow columns, add Monzo and cash as new rows, and save it as Excel (.xlsx) or CSV. The first tab explains
          each column.
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <strong>3 · Bring it back.</strong> Honey shows you what it read before it changes anything.
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void choose(f); }} />
        <Button onClick={() => fileRef.current?.click()} disabled={busy}>{busy && !preview ? 'Reading…' : 'Choose my finished spreadsheet'}</Button>
        {status && <div style={{ fontSize: 13, lineHeight: 1.5, color: status.startsWith('Done') || status.startsWith('Undone') ? T.green : T.accentBright }}>{status}</div>}

        {preview && !p && (
          <div style={{ fontSize: 13, color: T.danger, lineHeight: 1.5 }}>
            Honey couldn’t find any payments in {upload?.name}. {preview.read.problems[0]?.message}
          </div>
        )}
        {p && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
            <Label>What Honey read from {upload?.name}</Label>
            <div style={{ fontSize: 14 }}>
              <strong>{p.count}</strong> payments, {fmtDate(p.from)} to {fmtDate(p.cutoff)}
            </div>
            {p.years.map((y) => (
              <div key={y.taxYear} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 13, background: T.surface, borderRadius: 10, padding: '8px 10px' }}>
                <span style={{ fontWeight: 700 }}>Tax year {taxYearLabel(y.taxYear)}</span>
                <span style={{ color: T.textMuted }}>{y.rows} payments</span>
                <span>Business income</span><Money pence={y.incomePence} size={13} color={T.green} />
                <span>Business costs</span><Money pence={y.costsPence} size={13} />
                <span>Profit</span><Money pence={y.incomePence - y.costsPence} size={13} />
                {y.toSort > 0 && <span style={{ gridColumn: '1 / -1', fontSize: 12, color: T.textMuted }}>{y.toSort} marked “Not sure yet” — you’ll swipe those in the app</span>}
              </div>
            ))}
            {p.newStreams.length > 0 && <div style={{ fontSize: 12, lineHeight: 1.5 }}>New streams it will make: <strong>{p.newStreams.join(', ')}</strong> (check the spelling).</div>}
            {skipped.length > 0 && (
              <div style={{ fontSize: 12, color: T.danger, lineHeight: 1.5 }}>
                <strong>{skipped.length} row{skipped.length === 1 ? '' : 's'} left out:</strong>
                {skipped.slice(0, 8).map((x) => <div key={x.line}>Row {x.line}: {x.message}</div>)}
                {skipped.length > 8 && <div>…and {skipped.length - 8} more.</div>}
              </div>
            )}
            {guessed.length > 0 && (
              <div style={{ fontSize: 12, color: T.accentBright, lineHeight: 1.5 }}>
                <strong>{guessed.length} brought in with a guess:</strong>
                {guessed.slice(0, 6).map((x) => <div key={x.line}>Row {x.line}: {x.message}</div>)}
                {guessed.length > 6 && <div>…and {guessed.length - 6} more.</div>}
              </div>
            )}
            {p.lookAlike.length > 0 && (
              <div style={{ fontSize: 12, color: T.accentBright, lineHeight: 1.5 }}>
                Rows {p.lookAlike.slice(0, 10).join(', ')}{p.lookAlike.length > 10 ? '…' : ''} look the same as another row (same day, amount and name). Fine if they really were two payments.
              </div>
            )}
            {p.future.length > 0 && <div style={{ fontSize: 12, color: T.accentBright }}>Rows {p.future.slice(0, 10).join(', ')} are dated in the future — check the dates.</div>}
            <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6 }}>
              Replacing takes out the {p.removing.total} lines Honey has now up to {fmtDate(p.cutoff)}
              {p.removing.oldApp ? ` (including all ${p.removing.oldApp} old app records)` : ''} and puts your {p.count} in their place. {p.keeping} line{p.keeping === 1 ? '' : 's'} after
              that stay. Your streams, rules, invoices and receipts stay. From {fmtDate(addDays(p.cutoff, 1))}, your bank feed carries on.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button tone="primary" onClick={replace} disabled={busy || !p.count} style={{ flex: 2 }}>{busy ? 'Replacing…' : 'Replace with my spreadsheet'}</Button>
              <Button tone="quiet" onClick={() => { setPreview(null); setUpload(null); }} disabled={busy} style={{ flex: 1 }}>Cancel</Button>
            </div>
          </div>
        )}
      </Card>
    </Section>
  );
}
