import { describe, it, expect } from 'vitest';
import { findMatching, findSimilar, needsDecision, orderQueue, patternChoices, predict, rulePattern, similarKey, type PredictContext } from '../sortQueue.js';
import { ruleMatches } from '../rules.js';
import { DEFAULT_SETTINGS, type Stream } from '../types.js';
import { txn } from './fixtures.js';

const stream = (id: string, over: Partial<Stream> = {}): Stream => ({ id, name: id, kind: 'self_employment', color: '#fff', archived: false, about: '', lateFees: false, ...over });
const ctx = (over: Partial<PredictContext> = {}): PredictContext => ({
  streams: [stream('practice'), stream('coffee')],
  settings: { ...DEFAULT_SETTINGS, profile: { ...DEFAULT_SETTINGS.profile, name: 'Phoenix Tanner' } },
  receipts: [],
  history: [],
  ...over,
});

describe('what is waiting', () => {
  it('holds unsorted rows, AI guesses to check, and business rows missing a stream', () => {
    expect(needsDecision(txn(), true)).toBe(true);
    expect(needsDecision(txn({ bucket: 'personal', classifiedBy: 'ai' }), true)).toBe(true);
    expect(needsDecision(txn({ bucket: 'business_income', classifiedBy: 'import' }), true)).toBe(true);
    expect(needsDecision(txn({ bucket: 'business_income', classifiedBy: 'import' }), false)).toBe(false); // no streams to pick from
    expect(needsDecision(txn({ bucket: 'personal', classifiedBy: 'user' }), true)).toBe(false);
    expect(needsDecision(txn({ bucket: 'business_expense', streamId: 'practice', classifiedBy: 'rule' }), true)).toBe(false);
  });
});

describe('similar rows', () => {
  it('groups the same payee across store numbers, card processors and Ltd', () => {
    const a = similarKey(txn({ counterparty: 'TESCO STORES 3021', direction: 'out' }));
    expect(a).toBe(similarKey(txn({ counterparty: 'Tesco Stores 118', direction: 'out' })));
    expect(similarKey(txn({ counterparty: 'SQ *COFFEE HOUSE', direction: 'out' }))).toBe('out:coffee house');
    expect(similarKey(txn({ counterparty: 'ETHICAL CAFF LTD', direction: 'in' }))).toBe(similarKey(txn({ counterparty: 'Ethical Caff Limited', direction: 'in' })));
  });
  it('never lumps different shops behind one processor, or money in with money out', () => {
    expect(similarKey(txn({ counterparty: 'PAYPAL *ZOOM', direction: 'out' }))).not.toBe(similarKey(txn({ counterparty: 'PAYPAL *EBAY', direction: 'out' })));
    expect(similarKey(txn({ counterparty: 'Sarah Jones', direction: 'in' }))).not.toBe(similarKey(txn({ counterparty: 'Sarah Jones', direction: 'out' })));
  });
  it('has nothing to group on for a blank or two-letter payee', () => {
    expect(similarKey(txn({ counterparty: '', reference: '' }))).toBeNull();
    expect(similarKey(txn({ counterparty: 'AB 12' }))).toBeNull();
  });
  it('finds the others, not itself', () => {
    const a = txn({ counterparty: 'Lara Bligh', direction: 'in' });
    const b = txn({ counterparty: 'LARA BLIGH', direction: 'in' });
    const c = txn({ counterparty: 'Someone Else', direction: 'in' });
    expect(findSimilar(a, [a, b, c]).map((t) => t.id)).toEqual([b.id]);
  });
});

describe('rules made from a swipe', () => {
  it('look for the payee up to its first number, so the next visit still matches', () => {
    const p = rulePattern(txn({ counterparty: 'TFL TRAVEL CH 1234 LONDON' }))!;
    expect(p).toEqual({ field: 'counterparty', pattern: 'tfl travel ch' });
    const rule = { id: 'r', ...p, direction: null, bucket: 'personal' as const, streamId: null, category: null, businessPercent: 100, createdAt: '' };
    expect(ruleMatches(rule, txn({ counterparty: 'TFL TRAVEL CH 9876 LONDON' }))).toBe(true);
  });
  it('drop the card processor, and refuse a pattern too short to be safe', () => {
    expect(rulePattern(txn({ counterparty: 'PAYPAL *ZOOM.US 888' }))?.pattern).toBe('zoom.us');
    expect(rulePattern(txn({ counterparty: '12345' }))).toBeNull();
  });
});

