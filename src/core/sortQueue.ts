import type { Bucket, ExpenseCategory, Receipt, Rule, Settings, Stream, Transaction } from './types.js';
import { receiptsFor } from './receiptMatch.js';

// The sort deck: one card at a time, swipe right for business, left for not. This file decides
// which rows are waiting, in what order, what each swipe would make of a row, and which other
// rows are "the same thing" — so sorting one can sort them all.

/** A row still waiting for you: never sorted, sorted by the AI and not yet checked, or business with no stream. */
export function needsDecision(t: Transaction, hasStreams: boolean): boolean {
  if (t.bucket === 'unreviewed') return true;
  if (t.classifiedBy === 'ai') return true;
  const business = t.bucket === 'business_income' || t.bucket === 'business_expense';
  return hasStreams && business && !t.streamId;
}

export const isNotBusiness = (t: Transaction) => t.bucket === 'personal' || t.bucket === 'transfer';

// Card processors put their own name in front of the shop's ("SQ *COFFEE HOUSE", "PAYPAL *ZOOM").
// Grouping on the processor would lump every square-card café together, so it's taken off.
const PROCESSOR = /^(sq|sumup|paypal|pp|iz|izettle|zettle|sp|stripe|gc|klarna|crv|tst|sagepay|pos)\s*[*_]\s*/i;
const COMPANY_SUFFIX = /\b(ltd|limited|plc|llp|inc)\b\.?/g;

function payee(t: Pick<Transaction, 'counterparty' | 'reference'>): string {
  return (t.counterparty || t.reference || '').toLowerCase().replace(PROCESSOR, '');
}

/**
 * What makes two rows "the same thing": money moving the same way, to or from the same payee
 * once store numbers, card suffixes and "Ltd" are ignored. Null when there's too little to go on.
 */
