import { useState, type ReactNode } from 'react';
import { fonts, getTheme } from './theme';
import { HomeIcon, MoneyIcon, DocsIcon, MoreIcon } from './icons';
import { HomeView } from './views/HomeView';
import { MoneyView } from './views/MoneyView';
import { DocsView } from './views/DocsView';
import { MoreView } from './views/MoreView';
import { LogWorkView } from './views/LogWorkView';
import { InvoiceView } from './views/InvoiceView';
import { ReceiptView } from './views/ReceiptView';
import { PaidInView } from './views/PaidInView';
import { TaxStashView } from './views/TaxStashView';
import type { Store } from './useStore';

type Tab = 'home' | 'money' | 'docs' | 'more';
type SubView = 'logwork' | 'invoice' | 'receipt' | 'paidin' | 'taxstash' | null;

const TABS: { id: Tab; label: string; icon: (p: { size?: number; color?: string }) => ReactNode }[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'money', label: 'Money', icon: MoneyIcon },
  { id: 'docs', label: 'Docs', icon: DocsIcon },
  { id: 'more', label: 'More', icon: MoreIcon },
];

export function Shell({ store }: { store: Store }) {
  const [tab, setTab] = useState<Tab>('home');
  const [subView, setSubView] = useState<SubView>(null);
  const T = getTheme(store.settings.theme);
  const closeSub = () => setSubView(null);

  return (
    <div style={{ minHeight: '100vh', background: T.bg, fontFamily: fonts.body, color: T.text }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 18px 96px' }}>
        {store.error && (
          <div style={{ background: T.danger + '1f', border: `1px solid ${T.danger}`, borderRadius: 16, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1, fontSize: 13, color: T.text, lineHeight: 1.5 }}>
              <strong style={{ color: T.danger }}>Not saved.</strong> {store.error}
            </div>
            <button onClick={store.clearError} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 18, fontWeight: 700, cursor: 'pointer', padding: '0 4px' }}>×</button>
          </div>
        )}

        {subView === 'logwork' && <LogWorkView store={store} T={T} onDone={closeSub} />}
        {subView === 'invoice' && <InvoiceView store={store} T={T} onDone={closeSub} />}
        {subView === 'receipt' && <ReceiptView store={store} T={T} onDone={closeSub} />}
        {subView === 'paidin' && <PaidInView store={store} T={T} onDone={closeSub} />}
        {subView === 'taxstash' && <TaxStashView store={store} T={T} onDone={closeSub} />}

        {subView === null && (
          <>
            {tab === 'home' && (
              <HomeView
                store={store}
                T={T}
                onSeeAll={() => setTab('money')}
                onOpenLogWork={() => setSubView('logwork')}
                onOpenInvoice={() => setSubView('invoice')}
                onOpenReceipt={() => setSubView('receipt')}
                onOpenPaidIn={() => setSubView('paidin')}
                onOpenTaxStash={() => setSubView('taxstash')}
              />
            )}
            {tab === 'money' && <MoneyView store={store} T={T} />}
            {tab === 'docs' && <DocsView store={store} T={T} />}
            {tab === 'more' && <MoreView store={store} T={T} />}
          </>
        )}
      </div>

      {subView === null && (
        <nav style={{ position: 'fixed', bottom: 0, left: 0, width: '100%', background: T.surface, borderTop: `1px solid ${T.border}`, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', paddingBottom: 'env(safe-area-inset-bottom, 0px)', zIndex: 100 }}>
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 4px 12px', fontFamily: fonts.body }}
              >
                <Icon size={22} color={active ? T.accent : T.textMuted} />
                <span style={{ fontSize: 10, fontWeight: active ? 700 : 600, color: active ? T.accent : T.textMuted }}>{label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
