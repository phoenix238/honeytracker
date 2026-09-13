import { useRef, useState } from 'react';
import { parsePence, formatAmount, formatGBP } from '../../core/money';
import { mkId } from '../../core/id';
import { repository } from '../../storage/repository';
import type { Income, Expense, Invoice, Client } from '../../core/types';
import { fonts, type Theme } from '../theme';
import { Avatar } from '../components/Avatar';
import { beginGoogleAuth } from '../useGoogleOAuthCallback';
import type { Store } from '../useStore';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
      <div style={{ flex: 1, fontSize: 13, color: 'inherit', opacity: 0.7 }}>{label}</div>
      <div style={{ width: 160 }}>{children}</div>
    </div>
  );
}

export function MoreView({ store, T, googleAuthStatus }: { store: Store; T: Theme; googleAuthStatus: 'idle' | 'connecting' | 'error' }) {
  const { settings } = store;
  const [rate, setRate] = useState(formatAmount(settings.defaultRatePence));
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [gmailMsg, setGmailMsg] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientRate, setNewClientRate] = useState('');

  const inputStyle: React.CSSProperties = {
    background: T.bg,
    border: `1px solid ${T.border}`,
    borderRadius: 999,
    padding: '8px 12px',
    color: T.text,
    fontSize: 14,
    fontFamily: fonts.body,
    width: '100%',
  };

  const exportBackup = () => {
    const payload = {
      app: 'honeytracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      income: store.income,
      expenses: store.expenses,
      invoices: store.invoices,
      clients: store.clients,
      settings: store.settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `honeytracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };

  const importBackup = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data.income) || !Array.isArray(data.expenses)) throw new Error('bad file');
        if (!window.confirm('Restore this backup? It adds its income and expenses to what you already have.')) return;
        for (const i of data.income as Income[]) await repository.saveIncome(i);
        for (const e of data.expenses as Expense[]) await repository.saveExpense(e);
        for (const inv of (data.invoices ?? []) as Invoice[]) await repository.saveInvoice(inv);
        for (const c of (data.clients ?? []) as Client[]) await repository.saveClient(c);
        if (data.settings) await repository.saveSettings(data.settings);
        window.location.reload();
      } catch {
        setMsg('That file is not a valid Honey Tracker backup.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontFamily: fonts.display, fontSize: 22, color: T.text }}>More</div>

      <div style={{ background: T.surface, border: `1px solid ${T.surfaceBorder}`, borderRadius: 20, padding: '4px 16px 12px', color: T.text }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: T.textMuted, textTransform: 'uppercase', padding: '14px 0 4px' }}>Appearance</div>
        <Row label="Theme">
          <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 999, background: T.bg }}>
            {(['light', 'dark'] as const).map((m) => (
              <span
                key={m}
                onClick={() => store.updateSettings({ theme: m })}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '6px 0',
                  borderRadius: 999,
                  background: settings.theme === m ? T.accent : 'transparent',
                  color: settings.theme === m ? T.accentOn : T.textMuted,
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'capitalize',
                  cursor: 'pointer',
                }}
              >
                {m}
              </span>
            ))}
          </div>
        </Row>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.surfaceBorder}`, borderRadius: 20, padding: '4px 16px 12px', color: T.text }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: T.textMuted, textTransform: 'uppercase', padding: '14px 0 4px' }}>Your profile</div>
        <Row label="Name">
          <input style={inputStyle} value={settings.name} onChange={(e) => store.updateSettings({ name: e.target.value })} />
        </Row>
        <Row label="Business">
          <input style={inputStyle} value={settings.business} onChange={(e) => store.updateSettings({ business: e.target.value })} />
        </Row>
        <Row label="Tax set-aside %">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              style={{ ...inputStyle, width: 80, fontFamily: fonts.display }}
              type="number"
              min={0}
              max={100}
              value={settings.taxPercent}
              onChange={(e) => store.updateSettings({ taxPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            />
            <span style={{ fontSize: 13, color: T.textMuted }}>%</span>
          </div>
        </Row>
        <Row label="Default rate (£/day)">
          <input
            style={{ ...inputStyle, fontFamily: fonts.display }}
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            onBlur={() => store.updateSettings({ defaultRatePence: parsePence(rate) })}
          />
        </Row>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.surfaceBorder}`, borderRadius: 20, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, color: T.text }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: T.textMuted, textTransform: 'uppercase' }}>Clients</div>
        {store.clients.length === 0 ? (
          <div style={{ fontSize: 12, color: T.textMuted }}>No saved clients yet — add one here, or the first time you pick "New client" on an invoice or log-work entry.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {store.clients.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 14, background: T.bg }}>
                <Avatar label={c.name} size={30} bg={T.ramp.accent[T.mode === 'dark' ? 600 : 300]} color={T.mode === 'dark' ? T.ramp.accent[100] : T.ramp.accent[900]} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: T.textMuted }}>
                    {c.email ? c.email + ' · ' : ''}{c.defaultRatePence ? `${formatGBP(c.defaultRatePence)} usual rate` : 'no usual rate'}
                  </div>
                </div>
                <button onClick={() => store.removeClient(c.id)} aria-label={`Remove ${c.name}`} style={{ background: 'none', border: 'none', color: T.textFaint, cursor: 'pointer', fontSize: 16, padding: 4 }}>×</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={inputStyle} value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="Name" />
          <input style={inputStyle} value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} placeholder="Email (optional)" />
          <button
            onClick={() => {
              if (!newClientName.trim()) return;
              store.addClient({
                id: mkId(),
                name: newClientName.trim(),
                email: newClientEmail.trim() || undefined,
                defaultRatePence: newClientRate ? parsePence(newClientRate) : undefined,
                createdAt: new Date().toISOString(),
              });
              setNewClientName('');
              setNewClientEmail('');
              setNewClientRate('');
            }}
            disabled={!newClientName.trim()}
            style={{ flexShrink: 0, background: T.accent, color: T.accentOn, border: 'none', borderRadius: 999, padding: '0 16px', fontSize: 13, fontWeight: 700, cursor: newClientName.trim() ? 'pointer' : 'not-allowed', opacity: newClientName.trim() ? 1 : 0.5, fontFamily: fonts.display }}
          >
            Add
          </button>
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.surfaceBorder}`, borderRadius: 20, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, color: T.text }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: T.textMuted, textTransform: 'uppercase' }}>Integrations</div>
        {store.googleAuth ? (
          <>
            <div style={{ fontSize: 12, color: T.textMuted }}>
              Connected to Gmail{store.googleAuth.email ? ` as ${store.googleAuth.email}` : ''}.
            </div>
            <button
              onClick={() => store.disconnectGoogle()}
              style={{ background: 'transparent', color: T.danger, border: `1px solid ${T.danger}`, borderRadius: 999, padding: '10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: fonts.body }}
            >
              Disconnect Gmail
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
              Connect Gmail to import expenses from receipt and invoice emails, from the Receipt screen.
            </div>
            <button
              onClick={() => {
                const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
                if (!clientId) {
                  setGmailMsg('Gmail import is not configured on this deployment yet (missing VITE_GOOGLE_CLIENT_ID).');
                  return;
                }
                beginGoogleAuth(clientId);
              }}
              style={{ background: T.accent, color: T.accentOn, border: 'none', borderRadius: 999, padding: '10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: fonts.display }}
            >
              Connect Gmail
            </button>
          </>
        )}
        {googleAuthStatus === 'connecting' && <div style={{ fontSize: 12, color: T.textMuted }}>Finishing Gmail sign-in…</div>}
        {googleAuthStatus === 'error' && <div style={{ fontSize: 12, color: T.danger }}>Gmail sign-in didn't complete — try again.</div>}
        {gmailMsg && <div style={{ fontSize: 12, color: T.danger }}>{gmailMsg}</div>}
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.surfaceBorder}`, borderRadius: 20, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, color: T.text }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: T.textMuted, textTransform: 'uppercase' }}>Backup</div>
        <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
          Export your income, expenses, invoices and settings as a file. Receipt photos stay on this device.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportBackup} style={{ flex: 1, background: T.accent, color: T.accentOn, border: 'none', borderRadius: 999, padding: '10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: fonts.display }}>
            Export data
          </button>
          <button onClick={() => fileRef.current?.click()} style={{ flex: 1, background: 'transparent', color: T.text, border: `1px solid ${T.border}`, borderRadius: 999, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}>
            Import data
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importBackup(f);
            e.target.value = '';
          }}
        />
        {msg && <div style={{ fontSize: 12, color: T.danger }}>{msg}</div>}
      </div>

      <div style={{ fontSize: 11, color: T.textFaint, textAlign: 'center', lineHeight: 1.5 }}>
        Honey Tracker · your data lives on this device
      </div>
    </div>
  );
}
