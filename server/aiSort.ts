import { anthropicClient } from './anthropic.js';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema.mjs';
import { CATEGORIES, isCategory } from '../src/core/hmrc.js';
import type { Bucket, ExpenseCategory, Receipt, Rule, Stream, Transaction } from '../src/core/types.js';

// First-pass sorting of the bank backlog by Claude. It never has the last word: every row it
// sorts is marked classifiedBy 'ai' and waits in the "AI-sorted: check" list until you
// confirm or change it. It learns from what you've already sorted yourself.

// Small batches at high effort: each line gets real thought, and a request stays well inside
// the function's time limit.
export const AI_SORT_BATCH = 20;

export interface AiDecision {
  id: string;
  bucket: Exclude<Bucket, 'unreviewed'>;
  streamId: string | null;
  category: ExpenseCategory | null;
  businessPercent: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

const BUCKETS = ['business_income', 'business_expense', 'personal', 'transfer'] as const;

function schema(streamIds: string[]) {
  return {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            bucket: { type: 'string', enum: [...BUCKETS] },
            streamId: { type: 'string', enum: [...streamIds, ''] },
            category: { type: 'string', enum: [...CATEGORIES.map((c) => c.key), ''] },
            businessPercent: { type: 'integer' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            reason: { type: 'string' },
          },
          required: ['id', 'bucket', 'streamId', 'category', 'businessPercent', 'confidence', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['results'],
    additionalProperties: false,
  } as const;
}

// Notes the app writes itself say nothing about what the money was for.
const SYSTEM_NOTE = /^Imported from Honey — not found in the bank feed/;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Everything the app knows about a line, on one row: the bank's text, your words, the receipt. */
const line = (t: Transaction, receipts: readonly Receipt[] = []) =>
  [
    t.id,
    t.date,
    t.direction === 'in' ? `IN £${(t.amountPence / 100).toFixed(2)}` : `OUT £${(t.amountPence / 100).toFixed(2)}`,
    `payee/payer: ${t.counterparty || '-'}`,
    `ref: ${t.reference || '-'}`,
    t.meta.starlingSource ? `via ${t.meta.starlingSource}` : '',
    t.meta.spendingCategory ? `bank category ${t.meta.spendingCategory}` : '',
    t.meta.account ? `account ${t.meta.account}` : '',
    t.source === 'import' ? 'recorded in their old app' : '',
    t.meta.importedFrom && t.source !== 'import' ? 'also recorded in their old app' : '',
    t.note && !SYSTEM_NOTE.test(t.note) ? `their description: "${clip(t.note, 200)}"` : '',
    ...receipts.map((r) =>
      `receipt: ${[r.merchant, r.description.startsWith('Imported from Honey') ? '' : r.description, r.suggestedCategory ? `looks like ${r.suggestedCategory}` : ''].filter(Boolean).join(', ') || 'attached'}`,
    ),
    t.bucket !== 'unreviewed' ? `already known: ${t.bucket.replace('_', ' ')}${t.category ? ` (${t.category})` : ''} — needs a stream` : '',
  ]
    .filter(Boolean)
    .join(' | ');

function buildPrompt(batch: Transaction[], streams: Stream[], rules: Rule[], examples: Transaction[], receipts: readonly Receipt[]): string {
  const streamList = streams
    .filter((s) => !s.archived)
    .map((s) => `- ${s.id}: "${s.name}" (${s.kind === 'other' ? 'tracked, not self-employment' : 'self-employment'})${s.about ? ` — ${clip(s.about, 600)}` : ''}`);
  const receiptsFor = (t: Transaction) => receipts.filter((r) => r.transactionId === t.id);
  const categoryList = CATEGORIES.map((c) => `- ${c.key}: ${c.label} — ${c.hint}${c.disallowable ? ' (never tax-deductible)' : ''}`);
  const ruleList = rules.map((r) => `- ${r.field} contains "${r.pattern}"${r.direction ? ` (${r.direction})` : ''} → ${r.bucket}${r.streamId ? ` stream ${r.streamId}` : ''}${r.category ? ` ${r.category}` : ''}`);
  const exampleList = examples.map((t) => `- ${line(t, receiptsFor(t)).split(' | ').slice(1).join(' | ')} → ${t.bucket}${t.streamId ? ` stream ${t.streamId}` : ''}${t.category ? ` ${t.category}` : ''}${t.bucket === 'business_expense' && t.businessPercent !== 100 ? ` ${t.businessPercent}%` : ''}`);

  return `You are sorting a UK sole trader's bank transactions for their Self Assessment tax records. They have several self-employed income streams and also use this account personally.

For each transaction, decide:
- bucket: business_income (money earned from their self-employed work), business_expense (a cost wholly or partly for the work), personal (their own spending, wages from a job, gifts, refunds of personal purchases), or transfer (moving money between their own accounts or savings pots, card repayments).
- streamId: which income stream it belongs to, for business rows only (else "").
- category: for business_expense only, the HMRC category key (else "").
- businessPercent: for business_expense, the share that's business use (100 unless it's clearly mixed, e.g. a phone contract); 100 otherwise.
- confidence: high only when it's obvious; low when you're guessing — the person will check low ones first.
- reason: a few words explaining the choice.

Some rows are already known to be business income or costs (the person recorded them as business in their old app) and only need the right stream: choose it from who paid, what the work was, their description and any receipt.

Their own description of a line, and what's on its receipt, are the best evidence of what it was for — weigh them above the bank's payee name. Match each stream against its description above. Where they've sorted the same payee or payer before, follow that unless the details clearly differ.

When unsure whether something is business, prefer personal with low confidence — claiming a personal cost as business is the more harmful mistake. Money arriving from a person or company that isn't the account holder, especially with an invoice number or reference, is usually business income.

Income streams:
${streamList.join('\n') || '- (none set up yet — use "")'}

HMRC expense categories:
${categoryList.join('\n')}

${ruleList.length ? `Their standing rules (they chose these):\n${ruleList.join('\n')}\n` : ''}${exampleList.length ? `How they've sorted similar transactions before — follow their pattern:\n${exampleList.join('\n')}\n` : ''}
Transactions to sort (id | date | amount | details):
${batch.map((t) => line(t, receiptsFor(t))).join('\n')}

Return one result for every transaction id above.`;
}

export async function aiSortBatch(
  batch: Transaction[],
  streams: Stream[],
  rules: Rule[],
  examples: Transaction[],
  receipts: readonly Receipt[] = [],
  client = anthropicClient(),
): Promise<AiDecision[]> {
  if (!batch.length) return [];
  const streamIds = streams.filter((s) => !s.archived).map((s) => s.id);
  const response = await client.beta.messages.parse({
    model: process.env.AI_SORT_MODEL?.trim() || 'claude-opus-5-5',
    max_tokens: 16000,
    // Getting a tax record wrong costs more than the extra thinking: high effort.
    output_config: { effort: 'high', format: betaJSONSchemaOutputFormat(schema(streamIds)) },
    messages: [{ role: 'user', content: buildPrompt(batch, streams, rules, examples, receipts) }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error(response.stop_reason === 'max_tokens' ? 'The AI ran out of room on this batch — try again.' : 'The AI declined this batch.');
  }
  return validate(response.parsed_output.results, batch, streamIds);
}

/** Only well-formed decisions for rows that were actually in the batch survive. */
export function validate(results: readonly Record<string, unknown>[], batch: Transaction[], streamIds: string[]): AiDecision[] {
  const inBatch = new Map(batch.map((t) => [t.id, t]));
  const out: AiDecision[] = [];
  for (const r of results) {
    const t = inBatch.get(String(r.id));
    if (!t || !(BUCKETS as readonly string[]).includes(String(r.bucket))) continue;
    inBatch.delete(t.id); // one decision per row
    const bucket = r.bucket as AiDecision['bucket'];
    const business = bucket === 'business_income' || bucket === 'business_expense';
    const streamId = business && streamIds.includes(String(r.streamId)) ? String(r.streamId) : null;
    const category = bucket === 'business_expense' ? (isCategory(r.category) ? r.category : 'otherExpenses') : null;
    const pct = Number(r.businessPercent);
    out.push({
      id: t.id,
      bucket,
      streamId,
      category,
      businessPercent: bucket === 'business_expense' && Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 100,
      confidence: r.confidence === 'high' || r.confidence === 'medium' ? r.confidence : 'low',
      reason: String(r.reason ?? '').slice(0, 200),
    });
  }
  return out;
}

/**
 * Your own decisions, one per counterparty, as examples for the model to follow — the ones you
 * made here first, then the ones carried over from the old app (also yours, just made there).
 */
export function pickExamples(txns: readonly Transaction[], max = 60, batch: readonly Transaction[] = []): Transaction[] {
  const seen = new Set<string>();
  const out: Transaction[] = [];
  const mine = (t: Transaction) => t.classifiedBy === 'user' || t.classifiedBy === 'import';
  // Past decisions about the same payees as this batch come first — they're the most telling.
  const who = (t: Transaction) => (t.counterparty || t.reference).toLowerCase();
  const inBatch = new Set(batch.map(who));
  const byOwner = [...txns.filter((t) => t.classifiedBy === 'user'), ...txns.filter((t) => t.classifiedBy === 'import')];
  const ordered = [...byOwner.filter((t) => inBatch.has(who(t))), ...byOwner.filter((t) => !inBatch.has(who(t)))];
  for (const t of ordered) {
    if (!mine(t) || t.bucket === 'unreviewed' || !(t.counterparty || t.reference)) continue;
    // An import whose stream is missing or being re-chosen would teach the wrong stream.
    const business = t.bucket === 'business_income' || t.bucket === 'business_expense';
    if (t.classifiedBy === 'import' && business && (!t.streamId || t.meta.aiRestream === '1')) continue;
    const key = `${t.direction}:${who(t)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

type Change = Record<string, { from?: unknown; to?: unknown }>;
const FIELDS = ['bucket', 'streamId', 'category', 'businessPercent'] as const;

export interface AiUndo {
  id: string;
  patch: Partial<Pick<Transaction, 'bucket' | 'streamId' | 'category' | 'businessPercent' | 'classifiedBy'>> & { meta: Record<string, string> };
}

/**
 * Rewind the AI's sorting using the change log: each row the AI decided goes back to exactly how
 * it was before. A row you changed by hand after the AI (a different bucket, stream, category or
 * %) is yours and stays; one you only confirmed as it was ("confirm all") is rewound.
 */
export function planAiUndo(
  txns: readonly Transaction[],
  updates: readonly { transactionId: string; detail: Change }[],
): { undo: AiUndo[]; kept: number } {
  const byTxn = new Map<string, Change[]>();
  for (const u of updates) byTxn.set(u.transactionId, [...(byTxn.get(u.transactionId) ?? []), u.detail]);
  const undo: AiUndo[] = [];
  let kept = 0;
  for (const t of txns) {
    const log = byTxn.get(t.id) ?? [];
    const first = log.findIndex((d) => d.classifiedBy?.to === 'ai');
    if (first < 0) continue;
    // Walk forward from the AI's first decision, tracking who owns the row at each step.
    let owner: unknown = 'ai';
    let byHand = false;
    const before: Record<string, unknown> = {};
    for (const d of log.slice(first)) {
      if (d.classifiedBy) owner = d.classifiedBy.to;
      const touches = FIELDS.some((f) => f in d);
      if (touches && owner !== 'ai') { byHand = true; break; }
      // The earliest "from" of each field is how it was before the AI.
      for (const f of [...FIELDS, 'classifiedBy'] as const) if (d[f] && !(f in before)) before[f] = d[f]!.from;
    }
    if (byHand) { kept++; continue; }
    const aiMeta = (log[first]!.meta?.from ?? {}) as Record<string, string>;
    undo.push({
      id: t.id,
      patch: {
        ...(before as AiUndo['patch']),
        meta: { aiReason: '', aiConfidence: '', aiTried: '', aiRestream: aiMeta.aiRestream ?? '' },
      },
    });
  }
  return { undo, kept };
}
