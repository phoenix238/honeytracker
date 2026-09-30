import { describe, it, expect } from 'vitest';
import { certainDoubles, copyKind, findDoubles, ownMoneyAsIncome, unbackedOldRecords } from '../doubles.js';
import { txn } from './fixtures.js';

const bank = (over = {}) => txn({ source: 'starling', direction: 'in', amountPence: 6000, date: '2026-05-10', counterparty: 'LARA BLIGH', ...over });
const oldApp = (over = {}) => txn({ source: 'import', direction: 'in', amountPence: 6000, date: '2026-05-06', counterparty: 'Lara — session', bucket: 'business_income', classifiedBy: 'import', meta: { importedFrom: 'hp:1' }, ...over });

describe('the same money counted twice', () => {
  it('pairs a bank line with its copy from the old app, CSTL or cash — money moving the same way, within ten days', () => {
    const b = bank();
    const c = oldApp();
    const cash = txn({ source: 'cstl', direction: 'in', amountPence: 4500, date: '2026-05-01', bucket: 'business_income', meta: { cstlBookingId: 'b2' } });
    const b2 = bank({ amountPence: 4500, date: '2026-05-03', counterparty: 'SAM' });
    const pairs = findDoubles([b, c, cash, b2]);
    expect(pairs.map((d) => [d.bank.id, d.copy.id])).toEqual([[b.id, c.id], [b2.id, cash.id]]);
    expect(pairs[0]).toMatchObject({ days: 4, exact: true, alone: true });
    expect(copyKind(c)).toBe('Old app record');
    expect(copyKind(cash)).toBe('CSTL: paid in cash');
  });

  it('leaves alone what isn’t double counting', () => {
    expect(findDoubles([bank(), oldApp({ date: '2026-03-20' })])).toEqual([]); // over six weeks apart
    expect(findDoubles([bank(), oldApp({ date: '2026-04-20', counterparty: 'Session' })])).toEqual([]); // weeks apart and no name in common
    expect(findDoubles([bank(), oldApp({ amountPence: 6500 })])).toEqual([]); // different amount
    expect(findDoubles([bank({ direction: 'out' }), oldApp()])).toEqual([]); // one in, one out
    expect(findDoubles([bank({ bucket: 'transfer' }), oldApp()])).toEqual([]); // your own money moving
    expect(findDoubles([bank({ bucket: 'personal', classifiedBy: 'user' }), oldApp()])).toEqual([]); // you said personal
    expect(findDoubles([bank(), oldApp({ bucket: 'personal' })])).toEqual([]); // the copy doesn't count
    expect(findDoubles([bank(), txn({ source: 'starling', amountPence: 6000, date: '2026-05-10', bucket: 'business_income' })])).toEqual([]); // two bank lines
    expect(findDoubles([bank({ meta: { importedFrom: 'hp:other' } }), oldApp()])).toEqual([]); // already another record's twin
  });

  it('reaches weeks back for an old-app record when the name agrees (it carries the day you marked it paid)', () => {
    const [d] = findDoubles([bank(), oldApp({ date: '2026-04-20' })]);
    expect(d).toMatchObject({ kind: 'copy', days: 20, sameName: true });
    // A cash line you added only reaches ten days, name or not.
    expect(findDoubles([bank(), txn({ source: 'cash', amountPence: 6000, date: '2026-04-20', counterparty: 'Lara', bucket: 'business_income' })])).toEqual([]);
  });

  it('prefers the bank line with the same name over a closer one without', () => {
    const lara = bank({ date: '2026-05-20' });
    const other = bank({ date: '2026-05-07', counterparty: 'SOMEONE ELSE' });
    const [d] = findDoubles([lara, other, oldApp()]);
    expect(d!.bank.id).toBe(lara.id);
  });

  it('finds one payment brought in twice — the live Starling feed and a statement file — and keeps Starling’s', () => {
    const live = bank({ source: 'starling', bucket: 'business_income' });
    const file = bank({ source: 'bankcsv', sourceId: 'csv-1', date: '2026-05-11', counterparty: 'Lara Bligh', meta: { account: 'Starling CSV' } });
    const [d] = findDoubles([file, live]);
    expect(d).toMatchObject({ kind: 'statement' });
    expect(d!.bank.id).toBe(live.id);
    expect(copyKind(file)).toBe('Statement file (Starling CSV)');
    expect(certainDoubles([file, live])).toHaveLength(1);
    expect(findDoubles([file, bank({ source: 'starling', counterparty: 'Someone Else' })])).toEqual([]); // different payer
  });

  it('lists old-app records nothing in the bank backs up — from when the bank history starts, cash ones kept', () => {
    const b = bank({ date: '2026-04-06', amountPence: 1 });
    const lone = oldApp({ amountPence: 7500, date: '2026-05-01' });
    const before = oldApp({ amountPence: 7500, date: '2026-03-01' });
    const cash = oldApp({ amountPence: 7500, date: '2026-05-02', meta: { cashConfirmed: '1' } });
    const matched = oldApp({ amountPence: 6000, date: '2026-05-10' });
    const b2 = bank({ date: '2026-05-10' });
    expect(unbackedOldRecords([b, b2, lone, before, cash, matched]).map((t) => t.id)).toEqual([lone.id]);
  });

  it('uses each line once, closest dates first, and remembers “two payments”', () => {
    const near = bank({ date: '2026-05-07' });
    const far = bank({ date: '2026-05-14' });
    const c = oldApp();
    const [d] = findDoubles([far, near, c]);
    expect(d!.bank.id).toBe(near.id);
    expect(d!.alone).toBe(false);
    expect(findDoubles([near, oldApp({ meta: { notDoubleOf: near.id } })])).toEqual([]);
  });

  it('merges without asking only an old-app record with its exact, unique bank twin within six days', () => {
    const b = bank();
    expect(certainDoubles([b, oldApp()])).toHaveLength(1);
    expect(certainDoubles([b, oldApp({ date: '2026-05-01' })])).toHaveLength(0); // 9 days: ask
    expect(certainDoubles([b, oldApp({ amountPence: 6001 })])).toHaveLength(0); // a penny out: ask
    expect(certainDoubles([b, bank({ date: '2026-05-08' }), oldApp()])).toHaveLength(0); // two it could be: ask
    expect(certainDoubles([b, txn({ source: 'cstl', amountPence: 6000, date: '2026-05-10', bucket: 'business_income' })])).toHaveLength(0); // not the old app: ask
  });
});

describe('your own money counted as income', () => {
  it('flags money in from you, not a client who put your name in the reference', () => {
    const me = ['Phoenix Tanner'];
    const fromMonzo = bank({ counterparty: 'PHOENIX TANNER', bucket: 'business_income' });
    const client = bank({ counterparty: 'Lara Bligh', reference: 'Phoenix Tanner session', bucket: 'business_income' });
    const sorted = bank({ counterparty: 'Phoenix Tanner', bucket: 'transfer' });
    expect(ownMoneyAsIncome([fromMonzo, client, sorted], me).map((t) => t.id)).toEqual([fromMonzo.id]);
    expect(ownMoneyAsIncome([fromMonzo], [])).toEqual([]);
  });
});
