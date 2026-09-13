// Organic design tokens, carried over from the Tracks design (Honey Home.dc.html / 4a-4d,
// 5a-5b, 6a-6b). Tonal ramps are mode-independent — light and dark pick different ROLES from
// the same ramps (background/text/glass), not different hues, so accent/sage stay recognisable
// in both.

export type ThemeMode = 'light' | 'dark';

export const ramp = {
  neutral: {
    100: '#f9f4ed', 200: '#eee7db', 300: '#dcd3c4', 400: '#c0b6a5', 500: '#a19786',
    600: '#82796a', 700: '#645c50', 800: '#474238', 900: '#2e2b25',
  },
  accent: {
    100: '#fff2eb', 200: '#ffe1d0', 300: '#ffc6a5', 400: '#f6a06b', 500: '#d67f48',
    600: '#b2622d', 700: '#8c491a', 800: '#643312', 900: '#402310',
  },
  accent2: {
    100: '#f0fae1', 200: '#e1eecc', 300: '#ccdbb2', 400: '#aebf92', 500: '#8fa073',
    600: '#728157', 700: '#56633f', 800: '#3d472b', 900: '#272e1b',
  },
} as const;

export const fonts = {
  display: "'Caprasimo', Georgia, serif",
  body: "'Figtree', system-ui, sans-serif",
} as const;

export interface Theme {
  mode: ThemeMode;
  bg: string;
  surface: string;
  surfaceBorder: string;
  glass: string;
  glassStrong: string;
  glassBorder: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  /** Solid brand accent — primary buttons, dock, headings. */
  accent: string;
  accentOn: string;
  accent2: string;
  danger: string;
  ramp: typeof ramp;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
}

const light: Theme = {
  mode: 'light',
  bg: '#f5ead8',
  surface: '#ebddc5',
  surfaceBorder: 'rgba(32,30,29,0.12)',
  glass: 'rgba(255,252,245,0.72)',
  glassStrong: 'rgba(255,252,245,0.85)',
  glassBorder: 'rgba(255,255,255,0.85)',
  border: 'rgba(32,30,29,0.12)',
  text: '#201e1d',
  textMuted: '#645c50',
  textFaint: '#82796a',
  accent: '#c67139',
  accentOn: '#f5ead8',
  accent2: '#7a8a5e',
  danger: '#b8392f',
  ramp,
  shadowSm: '0 1px 2px rgba(46,43,37,0.14)',
  shadowMd: '0 3px 10px rgba(46,43,37,0.16)',
  shadowLg: '0 12px 32px rgba(46,43,37,0.22)',
};

const dark: Theme = {
  mode: 'dark',
  bg: '#1c1815',
  surface: 'rgba(255,255,255,0.05)',
  surfaceBorder: 'rgba(255,255,255,0.1)',
  glass: 'rgba(255,255,255,0.07)',
  glassStrong: 'rgba(255,255,255,0.1)',
  glassBorder: 'rgba(255,255,255,0.14)',
  border: 'rgba(255,255,255,0.1)',
  text: '#f9f4ed',
  textMuted: '#c0b6a5',
  textFaint: '#82796a',
  accent: '#e0925a',
  accentOn: '#241f1b',
  accent2: '#9db084',
  danger: '#e2695c',
  ramp,
  shadowSm: '0 1px 2px rgba(0,0,0,0.3)',
  shadowMd: '0 3px 12px rgba(0,0,0,0.35)',
  shadowLg: '0 16px 40px rgba(0,0,0,0.45)',
};

export function getTheme(mode: ThemeMode): Theme {
  return mode === 'dark' ? dark : light;
}

/** The soft radial highlight each screen sits on, tinted by whichever figure it's about. */
export function pageBackground(T: Theme, tint: 'accent' | 'accent2' = 'accent'): string {
  const hi = T.mode === 'dark'
    ? (tint === 'accent' ? 'rgba(198,113,57,0.28)' : 'rgba(122,138,94,0.3)')
    : (tint === 'accent' ? T.ramp.accent[100] : T.ramp.accent2[100]);
  return `radial-gradient(100% 40% at 50% 0%, ${hi} 0%, ${T.bg} 60%), ${T.bg}`;
}
