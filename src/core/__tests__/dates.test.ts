import { describe, it, expect } from 'vitest';
import {
  ukTaxYearStart,
  taxYearBounds,
  taxYearLabel,
  withinBounds,
  datesClose,
} from '../dates';

describe('ukTaxYearStart', () => {
  it('rolls over on 6 April, not 1 January', () => {
    expect(ukTaxYearStart(new Date(2026, 3, 5))).toBe(2025); // 5 Apr -> prior year
    expect(ukTaxYearStart(new Date(2026, 3, 6))).toBe(2026); // 6 Apr -> new year
    expect(ukTaxYearStart(new Date(2026, 0, 15))).toBe(2025); // mid Jan
    expect(ukTaxYearStart(new Date(2026, 11, 31))).toBe(2026); // end Dec
  });
});

describe('taxYearBounds / label', () => {
  it('spans 6 Apr to 5 Apr and labels as YYYY/YY', () => {
    expect(taxYearBounds(2026)).toEqual({ from: '2026-04-06', to: '2027-04-05' });
    expect(taxYearLabel(2026)).toBe('2026/27');
    expect(taxYearLabel(2009)).toBe('2009/10');
  });
});

describe('withinBounds', () => {
  const b = taxYearBounds(2026);
  it('includes the boundary days and excludes outside', () => {
    expect(withinBounds('2026-04-06', b)).toBe(true);
    expect(withinBounds('2027-04-05', b)).toBe(true);
    expect(withinBounds('2026-04-05', b)).toBe(false);
    expect(withinBounds('2027-04-06', b)).toBe(false);
  });
});

describe('datesClose', () => {
  it('is true within six days, false beyond, false on blanks', () => {
    expect(datesClose('2026-03-01', '2026-03-06')).toBe(true);
    expect(datesClose('2026-03-01', '2026-03-07')).toBe(false);
    expect(datesClose('2026-03-01', '')).toBe(false);
  });
});
