import { describe, it, expect } from 'vitest';
import { certainDoubles, copyKind, findDoubles, ownMoneyAsIncome } from '../doubles.js';
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
    expect(findDoubles([bank(), oldApp({ date: '2026-04-20' })])).toEqual([]); // too far apart
    expect(findDoubles([bank(), oldApp({ amountPence: 6500 })])).toEqual([]); // different amount
    expect(findDoubles([bank({ direction: 'out' }), oldApp()])).toEqual([]); // one in, one out
    expect(findDoubles([bank({ bucket: 'transfer' }), oldApp()])).toEqual([]); // your own money moving
    expect(findDoubles([bank({ bucket: 'personal', classifiedBy: 'user' }), oldApp()])).toEqual([]); // you said personal
    expect(findDoubles([bank(), oldApp({ bucket: 'personal' })])).toEqual([]); // the copy doesn't count
    expect(findDoubles([bank(), txn({ source: 'starling', amountPence: 6000, date: '2026-05-10', bucket: 'business_income' })])).toEqual([]); // two bank lines
    expect(findDoubles([bank({ meta: { importedFrom: 'hp:other' } }), oldApp()])).toEqual([]); // already another record's twin
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
