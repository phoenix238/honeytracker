import type { CSSProperties, ReactNode } from 'react';
import { T, fonts } from './theme';
import { formatGBP } from '../core/money';
import type { Bucket } from '../core/types';

// The handful of building blocks every screen is made from.

export const inputStyle: CSSProperties = {
  background: T.bg,
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: '10px 12px',
  color: T.text,
  fontSize: 15,
  fontFamily: fonts.body,
  width: '100%',
};

export function Card({ children, style, onClick }: { children: ReactNode; style?: CSSProperties; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, cursor: onClick ? 'pointer' : undefined, ...style }}
    >
      {children}
    </div>
  );
}

export function Label({ children, color = T.textMuted }: { children: ReactNode; color?: string }) {
  return (
    <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color, textTransform: 'uppercase' }}>{children}</div>
  );
}

export function Title({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <h1 style={{ fontFamily: fonts.display, fontSize: 26, fontWeight: 800, color: T.accent }}>{children}</h1>
      {right}
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label>{title}</Label>
        {right}
      </div>
      {children}
    </section>
  );
}

type Tone = 'primary' | 'plain' | 'danger' | 'green' | 'quiet';

export function Button({
  children,
  onClick,
  tone = 'plain',
  disabled,
  style,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: Tone;
  disabled?: boolean;
  style?: CSSProperties;
  type?: 'button' | 'submit';
}) {
  const tones: Record<Tone, CSSProperties> = {
    primary: { background: T.accent, color: T.bg, border: 'none' },
    green: { background: T.green, color: T.bg, border: 'none' },
    danger: { background: 'transparent', color: T.danger, border: `1px solid ${T.danger}` },
    plain: { background: T.surface, color: T.text, border: `1px solid ${T.border}` },
    quiet: { background: 'transparent', color: T.textMuted, border: 'none' },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        borderRadius: 10,
        padding: '11px 14px',
        fontSize: 14,
        fontWeight: 700,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: fonts.body,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Chip({ active, color = T.accent, onClick, children }: { active: boolean; color?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? color + '22' : 'transparent',
        border: `1px solid ${active ? color : T.border}`,
        color: active ? color : T.textMuted,
        borderRadius: 999,
        padding: '7px 12px',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: fonts.body,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

export function Money({ pence, color = T.text, size = 15, signed }: { pence: number; color?: string; size?: number; signed?: 'in' | 'out' }) {
  const prefix = signed === 'in' ? '+' : signed === 'out' ? '−' : '';
  return <span style={{ fontFamily: fonts.mono, fontSize: size, fontWeight: 700, color }}>{prefix}{formatGBP(pence)}</span>;
}

export function Stat({ label, pence, color, sub }: { label: string; pence: number; color: string; sub?: string }) {
  return (
    <Card>
      <Label>{label}</Label>
      <div style={{ marginTop: 6 }}>
        <Money pence={pence} color={color} size={22} />
      </div>
      {sub && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3, lineHeight: 1.4 }}>{sub}</div>}
    </Card>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
        style={{
          background: T.bg,
          border: `1px solid ${T.border}`,
          borderRadius: '18px 18px 0 0',
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '18px 18px calc(24px + env(safe-area-inset-bottom, 0px))',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: fonts.display, fontSize: 20, fontWeight: 800, color: T.text }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 24, cursor: 'pointer' }}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: T.textMuted, fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.4 }}>{hint}</span>}
    </label>
  );
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  unreviewed: 'To review',
  business_income: 'Business income',
  business_expense: 'Business cost',
  personal: 'Personal',
  transfer: 'Transfer',
};

export const BUCKET_COLOR: Record<Bucket, string> = {
  unreviewed: T.accentBright,
  business_income: T.green,
  business_expense: T.expense,
  personal: T.textMuted,
  transfer: T.blue,
};

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 14, color: T.textFaint, textAlign: 'center', padding: '28px 8px', lineHeight: 1.6 }}>{children}</div>;
}

export function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
