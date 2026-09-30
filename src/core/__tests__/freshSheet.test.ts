import { describe, it, expect } from 'vitest';
import { FRESH_COLUMNS, carryOver, dateOf, looseCategory, penceOf, planFresh, readFreshSheet, type Cell } from '../freshSheet.js';
import { txn } from './fixtures.js';

const header = [...FRESH_COLUMNS] as Cell[];

describe('reading your spreadsheet', () => {
  it('reads the app’s own template, with real dates and numbers as a spreadsheet stores them', () => {
    const { rows, problems } = readFreshSheet([
      header,
      [new Date(Date.UTC(2025, 8, 3)), 'In', 60, 'LARA BLIGH', 'Session', 'Business income', 'Craniosacral therapy', '', '', '', 'Starling'],
      [new Date(Date.UTC(2025, 8, 4)), 'Out', 45.5, 'SHELL 334', '', 'Business cost', 'Coffee', 'Car, van & travel', 100, 'Fuel to shifts', 'Starling'],
      [new Date(Date.UTC(2025, 8, 5)), 'Out', 30, 'LEBARA', '', 'Business cost', 'Coffee', 'Phone & software', 0.5, '', 'Starling'],
      [new Date(Date.UTC(2025, 8, 6)), 'Out', 12, 'TESCO', '', 'Personal', '', '', '', '', 'Monzo'],
      [new Date(Date.UTC(2025, 8, 7)), 'In', 200, 'PHOENIX TANNER', '', 'Between my accounts', '', '', '', '', 'Starling'],
      [new Date(Date.UTC(2025, 8, 8)), 'Out', 9.99, 'SPOTIFY', '', 'Not sure yet', '', '', '', '', 'Starling'],
      [null, null, null, null, null, null, null, null, null, null, null],
    ]);
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.line, r.date, r.direction, r.amountPence, r.bucket, r.stream, r.category, r.businessPercent])).toEqual([
      [2, '2025-09-03', 'in', 6000, 'business_income', 'Craniosacral therapy', null, 100],
      [3, '2025-09-04', 'out', 4550, 'business_expense', 'Coffee', 'carVanTravelExpenses', 100],
      [4, '2025-09-05', 'out', 3000, 'business_expense', 'Coffee', 'adminCosts', 50],
      [5, '2025-09-06', 'out', 1200, 'personal', '', null, 100],
      [6, '2025-09-07', 'in', 20000, 'transfer', '', null, 100],
      [7, '2025-09-08', 'out', 999, 'unreviewed', '', null, 100],
    ]);
    expect(rows[1]).toMatchObject({ note: 'Fuel to shifts', account: 'Starling', counterparty: 'SHELL 334' });
  });

  it('reads a sheet typed by hand: columns in any order, other names, text dates, Money in/out columns', () => {
    const { rows, problems } = readFreshSheet([
      ['My tax year', '', ''],
      ['Payee', 'Money out', 'Money in', 'Date', 'Type', 'Notes'],
      ['Studio rent — Amy', '£350.00', '', '06/09/2025', 'expense', 'Room hire'],
      ['Ethical Caff', '', '162', '15 Sep 2025', 'income', 'INV55'],
    ]);
    expect(problems.filter((p) => p.skipped)).toEqual([]);
    expect(rows.map((r) => [r.line, r.date, r.direction, r.amountPence, r.bucket, r.note])).toEqual([
      [3, '2025-09-06', 'out', 35000, 'business_expense', 'Room hire'],
      [4, '2025-09-15', 'in', 16200, 'business_income', 'INV55'],
    ]);
  });

  it('works out the way money went from a signed amount, or from what it is', () => {
    const { rows } = readFreshSheet([
      ['Date', 'Amount', 'What is it?'],
      ['2025-10-01', '-12.00', 'Personal'],
      ['2025-10-02', '60', 'Business income'],
      ['2025-10-03', '(8.40)', ''],
    ]);
    expect(rows.map((r) => [r.direction, r.amountPence, r.bucket])).toEqual([['out', 1200, 'personal'], ['in', 6000, 'business_income'], ['out', 840, 'unreviewed']]);
  });

  it('never drops money quietly: every row it can’t read is listed with why, and near-misses come in with a note', () => {
    const { rows, problems } = readFreshSheet([
      header,
      ['someday', 'In', 60, 'X', '', 'Business income'],
      ['2025-10-02', 'In', '', 'Y', '', 'Business income'],
      ['2025-10-03', '', 20, 'Z', '', 'Personal'],
      ['2025-10-04', 'Out', 20, 'Boots', '', 'Buisness cost'],
      ['2025-10-05', 'Out', 20, 'Boots', '', 'Business cost', '', 'Stuff for clients'],
      ['2025-10-06', 'Out', 20, 'Boots', '', 'Business cost', '', 'Travel', '150'],
    ]);
    expect(problems.map((p) => [p.line, p.skipped])).toEqual([[2, true], [3, true], [4, true], [5, false], [6, false], [7, false]]);
    expect(problems[3]!.message).toContain('Not sure yet');
    expect(rows.map((r) => [r.bucket, r.category, r.businessPercent])).toEqual([
      ['unreviewed', null, 100],
      ['business_expense', 'otherExpenses', 100],
      ['business_expense', 'carVanTravelExpenses', 100],
    ]);
  });

  it('says so when there’s no header it can use', () => {
    expect(readFreshSheet([['Name', 'Thing'], ['a', 'b']]).problems[0]!.message).toMatch(/header row/);
  });

  it('reads the app’s older “download to edit” file too', () => {
    const { rows } = readFreshSheet([
      ['Honey ID (don’t change)', 'Date', 'In/Out', 'Amount £', 'Who', 'Reference', 'Account', 'What is it?', 'Stream', 'Category', 'Work %', 'Note', 'Receipts', 'Last changed (don’t change)'],
      ['h-abc', '2025-11-01', 'out', '12.00', 'Ryman', '', 'Starling', 'cost', 'Coffee', 'Phone, stationery & office', '100', '', '', 'v-x'],
    ]);
    expect(rows[0]).toMatchObject({ bucket: 'business_expense', category: 'adminCosts', stream: 'Coffee', account: 'Starling' });
  });
});

