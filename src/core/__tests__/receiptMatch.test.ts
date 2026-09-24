import { describe, it, expect } from 'vitest';
import { receiptCandidates, autoMatch } from '../receiptMatch.js';
import type { Receipt } from '../types.js';
import { txn } from './fixtures.js';

const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  id: 'rc1',
  uploadedAt: '',
  filename: 'r.jpg',
  mime: 'image/jpeg',
  merchant: 'Ryman',
  date: '2026-05-10',
  totalPence: 2_350,
  vatPence: null,
  suggestedCategory: 'adminCosts',
  description: '',
  transactionId: null,
  ...over,
});

describe('receipt matching', () => {
  it('matches the card payment that settled a couple of days later', () => {
    const hit = txn({ direction: 'out', amountPence: 2_350, date: '2026-05-12' });
    const wrongAmount = txn({ direction: 'out', amountPence: 2_400, date: '2026-05-10' });
    const tooLate = txn({ direction: 'out', amountPence: 2_350, date: '2026-05-20' });
    const incoming = txn({ direction: 'in', amountPence: 2_350, date: '2026-05-10' });
    expect(autoMatch(receipt(), [hit, wrongAmount, tooLate, incoming])?.id).toBe(hit.id);
  });
  it('refuses to guess between two equal candidates', () => {
    const a = txn({ direction: 'out', amountPence: 2_350, date: '2026-05-10' });
    const b = txn({ direction: 'out', amountPence: 2_350, date: '2026-05-11' });
    expect(autoMatch(receipt(), [a, b])).toBeNull();
    expect(receiptCandidates(receipt(), [b, a])[0]!.id).toBe(a.id); // nearest first
  });
  it('needs an amount and a date to match anything', () => {
    expect(receiptCandidates(receipt({ totalPence: null }), [txn({ direction: 'out', amountPence: 2_350 })])).toEqual([]);
  });
});
