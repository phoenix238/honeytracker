import type { CSSProperties, ReactNode } from 'react';
import type { Theme } from '../theme';

/** A frosted, translucent surface — the Tracks design's default for rows, fields and cards. */
export function Glass({
  T,
  pill = false,
  strong = false,
  style,
  children,
}: {
  T: Theme;
  pill?: boolean;
  strong?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: strong ? T.glassStrong : T.glass,
        border: `1px solid ${T.glassBorder}`,
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderRadius: pill ? 999 : 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
