import type { ReactNode } from 'react';
import { fonts, type Theme } from '../theme';
import { Glass } from './Glass';

/** A labelled glass pill row — static content on the right (design's Merchant/Date/When rows). */
export function FieldRow({ T, label, labelWidth = 78, children }: { T: Theme; label: string; labelWidth?: number; children: ReactNode }) {
  return (
    <Glass T={T} pill style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px' }}>
      <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textMuted, width: labelWidth, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </Glass>
  );
}

/** Same shape, but the content is an editable text/number input. */
export function TextFieldPill({
  T,
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  labelWidth = 78,
}: {
  T: Theme;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'decimal' | 'numeric';
  labelWidth?: number;
}) {
  return (
    <FieldRow T={T} label={label} labelWidth={labelWidth}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          outline: 'none',
          font: 'inherit',
          fontFamily: fonts.body,
          fontWeight: 700,
          fontSize: 15,
          color: T.text,
        }}
      />
    </FieldRow>
  );
}
