import type { ReactNode } from 'react';
import { fonts, type Theme } from '../theme';

type Variant = 'solid' | 'glass' | 'outline';

export function PillButton({
  T,
  onClick,
  variant = 'solid',
  height = 56,
  fontSize = 16,
  disabled = false,
  children,
}: {
  T: Theme;
  onClick?: () => void;
  variant?: Variant;
  height?: number;
  fontSize?: number;
  disabled?: boolean;
  children: ReactNode;
}) {
  const base = {
    solid: { background: T.accent, color: T.accentOn, border: 'none', boxShadow: T.shadowMd },
    glass: { background: T.glass, color: T.text, border: `1px solid ${T.glassBorder}`, backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' },
    outline: { background: 'transparent', color: T.text, border: `1px solid ${T.border}` },
  }[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height,
        width: '100%',
        borderRadius: 999,
        fontFamily: fonts.display,
        fontSize,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...base,
      }}
    >
      {children}
    </button>
  );
}
