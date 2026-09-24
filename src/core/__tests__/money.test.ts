import { describe, it, expect } from 'vitest';
import { parsePence, formatAmount, formatGBP, percentOf, sumPence } from '../money.js';

describe('parsePence', () => {
  it('parses plain and messy user input to whole pence', () => {
    expect(parsePence('12')).toBe(1200);
    expect(parsePence('12.5')).toBe(1250);
    expect(parsePence('1,234.56')).toBe(123456);
    expect(parsePence('£12.99')).toBe(1299);
    expect(parsePence(12.5)).toBe(1250);
  });
  it('rounds sub-penny input rather than storing a float', () => {
    expect(parsePence('12.999')).toBe(1300);
    expect(parsePence('0.1')).toBe(10);
  });
  it('treats empty or junk input as zero', () => {
    expect(parsePence('')).toBe(0);
    expect(parsePence('.')).toBe(0);
    expect(parsePence('abc')).toBe(0);
  });
});

describe('formatting', () => {
  it('formats pence as a plain decimal', () => {
    expect(formatAmount(123456)).toBe('1234.56');
    expect(formatAmount(5)).toBe('0.05');
    expect(formatAmount(-1250)).toBe('-12.50');
  });
  it('formats pence as GBP with separators', () => {
    expect(formatGBP(123456)).toBe('£1,234.56');
    expect(formatGBP(0)).toBe('£0.00');
    expect(formatGBP(-9900)).toBe('-£99.00');
  });
});

describe('percentOf', () => {
  it('takes a percentage, rounded to the nearest penny', () => {
    expect(percentOf(10000, 20)).toBe(2000);
    expect(percentOf(9999, 20)).toBe(2000); // 1999.8 -> 2000
    expect(percentOf(10001, 20)).toBe(2000); // 2000.2 -> 2000
    expect(percentOf(0, 30)).toBe(0);
  });
  it('avoids the float error the old <0.02 tolerance existed to hide', () => {
    // 0.1 + 0.2 in pence is exact; taking 30% stays exact.
    expect(percentOf(sumPence([10, 20]), 100)).toBe(30);
  });
});
