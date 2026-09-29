import { useRef, useState } from 'react';
import { T } from '../theme';
import { Button, Card, Chip, Field, Label, Section, inputStyle } from '../components';
import { api, exportEditUrl } from '../api';
import { shareOrDownload } from '../download';
import { parseCsv } from '../../core/csv';
import { isEditFile, planEditImport, type CsvPlan } from '../../core/csvRoundTrip';
import { detectStatement, parseStatement, type Statement } from '../../core/bankCsv';
import { taxYearLabel, taxYearOf } from '../../core/dates';
import { mkId } from '../../core/id';
import type { App } from '../useApp';

// The way in and out through a spreadsheet: download the ledger, change what rows are in Numbers,
// Excel or Google Sheets, and bring it back — every change shown before it's saved, and undoable.
// The same button reads bank statements for accounts Honey can't connect to, like Monzo.

type Preview = { kind: 'edit'; plan: CsvPlan; name: string } | { kind: 'statement'; st: Statement; name: string };

const PART = 500;

export function SpreadsheetSection({ app }: { app: App }) {
  const data = app.data!;
  const currentYear = taxYearOf(data.today);
  const [year, setYear] = useState<number | 'all'>(currentYear);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [account, setAccount] = useState('Monzo');
  const [status, setStatus] = useState<{ text: string; bad?: boolean; undo?: () => Promise<void> } | null>(null);
  const [working, setWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const download = async () => {
    setStatus(null);
    await shareOrDownload(exportEditUrl(year), 'honey-to-edit.csv', 'text/csv').catch((e: Error) =>
      setStatus({ text: `Couldn’t make the file — ${e.message}.`, bad: true }),
    );
  };

  const read = async (f: File) => {
    setStatus(null);
    const rows = parseCsv(await f.text());
    if (isEditFile(rows)) return setPreview({ kind: 'edit', plan: planEditImport(rows, data.transactions, data.streams), name: f.name });
    if (detectStatement(rows)) {
      const st = parseStatement(rows);
      setAccount(st.kind === 'monzo' ? 'Monzo' : readStored('ht:bankName') ?? 'Bank');
      return setPreview({ kind: 'statement', st, name: f.name });
    }
    setStatus({ text: `“${f.name}” isn’t a file downloaded from Honey, or a bank statement Honey can read (it needs date, amount and description columns).`, bad: true });
  };

  const applyEdits = async (plan: CsvPlan) => {
    const batchId = mkId();
    let updated = 0;
    let skipped = 0;
    setWorking(true);
    try {
      for (let i = 0; i < plan.changes.length; i += PART) {
        const res = await app.saveBatch({
          batchId,
          items: plan.changes.slice(i, i + PART).map((c) => ({ id: c.id, patch: c.patch, expectUpdatedAt: c.expectUpdatedAt })),
        });
        updated += res.updated.length;
        skipped += res.skipped.length;
      }
      setPreview(null);
      setStatus({
        text: `${updated} change${updated === 1 ? '' : 's'} saved from the spreadsheet${skipped ? ` · ${skipped} left as they were (changed in Honey meanwhile)` : ''}.`,
        undo: async () => {
          const r = await app.undoBatch(batchId);
          if (r) setStatus({ text: `Spreadsheet changes undone — ${r.undone} put back${r.kept ? `, ${r.kept} you’ve changed since kept` : ''}.` });
        },
      });
    } catch (e) {
      setStatus({ text: `Stopped after ${updated} — ${(e as Error).message} Undo what was saved, or bring the file in again.`, bad: true, undo: updated ? async () => void (await app.undoBatch(batchId)) : undefined });
    } finally {
      setWorking(false);
    }
  };

  const applyStatement = async (st: Statement) => {
    const importId = mkId();
    const name = account.trim() || 'Other bank';
    if (st.kind === 'bank') storeName(name);
    const total = { added: 0, sortedByRules: 0, potMoves: 0, already: 0, unreadable: 0 };
    setWorking(true);
    try {
      for (let i = 0; i < st.lines.length; i += PART) {
        const r = await api.importBank({ importId, account: name, kind: st.kind, lines: st.lines.slice(i, i + PART) });
        total.added += r.added;
        total.sortedByRules += r.sortedByRules;
        total.potMoves += r.potMoves;
        total.already += r.already;
        total.unreadable += r.unreadable;
      }
      await app.reload();
      setPreview(null);
      setStatus({
        text:
          `${total.added} line${total.added === 1 ? '' : 's'} added from ${name}` +
          (total.sortedByRules ? ` (${total.sortedByRules} sorted by your rules)` : '') +
          (total.already ? ` · ${total.already} were already here` : '') +
          (total.unreadable ? ` · ${total.unreadable} unreadable` : '') +
          (total.potMoves ? ` · ${total.potMoves} pot move${total.potMoves === 1 ? '' : 's'} marked as transfer${total.potMoves === 1 ? '' : 's'}` : '') +
          (total.added > total.sortedByRules + total.potMoves ? '. The rest are waiting in the sort pile.' : '.'),
        undo: total.added
          ? async () => {
              const r = await api.undoImport(importId).catch((e: Error) => {
                setStatus({ text: e.message, bad: true });
                return null;
              });
              if (!r) return;
              await app.reload();
              setStatus({ text: `Import taken back — ${r.removed} line${r.removed === 1 ? '' : 's'} removed${r.kept ? `, ${r.kept} you’d already sorted kept` : ''}.` });
            }
          : undefined,
      });
    } catch (e) {
      await app.reload();
      setStatus({ text: `Stopped after ${total.added} — ${(e as Error).message} Bringing the same file in again is safe: lines already here are skipped.`, bad: true });
    } finally {
      setWorking(false);
    }
  };

  const years = [...new Set(data.transactions.map((t) => taxYearOf(t.date)))].sort((a, b) => b - a);
  if (!years.includes(currentYear)) years.unshift(currentYear);

  return (
    <Section title="Spreadsheet & other banks">
      <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
          Download your transactions, change <strong>What is it?</strong> (income, cost, personal, transfer, to sort), <strong>Stream</strong>, <strong>Category</strong>,{' '}
          <strong>Work %</strong> or <strong>Note</strong> in Numbers, Excel or Google Sheets, save as CSV, and bring it back. You see every change before it’s saved, and can undo it.
          Leave the Honey ID, date and amount alone — they’re how each row finds its way home.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {years.slice(0, 3).map((y) => (
            <Chip key={y} active={year === y} onClick={() => setYear(y)}>{taxYearLabel(y)}</Chip>
          ))}
          <Chip active={year === 'all'} onClick={() => setYear('all')}>Everything</Chip>
        </div>
        <Button onClick={download}>⬇︎ Download to edit ({year === 'all' ? 'everything' : taxYearLabel(year)})</Button>
        <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.5 }}>
          For a tidy workbook to check and send to your accountant — with totals per HMRC box — use Tax → “Download workbook to check”. Its Transactions sheet, saved as CSV, can
          come back in here too.
        </div>
        <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f); }} />
        <Button tone="primary" disabled={working} onClick={() => fileRef.current?.click()}>⬆︎ Bring a spreadsheet or bank statement in</Button>
        <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.5 }}>
          Monzo and other accounts Honey can’t connect to: export a statement as CSV from the bank’s app or website and choose it here. Moves to and from Monzo pots come in as
          transfers; everything else lands in the sort pile. Bringing the same statement in twice never doubles anything.
        </div>

        {preview?.kind === 'edit' && (
          <Card style={{ background: T.bg, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label color={T.accent}>{preview.name}</Label>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <strong>{preview.plan.changes.length}</strong> change{preview.plan.changes.length === 1 ? '' : 's'} · {preview.plan.unchanged} unchanged
              {preview.plan.conflicts.length > 0 && <> · {preview.plan.conflicts.length} changed in Honey since you downloaded (left as Honey has them)</>}
              {preview.plan.problems.length > 0 && <> · <span style={{ color: T.danger }}>{preview.plan.problems.length} problem{preview.plan.problems.length === 1 ? '' : 's'}</span></>}
            </div>
            <List items={preview.plan.changes.map((c) => `Row ${c.row} · ${c.who}: ${c.summary.join(' · ')}`)} />
            {preview.plan.problems.length > 0 && <List bad items={preview.plan.problems.map((p) => `Row ${p.row}: ${p.message}`)} />}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button tone="primary" disabled={working || !preview.plan.changes.length} onClick={() => applyEdits(preview.plan)} style={{ flex: 1 }}>
                {working ? 'Saving…' : `Save ${preview.plan.changes.length} change${preview.plan.changes.length === 1 ? '' : 's'}`}
              </Button>
              <Button tone="quiet" onClick={() => setPreview(null)}>Cancel</Button>
            </div>
          </Card>
        )}

        {preview?.kind === 'statement' && (
          <Card style={{ background: T.bg, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label color={T.accent}>{preview.name}</Label>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <strong>{preview.st.lines.length}</strong> line{preview.st.lines.length === 1 ? '' : 's'}
              {preview.st.lines.length > 0 && <> from {preview.st.lines.reduce((m, l) => (l.date < m ? l.date : m), preview.st.lines[0]!.date)} to {preview.st.lines.reduce((m, l) => (l.date > m ? l.date : m), '')}</>}
              {preview.st.lines.some((l) => l.ownMove) && (() => {
                const n = preview.st.lines.filter((l) => l.ownMove).length;
                return <> · {n} pot move{n === 1 ? '' : 's'}, as transfer{n === 1 ? '' : 's'}</>;
              })()}
              {preview.st.problems.length > 0 && <> · <span style={{ color: T.danger }}>{preview.st.problems.length} left out</span></>}
            </div>
            {preview.st.problems.length > 0 && <List bad items={preview.st.problems.map((p) => `Row ${p.row}: ${p.message}`)} />}
            <Field label="Which account is this?" hint="It shows on each line, so you can tell your accounts apart — e.g. Monzo, Monzo Studio Rent.">
              <input style={inputStyle} value={account} onChange={(e) => setAccount(e.target.value)} />
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button tone="primary" disabled={working || !preview.st.lines.length} onClick={() => applyStatement(preview.st)} style={{ flex: 1 }}>
                {working ? 'Bringing in…' : `Bring in ${preview.st.lines.length} line${preview.st.lines.length === 1 ? '' : 's'}`}
              </Button>
              <Button tone="quiet" onClick={() => setPreview(null)}>Cancel</Button>
            </div>
          </Card>
        )}

        {status && (
          <div style={{ fontSize: 13, lineHeight: 1.5, background: T.bg, border: `1px solid ${status.bad ? T.danger : T.green}`, borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ flex: 1 }}>{status.text}</span>
            {status.undo && (
              <Button tone="quiet" disabled={working || app.busy} onClick={() => void status.undo!()} style={{ padding: '4px 6px', color: T.accentBright }}>
                Undo
              </Button>
            )}
          </div>
        )}
      </Card>
    </Section>
  );
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storeName(name: string) {
  try {
    localStorage.setItem('ht:bankName', name);
  } catch {
    /* only a convenience */
  }
}

function List({ items, bad }: { items: string[]; bad?: boolean }) {
  const shown = items.slice(0, 40);
  return (
    <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: 12, lineHeight: 1.6, color: bad ? T.danger : T.textMuted, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {shown.map((t, i) => <div key={i}>{t}</div>)}
      {items.length > shown.length && <div>…and {items.length - shown.length} more</div>}
    </div>
  );
}
