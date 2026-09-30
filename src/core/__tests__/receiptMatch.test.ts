import { describe, it, expect } from 'vitest';
import { receiptCandidates, autoMatch, looseReceiptsFor, receiptOrigin } from '../receiptMatch.js';
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

describe('finding a receipt by hand', () => {
  const r = (id: string, over: Partial<Receipt>): Receipt => ({ id, uploadedAt: '', filename: 'photo.jpg', mime: 'image/jpeg', merchant: '', date: '2026-09-10', totalPence: 1000, vatPence: null, suggestedCategory: null, description: '', transactionId: null, ...over });
  it('lists every loose receipt: same amount near the date, then the closest amounts, then unread ones', () => {
    const t = txn({ direction: 'out', amountPence: 1000, date: '2026-09-10' });
    const list = looseReceiptsFor(t, [
      r('unread', { totalPence: null }),
      r('far-off', { totalPence: 5000 }),
      r('close', { totalPence: 1050 }),
      r('exact', {}),
      r('exact-but-old', { date: '2026-06-01' }),
      r('taken', { transactionId: 'x' }),
    ]);
    expect(list.map((x) => x.id)).toEqual(['exact', 'exact-but-old', 'close', 'far-off', 'unread']);
  });
  it('says where each one came from', () => {
    expect(receiptOrigin(r('a', { description: 'Ads (from Gmail: Your receipt)', mime: 'application/pdf' }))).toBe('from your email');
    expect(receiptOrigin(r('b', { description: 'Fuel (from Google Drive)' }))).toBe('from Drive');
    expect(receiptOrigin(r('c', { mime: 'text/plain; charset=utf-8', filename: 'Order.txt' }))).toBe('from your email');
    expect(receiptOrigin(r('d', {}))).toBe('you snapped it');
  });
});