export function similarKey(t: Pick<Transaction, 'counterparty' | 'reference' | 'direction'>): string | null {
  const name = payee(t)
    .replace(COMPANY_SUFFIX, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z&' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name.length >= 3 ? `${t.direction}:${name}` : null;
}

/**
 * The text a rule should look for so future rows from the same payee are caught: the payee up to
 * its first number, since what follows (store numbers, dates) changes from visit to visit.
 * Rules match on a plain "contains", so this has to be a real stretch of the bank's text.
 */
export function rulePattern(t: Pick<Transaction, 'counterparty' | 'reference'>): { field: Rule['field']; pattern: string } | null {
  const field: Rule['field'] = t.counterparty ? 'counterparty' : 'reference';
  const pattern = payee(t).split(/\d/)[0]!.replace(/[\s*#.,/-]+$/g, '').trim();
  return pattern.length >= 3 ? { field, pattern } : null;
}

// Words too vague to match a payee on by themselves ("THE WORKS" isn't every "the").
const VAGUE = new Set(['the', 'and', 'www', 'uk', 'gb', 'ltd', 'shop', 'store', 'card', 'payment', 'online', 'pay', 'to', 'from']);

/**
 * How widely a swipe can match, narrowest last: the payee's words one more at a time —
 * "lidl", "lidl gb", "lidl gb bristol" — so one choice can catch every branch of a chain.
 */
export function patternChoices(t: Pick<Transaction, 'counterparty' | 'reference'>): string[] {
  const p = rulePattern(t);
  if (!p) return [];
  const words = p.pattern.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i <= words.length; i++) {
    const s = words.slice(0, i).join(' ');
    if (s.length < 3 || (i === 1 && VAGUE.has(s))) continue;
    out.push(s);
  }
  return out.length ? out : [p.pattern];
}

/** The rows a rule looking for `pattern` would catch — money moving the same way, payee containing it. */
export function findMatching<T extends Transaction>(t: Transaction, pool: readonly T[], p: { field: Rule['field']; pattern: string }): T[] {
  const needle = p.pattern.trim().toLowerCase();
  if (!needle) return [];
  return pool.filter((x) => x.id !== t.id && x.direction === t.direction && (p.field === 'counterparty' ? x.counterparty : x.reference).toLowerCase().includes(needle));
}

export function findSimilar<T extends Transaction>(t: Transaction, pool: readonly T[]): T[] {
  const key = similarKey(t);
  if (!key) return [];
  return pool.filter((x) => x.id !== t.id && similarKey(x) === key);
}

/**
 * The order cards come in: the biggest group of similar rows first — sorting a client who paid
 * thirty times clears thirty cards in one swipe, so the pile shrinks fastest — then newest first.
 */
export function orderQueue<T extends Transaction>(rows: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const t of rows) {
    const key = similarKey(t) ?? `solo:${t.id}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const newest = (g: T[]) => g.reduce((d, t) => (t.date > d ? t.date : d), '');
  return [...groups.values()]
    .map((g) => [...g].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)))
    .sort((a, b) => b.length - a.length || newest(b).localeCompare(newest(a)))
    .flat();
}

export interface Decision {
  bucket: Exclude<Bucket, 'unreviewed'>;
  streamId: string | null;
  category: ExpenseCategory | null;
}

export interface Prediction {
  /** Swipe right: business income if money came in, a business cost if it went out. */
  right: Decision;
  /** Swipe left: not business — personal. (Moves between Starling Spaces never reach the deck.) */
  left: Decision;
  /** Looks like pay from a job (payroll), which isn't self-employed income at all. */
  looksLikeWages: boolean;
  /** An unattached receipt (emailed or snapped) that matches this line, to attach with the swipe. */
  receipt: Receipt | null;
  /** Why it's a cost of your work, from its receipt — written into the note when swiped as business. */
  why: string;
}

export interface PredictContext {
  streams: readonly Stream[];
  settings: Pick<Settings, 'name' | 'profile' | 'cstlStreamId'>;
  receipts: readonly Receipt[];
  /** Everything else in the ledger — past decisions teach the guesses. */
  history: readonly Transaction[];
  lastStreamId?: string | null;
}

const WAGES = /\b(wages?|salary|salaries|payroll|net ?pay|pay ?slip|pay ?roll)\b/i;

export function predict(t: Transaction, ctx: PredictContext): Prediction {
  const active = ctx.streams.filter((s) => !s.archived);
  const activeIds = new Set(active.map((s) => s.id));
  const key = similarKey(t);
  // What you decided last time for the same payee, if you've sorted one before.
  const past = key
    ? ctx.history
        .filter((x) => x.id !== t.id && x.classifiedBy === 'user' && (x.bucket === 'business_income' || x.bucket === 'business_expense') && similarKey(x) === key)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    : undefined;

  const attachedAny = ctx.receipts.find((r) => r.transactionId === t.id);
  const found0 = t.receiptIds.length ? null : receiptsFor(t, ctx.receipts)[0] ?? null;
  const readStream = (attachedAny ?? found0)?.suggestedStreamId ?? null;
  const stream =
    (t.streamId && activeIds.has(t.streamId) ? t.streamId : null) ??
    (active.length === 1 ? active[0]!.id : null) ??
    // The receipt reader, knowing what you've said about your work, named the stream.
    (t.direction === 'out' && readStream && activeIds.has(readStream) ? readStream : null) ??
    (past?.streamId && activeIds.has(past.streamId) ? past.streamId : null) ??
    (t.meta.cstlBookingId && ctx.settings.cstlStreamId && activeIds.has(ctx.settings.cstlStreamId) ? ctx.settings.cstlStreamId : null) ??
    (ctx.lastStreamId && activeIds.has(ctx.lastStreamId) ? ctx.lastStreamId : null);

  const attached = ctx.receipts.find((r) => r.transactionId === t.id && r.suggestedCategory);
  const found = found0;
  const category: ExpenseCategory | null =
    t.direction === 'out'
      ? (t.bucket === 'business_expense' ? t.category : null) ??
        attached?.suggestedCategory ??
        found?.suggestedCategory ??
        (past?.bucket === 'business_expense' ? past.category : null) ??
        null
      : null;

  return {
    right: { bucket: t.direction === 'in' ? 'business_income' : 'business_expense', streamId: stream, category },
    left: { bucket: 'personal', streamId: null, category: null },
    looksLikeWages: t.direction === 'in' && WAGES.test(`${t.counterparty} ${t.reference}`),
    receipt: found,
    why: t.direction === 'out' ? (attachedAny ?? found)?.why || '' : '',
  };
}
