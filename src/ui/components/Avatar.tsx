import { fonts } from '../theme';

/** Initials bubble used for clients and the user's own profile chip. */
export function Avatar({ label, size = 40, bg, color }: { label: string; size?: number; bg: string; color: string }) {
  const initials = label
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 999,
        background: bg,
        color,
        fontFamily: fonts.display,
        fontSize: size * 0.34,
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  );
}
