import type { Bucket, ExpenseCategory, Receipt, Rule, Settings, Stream, Transaction } from './types.js';

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
  /** Swipe left: not business — a transfer between your own accounts, or personal. */
  left: Decision;
  /** Why the left swipe is a transfer, when it is. */
  transferReason: string | null;
  /** Looks like pay from a job (payroll), which isn't self-employed income at all. */
  looksLikeWages: boolean;
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

/** Your own name, as the bank tends to write it — money from or to it is a move between your accounts. */
function ownNames(settings: PredictContext['settings']): string[] {
  const names = [settings.profile?.name, settings.name].map((n) => (n ?? '').trim().toLowerCase()).filter((n) => n.length >= 4);
  return [...new Set(names)];
}

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

  const stream =
    (t.streamId && activeIds.has(t.streamId) ? t.streamId : null) ??
    (active.length === 1 ? active[0]!.id : null) ??
    (past?.streamId && activeIds.has(past.streamId) ? past.streamId : null) ??
    (t.meta.cstlBookingId && ctx.settings.cstlStreamId && activeIds.has(ctx.settings.cstlStreamId) ? ctx.settings.cstlStreamId : null) ??
    (ctx.lastStreamId && activeIds.has(ctx.lastStreamId) ? ctx.lastStreamId : null);

  const receipt = ctx.receipts.find((r) => r.transactionId === t.id && r.suggestedCategory);
  const category: ExpenseCategory | null =
    t.direction === 'out'
      ? (t.bucket === 'business_expense' ? t.category : null) ?? receipt?.suggestedCategory ?? (past?.bucket === 'business_expense' ? past.category : null) ?? null
      : null;

  const who = `${t.counterparty} ${t.reference}`.toLowerCase();
  const ownName = ownNames(ctx.settings).find((n) => who.includes(n));
  const transferReason =
    t.meta.starlingSource === 'INTERNAL_TRANSFER' ? 'a move between your Starling Spaces'
    : ownName ? 'money to or from your own name'
    : null;

  return {
    right: { bucket: t.direction === 'in' ? 'business_income' : 'business_expense', streamId: stream, category },
    left: { bucket: transferReason ? 'transfer' : 'personal', streamId: null, category: null },
    transferReason,
    looksLikeWages: t.direction === 'in' && WAGES.test(`${t.counterparty} ${t.reference}`),
  };
}
