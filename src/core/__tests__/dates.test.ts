import { describe, it, expect } from 'vitest';
import {
  ukTaxYearStart,
  taxYearBounds,
  taxYearLabel,
  withinBounds,
  datesClose,
} from '../dates.js';

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

import { londonDate, taxYearOf, mtdQuarters, daysInclusive, addDays } from '../dates.js';

describe('londonDate / taxYearOf', () => {
  it('files a just-after-midnight BST payment on 6 April in the new tax year', () => {
    // 00:30 BST on 6 Apr 2026 is 23:30 UTC on 5 Apr.
    expect(londonDate('2026-04-05T23:30:00Z')).toBe('2026-04-06');
    expect(taxYearOf(londonDate('2026-04-05T23:30:00Z'))).toBe(2026);
    expect(taxYearOf('2026-04-05')).toBe(2025);
  });
  it('uses GMT in winter', () => {
    expect(londonDate('2026-01-15T23:30:00Z')).toBe('2026-01-15');
  });
});

describe('mtdQuarters', () => {
  it('uses the standard update periods and deadlines', () => {
    const q = mtdQuarters(2026);
    expect(q[0]).toMatchObject({ from: '2026-04-06', to: '2026-07-05', deadline: '2026-08-07' });
    expect(q[3]).toMatchObject({ from: '2027-01-06', to: '2027-04-05', deadline: '2027-05-07' });
  });
  it('counts days and shifts dates', () => {
    expect(daysInclusive('2026-04-06', '2027-04-05')).toBe(365);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
});
