import type { Rule, Transaction } from './types.js';

// "Whenever it's from X, it's Y." Rules turn the weekly review from classifying every line
// into glancing at the few new ones. The most specific rule wins (longest pattern), so a
// general "AMAZON → office" can be overridden by "AMAZON PRIME → personal".

export function ruleMatches(rule: Rule, t: Pick<Transaction, 'counterparty' | 'reference' | 'direction'>): boolean {
  const pattern = rule.pattern.trim().toLowerCase();
  if (!pattern) return false;
  if (rule.direction && rule.direction !== t.direction) return false;
  const haystack = (rule.field === 'counterparty' ? t.counterparty : t.reference).toLowerCase();
  return haystack.includes(pattern);
}

export function findRule(
  rules: readonly Rule[],
  t: Pick<Transaction, 'counterparty' | 'reference' | 'direction'>,
): Rule | null {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!ruleMatches(r, t)) continue;
    if (!best || r.pattern.trim().length > best.pattern.trim().length) best = r;
  }
  return best;
}

/** Apply a rule to an unreviewed row. Rows you've classified yourself are never touched. */
export function applyRule<T extends Transaction>(rule: Rule, t: T): T {
  if (t.bucket !== 'unreviewed') return t;
  return {
    ...t,
    bucket: rule.bucket,
    streamId: rule.bucket === 'business_income' || rule.bucket === 'business_expense' ? rule.streamId : null,
    category: rule.bucket === 'business_expense' ? rule.category : null,
    businessPercent: rule.bucket === 'business_expense' ? rule.businessPercent : 100,
    classifiedBy: 'rule',
  };
}

/**
 * A sensible pattern to offer when you tap "always do this": the counterparty for card
 * spends and most transfers, stripped of the store numbers and card suffixes that vary
 * between visits ("TESCO STORES 3021" → "tesco stores").
 */
export function suggestPattern(t: Pick<Transaction, 'counterparty' | 'reference'>): { field: Rule['field']; pattern: string } {
  const base = (t.counterparty || t.reference).toLowerCase();
  const cleaned = base
    .replace(/[*#].*$/, '')
    .replace(/\b\d[\d\s-]*\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { field: t.counterparty ? 'counterparty' : 'reference', pattern: cleaned || base.trim() };
}
