import { T, fonts } from '../theme';
import { DocsIcon } from '../icons';

// Documents (invoices and payment receipts) are generated on demand from income records —
// none exist until you make one, and generation itself is the next stage. This is an honest
// empty state, not a placeholder with fake rows.
export function DocsView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontFamily: fonts.display, fontSize: 22, fontWeight: 800, color: T.text }}>Documents</div>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: '28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: T.accent + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <DocsIcon size={22} color={T.accent} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>No documents yet</div>
        <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5, maxWidth: 320 }}>
          Invoices (“please pay me”) and payment receipts (“thanks, paid”) will live here. They’re
          optional — your income counts on its own without them. You’ll generate one from a Money
          entry when a client needs it.
        </div>
      </div>
    </div>
  );
}
