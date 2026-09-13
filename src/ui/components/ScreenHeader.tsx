import type { ReactNode } from 'react';
import { fonts, type Theme } from '../theme';
import { ChevronLeftIcon } from '../icons';

/** The back-chevron + title row every Tracks sub-screen opens with. */
export function ScreenHeader({ T, title, onBack, right }: { T: Theme; title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        onClick={onBack}
        aria-label="Back"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: 999,
          background: T.glass,
          border: `1px solid ${T.glassBorder}`,
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          color: T.text,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <ChevronLeftIcon size={18} color={T.text} />
      </button>
      <div style={{ fontFamily: fonts.display, fontSize: 22, color: T.text }}>{title}</div>
      {right && <div style={{ marginLeft: 'auto' }}>{right}</div>}
    </div>
  );
}
