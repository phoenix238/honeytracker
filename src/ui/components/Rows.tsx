import { fonts, type Theme } from '../theme';

/** Dot + label + value — the ring legend under Home's and Tax stash's rings. */
export function LegendRow({ T, dot, label, value }: { T: Theme; dot: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 12, height: 12, borderRadius: 999, background: dot, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13, color: T.textMuted }}>{label}</span>
      <span style={{ fontFamily: fonts.display, fontSize: 16, color: T.text }}>{value}</span>
    </div>
  );
}

/** Avatar + title/subtitle + amount — an activity feed / "held back from" line. */
export function ActivityRow({
  T,
  avatar,
  title,
  subtitle,
  amount,
  amountColor,
}: {
  T: Theme;
  avatar: React.ReactNode;
  title: string;
  subtitle: string;
  amount: string;
  amountColor?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 8px 8px', borderRadius: 999, background: T.surface, border: `1px solid ${T.surfaceBorder}` }}>
      {avatar}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div style={{ fontSize: 11, color: T.textMuted }}>{subtitle}</div>
      </div>
      <span style={{ fontFamily: fonts.display, fontSize: 16, color: amountColor ?? T.text, flexShrink: 0 }}>{amount}</span>
    </div>
  );
}
