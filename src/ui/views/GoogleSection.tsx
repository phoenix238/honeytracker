import { useState } from 'react';
import { T } from '../theme';
import { Button, Card, Label, Section, fmtDate } from '../components';
import { api } from '../api';
import { googleScript } from '../googleScript';
import type { App } from '../useApp';

// Connects Gmail and Google Drive through a small script that runs in the person's own Google
// account and sends Honey only what looks like a receipt.

export function GoogleSection({ app }: { app: App }) {
  const data = app.data!;
  const g = data.google;
  const [script, setScript] = useState('');
  const [copied, setCopied] = useState(false);

  const connect = async () => {
    if (g.connected && !window.confirm('This makes a new script key — the script already in Google stops working until you paste the new one. Carry on?')) return;
    const res = await api.googleConnect().catch((e: Error) => { app.notify(e.message); return null; });
    if (!res) return;
    setScript(googleScript(window.location.origin, res.token, res.since));
    setCopied(false);
    await app.reload();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
    } catch {
      app.notify('Couldn’t copy — press and hold in the box, Select all, then Copy.');
    }
  };

  return (
    <Section title="Gmail & Google Drive">
      <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
          Finds receipts, invoices and order confirmations in your Gmail (including your Money and Honey labels) and in Drive folders like Money, Honey or Receipts.
          Honey keeps only purchases and attaches each to its bank line; the AI sort reads them, and you check. It runs in your own Google account, so Honey never holds a key to your inbox.
        </div>
        {!data.config.receiptsAi && <div style={{ fontSize: 12, color: T.danger }}>Needs ANTHROPIC_API_KEY set first, so Honey can read what it finds.</div>}

        {g.connected && !script && (
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {g.lastAt ? (
              <>
                Looked at {g.checked} emails and files · kept {g.found} receipts · {g.matched} attached to bank lines.
                <div style={{ fontSize: 12, color: T.textMuted }}>Last heard from {fmtDate(g.lastAt.slice(0, 10))} — it checks every hour.</div>
              </>
            ) : (
              <span style={{ color: T.accent }}>Key made — waiting for the script’s first run. Did you run “setup” in Google?</span>
            )}
          </div>
        )}

        {script ? (
          <>
            <Label>Set up (5 minutes, easiest on a computer)</Label>
            <ol style={{ fontSize: 13, lineHeight: 1.6, margin: 0, paddingLeft: 18 }}>
              <li>Tap <b>Copy the script</b> below.</li>
              <li>Open <a href="https://script.new" target="_blank" rel="noreferrer" style={{ color: T.blue }}>script.new</a> (signed in to the Google account with your receipts). A new project opens.</li>
              <li>Delete what’s in the editor, paste, and press <b>Save</b> (💾). Name it “Honey receipts”.</li>
              <li>In the bar at the top, choose <b>setup</b> from the function list and press <b>Run</b>.</li>
              <li>Google asks for permission: <b>Review permissions</b> → your account → it says “Google hasn’t verified this app” (it’s your own script) → <b>Advanced</b> → <b>Go to Honey receipts</b> → <b>Allow</b>.</li>
              <li>Done. It runs every hour and works through your backlog a few hundred at a time; the first pass can take a few hours.</li>
            </ol>
            <Button tone="primary" onClick={copy}>{copied ? '✓ Copied — now paste it into script.new' : 'Copy the script'}</Button>
            <textarea readOnly value={script} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%', height: 120, fontFamily: 'monospace', fontSize: 10, background: T.bg, color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: 8, padding: 8 }} />
            <div style={{ fontSize: 11, color: T.textFaint }}>The script holds a key to Honey. Don’t share it; if you think it’s leaked, tap “New key” and paste the new script.</div>
            <Button tone="quiet" onClick={() => setScript('')}>Done</Button>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button tone={g.connected ? 'plain' : 'primary'} disabled={app.busy || !data.config.receiptsAi} onClick={connect}>
              {g.connected ? 'New key / show setup again' : 'Connect Gmail & Drive'}
            </Button>
            {g.connected && (
              <Button
                tone="quiet"
                onClick={async () => {
                  if (!window.confirm('Disconnect? The script in Google stops being able to send anything. Receipts it already found stay.')) return;
                  await api.googleDisconnect().catch(() => undefined);
                  await app.reload();
                }}
              >
                Disconnect
              </Button>
            )}
          </div>
        )}
      </Card>
    </Section>
  );
}
