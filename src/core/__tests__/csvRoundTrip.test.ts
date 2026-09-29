import { describe, it, expect } from 'vitest';
import { parseCsv, parseDate, parseSignedPence } from '../csv.js';
import { editCsv, isEditFile, planEditImport } from '../csvRoundTrip.js';
import { detectStatement, parseStatement } from '../bankCsv.js';
import type { Stream } from '../types.js';
import { txn } from './fixtures.js';

const streams: Stream[] = [
  { id: 's1', name: 'Craniosacral therapy', kind: 'self_employment', color: '#fff', archived: false, about: '' },
  { id: 's2', name: 'Coffee', kind: 'self_employment', color: '#fff', archived: false, about: '' },
];

describe('reading CSV back from a spreadsheet', () => {
  it('handles quotes, commas, newlines, CRLF and the byte-order mark', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']]);
  });
  it('reads UK dates the ways spreadsheets write them, and refuses impossible ones', () => {
    expect(parseDate('2026-09-03')).toBe('2026-09-03');
    expect(parseDate('03/09/2026')).toBe('2026-09-03');
    expect(parseDate('3/9/26')).toBe('2026-09-03');
    expect(parseDate('3 Sept 2026')).toBe('2026-09-03');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('soon')).toBeNull();
  });
  it('reads amounts with pounds, commas, minus signs and brackets — and never guesses zero', () => {
    expect(parseSignedPence('£1,234.50')).toBe(123450);
    expect(parseSignedPence('-12.00')).toBe(-1200);
    expect(parseSignedPence('−3.75')).toBe(-375);
    expect(parseSignedPence('(12)')).toBe(-1200);
    expect(parseSignedPence("'-12.00")).toBe(-1200);
    expect(parseSignedPence('twelve')).toBeNull();
  });
});

describe('edit in a spreadsheet and bring it back', () => {
  const a = txn({ counterparty: 'TFL TRAVEL CH', direction: 'out', amountPence: 840, date: '2026-09-03' });
  const b = txn({ counterparty: 'Lara Bligh', direction: 'in', amountPence: 6000, date: '2026-09-09', bucket: 'business_income', streamId: 's1', classifiedBy: 'user' });
  const c = txn({ counterparty: '=cmd|calc', direction: 'out', amountPence: 1200, date: '2026-09-10', bucket: 'business_expense', category: 'adminCosts', streamId: 's1', note: 'zoom' });
  const file = editCsv([a, b, c], streams);
  const rows = parseCsv(file);

  it('writes IDs that stay text, and keeps bank text from running as a formula', () => {
    expect(isEditFile(rows)).toBe(true);
    expect(rows[1]![0]).toBe(`h-${a.id}`);
    expect(file).toContain("'=cmd|calc");
    expect(planEditImport(rows, [a, b, c], streams).unchanged).toBe(3); // untouched file = no changes
  });

  it('turns edited cells into changes, and nothing else', () => {
    const edited = rows.map((r) => [...r]);
    edited[1]![7] = 'cost'; // What is it?
    edited[1]![8] = 'craniosacral therapy'; // Stream, any case
    edited[1]![9] = 'Travel'; // a quick-chip label works too
    edited[3]![10] = '50%'; // Work %
    edited[3]![11] = ''; // clear the note
    const plan = planEditImport(edited, [a, b, c], streams);
    expect(plan.problems).toEqual([]);
    expect(plan.changes).toHaveLength(2);
    expect(plan.changes[0]).toMatchObject({ id: a.id, patch: { bucket: 'business_expense', streamId: 's1', category: 'carVanTravelExpenses' } });
    expect(plan.changes[1]!.patch).toEqual({ businessPercent: 50, note: '' });
    expect(plan.changes[1]!.expectUpdatedAt).toBe(c.updatedAt);
  });

  it('refuses rows that no longer line up, unknown values, repeated or missing IDs', () => {
    const bad = rows.map((r) => [...r]);
    bad[1]![3] = '9.99'; // amount changed → the row was moved
    bad[2]![8] = 'Plumbing'; // no such stream
    bad[3]![9] = 'Yachts'; // no such category
    bad.push([...rows[2]!]); // b twice
    bad.push(['', '2026-09-11', 'in', '5.00']);
    const plan = planEditImport(bad, [a, b, c], streams);
    expect(plan.changes).toEqual([]);
    expect(plan.problems.map((p) => p.row)).toEqual([2, 3, 4, 5, 6]);
    expect(plan.problems[0]!.message).toMatch(/amount no longer matches/);
    expect(plan.problems[1]!.message).toMatch(/more than once/);
  });

  it('leaves a row changed in Honey since the download as Honey has it', () => {
    const edited = rows.map((r) => [...r]);
    edited[1]![7] = 'personal';
    expect(rows[1]![13]).toBe(`v-${a.updatedAt}`); // the stamp stays text in a spreadsheet
    const newer = { ...a, updatedAt: '2026-09-29T12:00:00Z' };
    const plan = planEditImport(edited, [newer, b, c], streams);
    expect(plan.changes).toEqual([]);
    expect(plan.conflicts).toEqual([{ row: 2, who: 'TFL TRAVEL CH' }]);
  });

  it('accepts dates a spreadsheet rewrote, and a box number for the category', () => {
    const edited = rows.map((r) => [...r]);
    edited[1]![1] = '03/09/2026';
    edited[1]![7] = 'cost';
    edited[1]![9] = '21';
    const plan = planEditImport(edited, [a, b, c], streams);
    expect(plan.changes[0]!.patch.category).toBe('premisesRunningCosts');
  });
});