describe('widening a match to every branch', () => {
  it('offers the payee’s words one more at a time, never a vague word alone', () => {
    expect(patternChoices(txn({ counterparty: 'LIDL GB BRISTOL 4471' }))).toEqual(['lidl', 'lidl gb', 'lidl gb bristol']);
    expect(patternChoices(txn({ counterparty: 'THE WORKS 223' }))).toEqual(['the works']);
    expect(patternChoices(txn({ counterparty: 'SQ *COFFEE HOUSE' }))).toEqual(['coffee', 'coffee house']);
    expect(patternChoices(txn({ counterparty: 'Tesco' }))).toEqual(['tesco']);
  });
  it('finds every waiting row the chosen words would catch, going the same way', () => {
    const card = txn({ counterparty: 'LIDL GB BRISTOL', direction: 'out' });
    const bath = txn({ counterparty: 'LIDL GB BATH', direction: 'out' });
    const refund = txn({ counterparty: 'LIDL GB BATH', direction: 'in' });
    const other = txn({ counterparty: 'ALDI STORES', direction: 'out' });
    expect(findSimilar(card, [bath, refund, other])).toEqual([]); // different branch: not "the same payee"
    expect(findMatching(card, [card, bath, refund, other], { field: 'counterparty', pattern: 'lidl' }).map((t) => t.id)).toEqual([bath.id]);
  });
});

describe('order', () => {
  it('puts the biggest group first, then the newest', () => {
    const one = txn({ counterparty: 'Solo Shop', date: '2026-06-01', direction: 'out' });
    const g1 = txn({ counterparty: 'Client A', date: '2026-04-01' });
    const g2 = txn({ counterparty: 'CLIENT A', date: '2026-05-01' });
    expect(orderQueue([one, g1, g2]).map((t) => t.id)).toEqual([g2.id, g1.id, one.id]);
  });
});

describe('what a swipe would do', () => {
  it('right: income or cost by direction; left: personal', () => {
    const p = predict(txn({ direction: 'out', counterparty: 'Boots' }), ctx());
    expect(p.right.bucket).toBe('business_expense');
    expect(p.left.bucket).toBe('personal');
    expect(predict(txn({ direction: 'in' }), ctx()).right.bucket).toBe('business_income');
  });
  it('left is always personal — money between your own accounts included', () => {
    expect(predict(txn({ counterparty: 'Phoenix Tanner', reference: 'Selfpay' }), ctx()).left.bucket).toBe('personal');
  });
  it('finds an emailed or snapped receipt for a cost, and takes its category from it', () => {
    const t = txn({ direction: 'out', amountPence: 1200, date: '2026-09-10', counterparty: 'FACEBK *ADS' });
    const r = (over: object) => ({ id: 'r', uploadedAt: '', filename: 'email.txt', mime: 'text/plain', merchant: 'Meta', date: '2026-09-08', totalPence: 1200, vatPence: null, suggestedCategory: 'advertisingCosts' as const, description: '', transactionId: null, ...over });
    const p = predict(t, ctx({ receipts: [r({ id: 'far', date: '2026-08-01' }), r({ id: 'wrong', totalPence: 999 }), r({ id: 'taken', transactionId: 'x' }), r({ id: 'ok' })] }));
    expect(p.receipt?.id).toBe('ok');
    expect(p.right.category).toBe('advertisingCosts');
    expect(predict({ ...t, direction: 'in' }, ctx({ receipts: [r({})] })).receipt).toBeNull();
  });
  it('takes the stream and the reason from what the receipt reader made of it', () => {
    const t = txn({ direction: 'out', amountPence: 4550, date: '2026-09-27', counterparty: 'SHELL 334' });
    const receipt = { id: 'r', uploadedAt: '', filename: 'p.jpg', mime: 'image/jpeg', merchant: 'Shell', date: '2026-09-27', totalPence: 4550, vatPence: null, suggestedCategory: 'carVanTravelExpenses' as const, description: '', transactionId: null, suggestedStreamId: 'practice', why: 'Fuel to clients' };
    const p = predict(t, ctx({ receipts: [receipt], lastStreamId: 'coffee' }));
    expect(p.right).toMatchObject({ streamId: 'practice', category: 'carVanTravelExpenses' });
    expect(p.why).toBe('Fuel to clients');
  });
  it('guesses the stream and category from what you did last time for the same payee', () => {
    const before = txn({ counterparty: 'WHR Consulting Ltd', direction: 'out', bucket: 'business_expense', streamId: 'practice', category: 'premisesRunningCosts', classifiedBy: 'user' });
    const p = predict(txn({ counterparty: 'WHR CONSULTING LTD', direction: 'out' }), ctx({ history: [before] }));
    expect(p.right).toMatchObject({ streamId: 'practice', category: 'premisesRunningCosts' });
  });
  it('uses a receipt’s category, and the only stream when there is one', () => {
    const t = txn({ direction: 'out' });
    const receipt = { id: 'r1', uploadedAt: '', filename: '', mime: 'image/jpeg', merchant: '', date: null, totalPence: null, vatPence: null, suggestedCategory: 'adminCosts' as const, description: '', transactionId: t.id };
    const p = predict(t, ctx({ streams: [stream('practice'), stream('old', { archived: true })], receipts: [receipt] }));
    expect(p.right).toMatchObject({ streamId: 'practice', category: 'adminCosts' });
  });
  it('flags pay from a payroll job', () => {
    expect(predict(txn({ direction: 'in', counterparty: 'C&B HOSPITALITY LI', reference: 'SEVENTE WAGES' }), ctx()).looksLikeWages).toBe(true);
    expect(predict(txn({ direction: 'in', counterparty: 'Ethical Caff Ltd', reference: 'INV PTF13' }), ctx()).looksLikeWages).toBe(false);
  });
});