describe('cells', () => {
  it('reads dates and amounts however they were stored', () => {
    expect(dateOf(45903)).toBe('2025-09-03'); // an Excel day number
    expect(dateOf('3/9/25')).toBe('2025-09-03');
    expect(dateOf('nonsense')).toBeNull();
    expect(penceOf(45.5)).toBe(4550);
    expect(penceOf('£1,234.50')).toBe(123450);
    expect(penceOf('')).toBeNull();
  });
  it('finds a category from the label, the app’s short name, the HMRC box, or a word in it', () => {
    expect(looseCategory('Room hire & rent')).toBe('premisesRunningCosts');
    expect(looseCategory('box 20')).toBe('carVanTravelExpenses');
    expect(looseCategory('marketing')).toBe('advertisingCosts');
    expect(looseCategory('gibberish')).toBeNull();
  });
});

describe('what starting fresh would do', () => {
  it('replaces everything up to the last date, and every old-app record; keeps what’s after', () => {
    const { rows } = readFreshSheet([
      header,
      ['2025-04-10', 'In', 60, 'A', '', 'Business income', 'Practice'],
      ['2025-09-30', 'Out', 20, 'B', '', 'Business cost', 'New work', 'Travel'],
      ['2026-04-10', 'Out', 5, 'C', '', 'Not sure yet'],
      ['2026-04-10', 'Out', 5, 'C', '', 'Not sure yet'],
    ]);
    const existing = [
      txn({ date: '2026-01-01', source: 'starling' }),
      txn({ date: '2026-04-10', source: 'cstl' }),
      txn({ date: '2026-05-01', source: 'import' }),
      txn({ date: '2026-05-01', source: 'starling' }),
    ];
    const plan = planFresh(rows, existing, ['practice'], '2026-09-30')!;
    expect(plan).toMatchObject({ count: 4, from: '2025-04-10', cutoff: '2026-04-10', keeping: 1, newStreams: ['New work'], lookAlike: [5], future: [] });
    expect(plan.removing).toEqual({ total: 3, bank: 1, oldApp: 1, other: 1 });
    expect(plan.years).toEqual([
      { taxYear: 2025, incomePence: 6000, costsPence: 2000, toSort: 0, rows: 2 },
      { taxYear: 2026, incomePence: 0, costsPence: 0, toSort: 2, rows: 2 },
    ]);
  });
});

describe('receipts and invoices finding their new lines', () => {
  const line = (id: string, date: string, amountPence: number, counterparty = 'X', direction: 'in' | 'out' = 'out') => ({ id, date, amountPence, counterparty, direction });

  it('same way and amount, nearest date first, then the same name; one new line per old line', () => {
    const old = [line('o1', '2026-03-10', 1200, 'LEBARA'), line('o2', '2026-03-10', 6000, 'SARAH', 'in'), line('o3', '2026-03-10', 6000, 'TOM', 'in')];
    const fresh = [
      line('n1', '2026-03-12', 1200, 'LEBARA'),
      line('n2', '2026-03-10', 1200, 'Lebara Mobile'),
      line('n3', '2026-03-10', 6000, 'tom', 'in'),
      line('n4', '2026-03-10', 6000, 'sarah', 'in'),
    ];
    expect(carryOver(old, fresh)).toEqual(new Map([['o1', 'n2'], ['o2', 'n4'], ['o3', 'n3']]));
  });

  it('leaves an old line with no match in the sheet — wrong way, other amount, or too far off', () => {
    const old = [line('o1', '2026-03-10', 1200), line('o2', '2026-03-10', 500), line('o3', '2026-03-10', 700)];
    const fresh = [line('n1', '2026-03-10', 1200, 'X', 'in'), line('n2', '2026-03-10', 501), line('n3', '2026-03-14', 700)];
    expect(carryOver(old, fresh).size).toBe(0);
  });
});
