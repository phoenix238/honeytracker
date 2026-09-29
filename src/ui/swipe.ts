import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

// Swiping a card left or right. The maths is kept pure (and tested) apart from the React wiring,
// because the fiddly part on an iPhone is telling a sideways swipe from a scroll up the page.

/** Movement before we decide whether the finger is swiping or scrolling. */
export const AXIS_LOCK_PX = 10;
/** A drag this far across the card (as a share of its width) counts as a swipe… */
export const SWIPE_SHARE = 0.35;
/** …and so does a quick flick, in px per ms. */
export const FLICK_SPEED = 0.5;
/** Touches starting this close to the screen edge belong to the browser's own back/forward swipe. */
export const EDGE_GUARD_PX = 24;

export type Axis = 'x' | 'y' | null;

/** Which way the finger is going, once it has moved enough to tell. Sideways must clearly win. */
export function lockAxis(dx: number, dy: number): Axis {
  if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return null;
  return Math.abs(dx) > 1.5 * Math.abs(dy) ? 'x' : 'y';
}

/** Where a released drag lands: a swipe one way or the other, or back to the middle. */
export function swipeDecision({ dx, vx, width }: { dx: number; vx: number; width: number }): 'left' | 'right' | null {
  const far = Math.abs(dx) >= width * SWIPE_SHARE;
  const flick = Math.abs(vx) >= FLICK_SPEED && Math.sign(vx) === Math.sign(dx) && Math.abs(dx) >= AXIS_LOCK_PX * 2;
  if (!far && !flick) return null;
  return dx > 0 ? 'right' : 'left';
}

export function startsAtEdge(x: number, viewportWidth: number): boolean {
  return x < EDGE_GUARD_PX || x > viewportWidth - EDGE_GUARD_PX;
}

/**
 * Pointer handlers for a swipeable card. `dx` drives the card's position while dragging;
 * `onSwipe` fires once on release past the threshold. Vertical drags are left to the page.
 */
export function useSwipe(onSwipe: (dir: 'left' | 'right') => void, enabled = true) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const g = useRef<{ id: number; x0: number; y0: number; axis: Axis; t: number; x: number; vx: number; width: number } | null>(null);

  const reset = () => {
    g.current = null;
    setDragging(false);
    setDx(0);
  };

  return {
    dx,
    dragging,
    handlers: {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || e.button > 0 || startsAtEdge(e.clientX, window.innerWidth)) return;
        g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, t: e.timeStamp, x: e.clientX, vx: 0, width: e.currentTarget.offsetWidth || 320 };
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        const s = g.current;
        if (!s || s.id !== e.pointerId) return;
        const ddx = e.clientX - s.x0;
        if (!s.axis) {
          s.axis = lockAxis(ddx, e.clientY - s.y0);
          if (s.axis === 'y') return reset(); // a scroll — let the page have it
          if (s.axis === 'x') {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            setDragging(true);
          }
        }
        if (s.axis !== 'x') return;
        const dt = Math.max(1, e.timeStamp - s.t);
        s.vx = (e.clientX - s.x) / dt;
        s.x = e.clientX;
        s.t = e.timeStamp;
        setDx(ddx);
      },
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
        const s = g.current;
        if (!s || s.id !== e.pointerId) return;
        const dir = s.axis === 'x' ? swipeDecision({ dx: e.clientX - s.x0, vx: s.vx, width: s.width }) : null;
        reset();
        if (dir) onSwipe(dir);
      },
      onPointerCancel: reset,
    },
  };
}
