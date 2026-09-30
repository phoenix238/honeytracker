import { describe, it, expect } from 'vitest';
import { isYou, sortTransfer, transferKind } from '../transfers.js';
import { txn } from './fixtures.js';

const me = ['Phoenix Tanner'];

describe('bank transfers', () => {
  it('money you send by transfer or standing order is personal', () => {
    for (const src of ['FASTER_PAYMENTS_OUT', 'STANDING_ORDER']) {
      expect(transferKind(txn({ direction: 'out', counterparty: 'J Smith', meta: { starlingSource: src } }), me)).toBe('sent');
    }
    expect(transferKind(txn({ direction: 'out', counterparty: 'Landlord', meta: { bankType: 'Faster payment' } }), me)).toBe('sent');
  });

  it('your own money moving is a transfer, either way', () => {
    expect(transferKind(txn({ direction: 'in', counterparty: 'PHOENIX TANNER', meta: { starlingSource: 'FASTER_PAYMENTS_IN' } }), me)).toBe('own');
    expect(transferKind(txn({ direction: 'out', counterparty: 'Mx Phoenix Tanner', meta: { starlingSource: 'FASTER_PAYMENTS_OUT' } }), me)).toBe('own');
    expect(transferKind(txn({ meta: { starlingSource: 'INTERNAL_TRANSFER' } }), [])).toBe('own');
    expect(transferKind(txn({ meta: { bankType: 'Pot transfer' } }), [])).toBe('own');
  });

  it('leaves what isn’t a transfer you sent: client payments, card spending, direct debits', () => {
    expect(transferKind(txn({ direction: 'in', counterparty: 'Lara Bligh', reference: 'Phoenix Tanner', meta: { starlingSource: 'FASTER_PAYMENTS_IN' } }), me)).toBeNull();
    expect(transferKind(txn({ direction: 'out', counterparty: 'Shell', meta: { starlingSource: 'MASTER_CARD' } }), me)).toBeNull();
    expect(transferKind(txn({ direction: 'out', counterparty: 'Lebara', meta: { starlingSource: 'DIRECT_DEBIT' } }), me)).toBeNull();
    expect(transferKind(txn({ direction: 'out', counterparty: 'Tesco', meta: { bankType: 'Card payment' } }), me)).toBeNull();
  });

  it('never re-sorts something already decided, and short names aren’t trusted', () => {
    const ruled = txn({ direction: 'out', bucket: 'business_expense', classifiedBy: 'rule', meta: { starlingSource: 'FASTER_PAYMENTS_OUT' } });
    expect(sortTransfer(ruled, me)).toBe(ruled);
    const sent = sortTransfer(txn({ direction: 'out', meta: { starlingSource: 'FASTER_PAYMENTS_OUT' } }), me);
    expect(sent).toMatchObject({ bucket: 'personal', classifiedBy: 'rule', meta: { autoSorted: 'transfer' } });
    expect(isYou('Sam Smith', ['Sam'])).toBe(false);
  });
});