describe('bank statements', () => {
  const monzo = parseCsv(
    [
      'Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In',
      'tx_0001,03/09/2026,09:12:00,Card payment,Tamesis Dock,,Eating out,-3.75,GBP,-3.75,GBP,,,,TAMESIS DOCK LONDON,,-3.75,',
      'tx_0002,04/09/2026,10:00:00,Faster payment,Lara Bligh,,Income,60.00,GBP,60.00,GBP,,,,Thanks,,,60.00',
      'tx_0003,05/09/2026,10:00:00,Pot transfer,Studio Rent,,Savings,-200.00,GBP,-200.00,GBP,,,,,,-200.00,',
      'tx_0004,06/09/2026,10:00:00,Card payment,Cafe Paris,,Eating out,-10.00,EUR,-8.60,GBP,,,,,,,',
    ].join('\n'),
  );

  it('recognises a Monzo export and keeps its own transaction ids', () => {
    expect(detectStatement(monzo)).toBe('monzo');
    const s = parseStatement(monzo);
    expect(s.lines.map((l) => [l.sourceId, l.direction, l.amountPence, l.counterparty])).toEqual([
      ['tx_0001', 'out', 375, 'Tamesis Dock'],
      ['tx_0002', 'in', 6000, 'Lara Bligh'],
      ['tx_0003', 'out', 20000, 'Studio Rent'],
    ]);
    expect(s.lines[2]!.ownMove).toBe(true); // a pot, not a cost
    expect(s.problems).toHaveLength(1); // the euro line is flagged, not guessed
  });

  it('reads other banks’ paid in / paid out statements, and tells identical lines apart', () => {
    const rows = parseCsv('Date,Description,Paid out,Paid in\n01/09/2026,COSTA,3.00,\n01/09/2026,COSTA,3.00,\n02/09/2026,CLIENT,,45.00\n');
    expect(detectStatement(rows)).toBe('bank');
    const s = parseStatement(rows);
    expect(s.lines.map((l) => [l.direction, l.amountPence])).toEqual([['out', 300], ['out', 300], ['in', 4500]]);
    expect(new Set(s.lines.map((l) => l.sourceId)).size).toBe(3);
    expect(parseStatement(rows).lines.map((l) => l.sourceId)).toEqual(s.lines.map((l) => l.sourceId)); // same file, same ids
  });

  it('says so when a file is not a statement', () => {
    expect(detectStatement(parseCsv('Name,Colour\nPhoenix,gold\n'))).toBeNull();
  });
});
