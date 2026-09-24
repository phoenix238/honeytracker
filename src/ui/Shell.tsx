import { useState, type ReactNode } from 'react';
import { T, fonts } from './theme';
import { HomeIcon, InboxIcon, ReceiptIcon, PotIcon, GearIcon } from './icons';
import { HomeView } from './views/HomeView';
import { InboxView } from './views/InboxView';
import { ReceiptsView } from './views/ReceiptsView';
import { TaxView } from './views/TaxView';
import { SettingsView } from './views/SettingsView';
import type { App } from './useApp';

export type View = 'home' | 'inbox' | 'receipts' | 'tax' | 'settings';

const TABS: { id: View; label: string; icon: (p: { size?: number; color?: string }) => ReactNode }[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'inbox', label: 'Money', icon: InboxIcon },
  { id: 'receipts', label: 'Receipts', icon: ReceiptIcon },
  { id: 'tax', label: 'Tax', icon: PotIcon },
  { id: 'settings', label: 'Settings', icon: GearIcon },
];

export function Shell({ app }: { app: App }) {
  const [view, setView] = useState<View>('home');
  const badge = app.picture?.review.unreviewed ?? 0;

  return (
    <div style={{ minHeight: '100vh', background: T.bg }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px 110px' }}>
        {(app.error || app.notice) && (
          <div
            role="status"
            style={{
              position: 'sticky',
              top: 8,
              zIndex: 150,
              background: app.error ? '#2a1512' : '#14231a',
              border: `1px solid ${app.error ? T.danger : T.green}`,
              borderRadius: 12,
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 16,
            }}
          >
            <div style={{ flex: 1, fontSize: 13, color: T.text, lineHeight: 1.5 }}>
              {app.error ? <strong style={{ color: T.danger }}>Not done. </strong> : null}
              {app.error || app.notice}
            </div>
            <button onClick={app.clearMessages} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 18, cursor: 'pointer' }}>×</button>
          </div>
        )}

        {view === 'home' && <HomeView app={app} go={setView} />}
        {view === 'inbox' && <InboxView app={app} />}
        {view === 'receipts' && <ReceiptsView app={app} />}
        {view === 'tax' && <TaxView app={app} />}
        {view === 'settings' && <SettingsView app={app} />}
      </div>

      <nav style={{ position: 'fixed', bottom: 0, left: 0, width: '100%', background: T.surface, borderTop: `1px solid ${T.border}`, display: 'grid', gridTemplateColumns: `repeat(${TABS.length}, 1fr)`, paddingBottom: 'env(safe-area-inset-bottom, 0px)', zIndex: 100 }}>
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = view === id;
          return (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 4px 12px', fontFamily: fonts.body }}
            >
              <Icon size={22} color={active ? T.accent : T.textMuted} />
              <span style={{ fontSize: 10, fontWeight: active ? 700 : 600, color: active ? T.accent : T.textMuted }}>{label}</span>
              {id === 'inbox' && badge > 0 && (
                <span style={{ position: 'absolute', top: 6, left: '55%', background: T.accentBright, color: T.bg, borderRadius: 999, fontSize: 10, fontWeight: 800, padding: '1px 6px' }}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
