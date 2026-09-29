import { describe, it, expect } from 'vitest';
import { lockAxis, startsAtEdge, swipeDecision } from '../swipe';

describe('swipe', () => {
  it('waits until the finger has moved enough to tell a swipe from a scroll', () => {
    expect(lockAxis(4, 3)).toBeNull();
    expect(lockAxis(30, 5)).toBe('x');
    expect(lockAxis(12, 20)).toBe('y');
    expect(lockAxis(15, 12)).toBe('y'); // diagonal-ish goes to the page, not the card
  });
  it('counts a long drag or a quick flick, and springs back otherwise', () => {
    expect(swipeDecision({ dx: 150, vx: 0, width: 400 })).toBe('right');
    expect(swipeDecision({ dx: -150, vx: 0, width: 400 })).toBe('left');
    expect(swipeDecision({ dx: 60, vx: 0.1, width: 400 })).toBeNull();
    expect(swipeDecision({ dx: 60, vx: 0.9, width: 400 })).toBe('right');
    expect(swipeDecision({ dx: 60, vx: -0.9, width: 400 })).toBeNull(); // flicked back the other way
    expect(swipeDecision({ dx: 8, vx: 2, width: 400 })).toBeNull(); // a tap that twitched
  });
  it('leaves edge swipes to the browser', () => {
    expect(startsAtEdge(5, 390)).toBe(true);
    expect(startsAtEdge(380, 390)).toBe(true);
    expect(startsAtEdge(200, 390)).toBe(false);
  });
});
