import type { CSSProperties, ReactNode } from 'react';
import type { Theme } from '../theme';

// Recreates the Tracks design's nested-ring figure: a stack of same-centred circles,
// alternating a conic-gradient "ring" with a solid cutout the size of that ring's inner edge,
// so each ring reads as a band rather than a filled disc. Diameters shrink by a fixed band
// (the ring's visible thickness) then a fixed gap (the separator before the next ring) — the
// exact geometry the design uses (250→218→205→173→160→128).

export interface RingSpec {
  /** Fraction of the ring's arc to fill, 0-100. */
  percent: number;
  color: string;
  track: string;
}

const BAND = 32; // diameter lost to a ring's own visible thickness
const GAP = 13; // diameter lost to the separator before the next ring

function conic(percent: number, color: string, track: string): string {
  const pct = Math.max(0, Math.min(100, percent));
  return `conic-gradient(from 180deg, ${color} 0 ${pct}%, ${track} ${pct}% 100%)`;
}

export function MoneyRings({
  size,
  rings,
  cutoutColor,
  center,
  centerGlass = true,
  T,
}: {
  size: number;
  rings: RingSpec[];
  /** The colour used to punch the gap between rings — normally the screen's own background. */
  cutoutColor: string;
  center: ReactNode;
  centerGlass?: boolean;
  T: Theme;
}) {
  let d = size;
  const layers: { size: number; style: CSSProperties }[] = [];

  rings.forEach((ring, i) => {
    layers.push({ size: d, style: { background: conic(ring.percent, ring.color, ring.track) } });
    d -= BAND;
    const isLast = i === rings.length - 1;
    if (!isLast) {
      layers.push({ size: d, style: { background: cutoutColor } });
      d -= GAP;
    }
  });

  const centerSize = d;
  layers.push({
    size: centerSize,
    style: centerGlass
      ? {
          background: T.glassStrong,
          border: `1px solid ${T.glassBorder}`,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }
      : { background: cutoutColor },
  });

  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {layers.map((l, i) => (
        <div
          key={i}
          style={{
            position: i === 0 ? 'static' : 'absolute',
            width: l.size,
            height: l.size,
            borderRadius: 999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: i === 0 ? T.shadowMd : undefined,
            ...l.style,
          }}
        >
          {i === layers.length - 1 ? center : null}
        </div>
      ))}
    </div>
  );
}
