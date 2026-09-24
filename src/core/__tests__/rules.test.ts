import { describe, it, expect } from 'vitest';
import { findRule, applyRule, suggestPattern } from '../rules.js';
import type { Rule } from '../types.js';
import { txn } from './fixtures.js';

const rule = (over: Partial<Rule>): Rule => ({
  id: 'r',
  field: 'counterparty',
  pattern: 'amazon',
  direction: null,
  bucket: 'business_expense',
  streamId: 's1',
  category: 'adminCosts',
  businessPercent: 100,
  createdAt: '',
  ...over,
});

describe('rules', () => {
  it('picks the most specific matching rule', () => {
    const general = rule({ id: 'g', pattern: 'amazon' });
    const specific = rule({ id: 'p', pattern: 'amazon prime', bucket: 'personal' });
    const t = txn({ counterparty: 'AMAZON PRIME UK', direction: 'out' });
    expect(findRule([general, specific], t)?.id).toBe('p');
  });
  it('respects direction', () => {
    const r = rule({ direction: 'in' });
    expect(findRule([r], txn({ counterparty: 'Amazon', direction: 'out' }))).toBeNull();
  });
  it('never overrides a row you already classified', () => {
    const t = txn({ bucket: 'personal', counterparty: 'Amazon' });
    expect(applyRule(rule({}), t)).toBe(t);
  });
  it('clears expense-only fields for non-expense buckets', () => {
    const out = applyRule(rule({ bucket: 'transfer', category: 'adminCosts' }), txn());
    expect(out.category).toBeNull();
    expect(out.streamId).toBeNull();
    expect(out.classifiedBy).toBe('rule');
  });
  it('suggests a pattern without store numbers', () => {
    expect(suggestPattern({ counterparty: 'TESCO STORES 3021', reference: '' })).toEqual({ field: 'counterparty', pattern: 'tesco stores' });
  });
});
