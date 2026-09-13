import { fonts, type Theme } from '../theme';
import { DocsIcon } from '../icons';
import { formatGBP } from '../../core/money';
import { invoiceTotalPence } from '../../core/invoice';
import type { Store } from '../useStore';

// Invoices are generated on demand from a Money entry when a client needs one — none exist
// until you make one via the Home screen's Invoice action. This view just lists what's live.
export function DocsView({ store, T }: { store: Store; T: Theme }) {
  if (store.invoices.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontFamily: fonts.display, fontSize: 22, color: T.text }}>Documents</div>
        <div style={{ background: T.surface, border: `1px solid ${T.surfaceBorder}`, borderRadius: 20, padding: '28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, borderRadius: 999, background: T.accent + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <DocsIcon size={22} color={T.accent} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>No documents yet</div>
          <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5, maxWidth: 320 }}>
            Invoices ("please pay me") will live here. They're optional — your income counts on
            its own without them. Send one from Home's <strong>Invoice</strong> action.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontFamily: fonts.display, fontSize: 22, color: T.text }}>Documents</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {store.invoices.map((inv) => (
          <div key={inv.id} style={{ background: T.surface, border: `1px solid ${T.surfaceBorder}`, borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{inv.client}</div>
              <div style={{ fontSize: 11, color: T.textMuted }}>
                {inv.number} · {inv.status} · due {inv.dueDate}
              </div>
            </div>
            <span style={{ fontFamily: fonts.display, fontSize: 15, color: T.text }}>{formatGBP(invoiceTotalPence(inv))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
