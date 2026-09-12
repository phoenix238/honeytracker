import { T, fonts } from '../theme';

export function Tile({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: T.textMuted, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: fonts.mono, fontSize: 24, fontWeight: 700, color, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
