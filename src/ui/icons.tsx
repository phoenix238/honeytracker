// Inline stroke SVG icons on a 24px grid, so they scale and recolour cleanly.
interface IconProps {
  size?: number;
  color?: string;
}

const base = (size: number, color: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function HomeIcon({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <svg {...base(size, color)}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

export function MoneyIcon({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <svg {...base(size, color)}>
      <path d="M2 10h20" />
      <rect x="2" y="5" width="20" height="14" rx="2" />
    </svg>
  );
}

export function DocsIcon({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <svg {...base(size, color)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8M16 17H8" />
    </svg>
  );
}

export function MoreIcon({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <svg {...base(size, color)}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

export function InIcon({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <svg {...base(size, color)}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export function OutIcon({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <svg {...base(size, color)}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  );
}
