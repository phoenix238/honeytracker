import { useRef, useState } from 'react';
import { parsePence, formatAmount } from '../../core/money';
import { repository } from '../../storage/repository';
import type { Income, Expense } from '../../core/types';
import { T, fonts } from '../theme';
import type { Store } from '../useStore';

const inputStyle: React.CSSProperties = {
  background: T.bg,
  border: `1px solid ${T.border}`,
  borderRadius: 9,
  padding: '9px 11px',
  color: T.text,
  fontSize: 14,
  fontFamily: fonts.body,
  width: '100%',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${T.border}` }}>
      <div style={{ flex: 1, fontSize: 13, color: T.textMuted }}>{label}</div>
      <div style={{ width: 160 }}>{children}</div>
    </div>
  );
}

export function MoreView({ store }: { store: Store }) {
  const { settings } = store;
  const [rate, setRate] = useState(formatAmount(settings.defaultRatePence));
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const exportBackup = () => {
    const payload = {
      app: 'honeytracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      income: store.income,
      expenses: store.expenses,
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
      <div style={{ fontFamily: fonts.display, fontSize: 22, fontWeight: 800, color: T.text }}>More</div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: '4px 16px 12px' }}>
        <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: T.textMuted, textTransform: 'uppercase', padding: '14px 0 4px' }}>Your profile</div>
        <Row label="Name">
          <input style={inputStyle} value={settings.name} onChange={(e) => store.updateSettings({ name: e.target.value })} />
        </Row>
        <Row label="Business">
          <input style={inputStyle} value={settings.business} onChange={(e) => store.updateSettings({ business: e.target.value })} />
        </Row>
        <Row label="Tax set-aside %">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              style={{ ...inputStyle, width: 80, fontFamily: fonts.mono }}
              type="number"
              min={0}
              max={100}
              value={settings.taxPercent}
              onChange={(e) => store.updateSettings({ taxPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            />
            <span style={{ fontSize: 13, color: T.textMuted }}>%</span>
          </div>
        </Row>
        <Row label="Default rate (£/hr)">
          <input
            style={{ ...inputStyle, fontFamily: fonts.mono }}
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            onBlur={() => store.updateSettings({ defaultRatePence: parsePence(rate) })}
          />
        </Row>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: T.textMuted, textTransform: 'uppercase' }}>Backup</div>
        <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
          Export your income, expenses and settings as a file. Receipt photos stay on this device.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportBackup} style={{ flex: 1, background: T.accent, color: T.bg, border: 'none', borderRadius: 9, padding: '10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: fonts.body }}>
            Export data
          </button>
          <button onClick={() => fileRef.current?.click()} style={{ flex: 1, background: 'transparent', color: T.text, border: `1px solid ${T.border}`, borderRadius: 9, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}>
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
