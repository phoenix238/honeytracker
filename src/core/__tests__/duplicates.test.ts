import { describe, it, expect } from 'vitest';
import { findDuplicates } from '../duplicates';

interface Row {
  id: string;
  date: string;
  label: string;
  amountPence: number;
}
const find = (rows: Row[]) =>
  [...findDuplicates(rows, (r) => r.label, (r) => r.amountPence)].sort();

describe('findDuplicates', () => {
  it('flags same-label, near-amount, near-date pairs', () => {
    const rows: Row[] = [
      { id: 'a', date: '2026-03-01', label: 'Sarah', amountPence: 12000 },
      { id: 'b', date: '2026-03-03', label: 'Sarah', amountPence: 12000 },
      { id: 'c', date: '2026-03-02', label: 'Bob', amountPence: 12000 },
    ];
    expect(find(rows)).toEqual(['a', 'b']); // Bob differs by label, not flagged
  });

  it('treats amounts within a penny as duplicates, 2p apart as distinct', () => {
    const rows: Row[] = [
      { id: 'a', date: '2026-03-01', label: 'x', amountPence: 10000 },
      { id: 'b', date: '2026-03-01', label: 'x', amountPence: 10001 },
      { id: 'c', date: '2026-03-01', label: 'x', amountPence: 10002 },
    ];
    // a-b within 1p (dup); a-c and b-c 2p apart... b-c is 1p (dup)
    expect(find(rows)).toEqual(['a', 'b', 'c']);
  });

  it('does not flag amounts 2p+ apart', () => {
    const rows: Row[] = [
      { id: 'a', date: '2026-03-01', label: 'x', amountPence: 10000 },
      { id: 'b', date: '2026-03-01', label: 'x', amountPence: 10002 },
    ];
    expect(find(rows)).toEqual([]);
  });

  it('does not flag same amount/label more than six days apart', () => {
    const rows: Row[] = [
      { id: 'a', date: '2026-03-01', label: 'x', amountPence: 5000 },
      { id: 'b', date: '2026-03-20', label: 'x', amountPence: 5000 },
    ];
    expect(find(rows)).toEqual([]);
  });

  it('normalises label case and whitespace', () => {
    const rows: Row[] = [
      { id: 'a', date: '2026-03-01', label: ' Sarah ', amountPence: 5000 },
      { id: 'b', date: '2026-03-01', label: 'sarah', amountPence: 5000 },
    ];
    expect(find(rows)).toEqual(['a', 'b']);
  });

  it('does not mutate the input order', () => {
    const rows: Row[] = [
      { id: 'a', date: '2026-03-01', label: 'x', amountPence: 900 },
      { id: 'b', date: '2026-03-01', label: 'x', amountPence: 100 },
    ];
    findDuplicates(rows, (r) => r.label, (r) => r.amountPence);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
