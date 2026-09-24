import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema.mjs';
import { CATEGORIES, isCategory } from '../src/core/hmrc.js';
import type { Bucket, ExpenseCategory, Rule, Stream, Transaction } from '../src/core/types.js';

// First-pass sorting of the bank backlog by Claude. It never has the last word: every row it
// sorts is marked classifiedBy 'ai' and waits in the "AI-sorted: check" list until you
// confirm or change it. It learns from what you've already sorted yourself.

export const AI_SORT_BATCH = 40;

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

const line = (t: Transaction) =>
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
    t.bucket !== 'unreviewed' ? `already known: ${t.bucket.replace('_', ' ')}${t.category ? ` (${t.category})` : ''} — needs a stream` : '',
  ]
    .filter(Boolean)
    .join(' | ');

function buildPrompt(batch: Transaction[], streams: Stream[], rules: Rule[], examples: Transaction[]): string {
  const streamList = streams.filter((s) => !s.archived).map((s) => `- ${s.id}: "${s.name}" (${s.kind === 'other' ? 'tracked, not self-employment' : 'self-employment'})`);
  const categoryList = CATEGORIES.map((c) => `- ${c.key}: ${c.label} — ${c.hint}${c.disallowable ? ' (never tax-deductible)' : ''}`);
  const ruleList = rules.map((r) => `- ${r.field} contains "${r.pattern}"${r.direction ? ` (${r.direction})` : ''} → ${r.bucket}${r.streamId ? ` stream ${r.streamId}` : ''}${r.category ? ` ${r.category}` : ''}`);
  const exampleList = examples.map((t) => `- ${line(t).split(' | ').slice(1).join(' | ')} → ${t.bucket}${t.streamId ? ` stream ${t.streamId}` : ''}${t.category ? ` ${t.category}` : ''}${t.bucket === 'business_expense' && t.businessPercent !== 100 ? ` ${t.businessPercent}%` : ''}`);

  return `You are sorting a UK sole trader's bank transactions for their Self Assessment tax records. They have several self-employed income streams and also use this account personally.

For each transaction, decide:
- bucket: business_income (money earned from their self-employed work), business_expense (a cost wholly or partly for the work), personal (their own spending, wages from a job, gifts, refunds of personal purchases), or transfer (moving money between their own accounts or savings pots, card repayments).
- streamId: which income stream it belongs to, for business rows only (else "").
- category: for business_expense only, the HMRC category key (else "").
- businessPercent: for business_expense, the share that's business use (100 unless it's clearly mixed, e.g. a phone contract); 100 otherwise.
- confidence: high only when it's obvious; low when you're guessing — the person will check low ones first.
- reason: a few words explaining the choice.

Some rows are already known to be business income or costs and only need the right stream (and category): keep them as business unless clearly not, and choose the stream from who paid and what the work was.

When unsure whether something is business, prefer personal with low confidence — claiming a personal cost as business is the more harmful mistake. Money arriving from a person or company that isn't the account holder, especially with an invoice number or reference, is usually business income.

Income streams:
${streamList.join('\n') || '- (none set up yet — use "")'}

HMRC expense categories:
${categoryList.join('\n')}

${ruleList.length ? `Their standing rules (they chose these):\n${ruleList.join('\n')}\n` : ''}${exampleList.length ? `How they've sorted similar transactions before — follow their pattern:\n${exampleList.join('\n')}\n` : ''}
Transactions to sort (id | date | amount | details):
${batch.map(line).join('\n')}

Return one result for every transaction id above.`;
}

export async function aiSortBatch(
  batch: Transaction[],
  streams: Stream[],
  rules: Rule[],
  examples: Transaction[],
  client = new Anthropic(),
): Promise<AiDecision[]> {
  if (!batch.length) return [];
  const streamIds = streams.filter((s) => !s.archived).map((s) => s.id);
  const response = await client.beta.messages.parse({
    model: process.env.AI_SORT_MODEL?.trim() || 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'medium', format: betaJSONSchemaOutputFormat(schema(streamIds)) },
    messages: [{ role: 'user', content: buildPrompt(batch, streams, rules, examples) }],
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
export function pickExamples(txns: readonly Transaction[], max = 60): Transaction[] {
  const seen = new Set<string>();
  const out: Transaction[] = [];
  const mine = (t: Transaction) => t.classifiedBy === 'user' || t.classifiedBy === 'import';
  const ordered = [...txns.filter((t) => t.classifiedBy === 'user'), ...txns.filter((t) => t.classifiedBy === 'import')];
  for (const t of ordered) {
    if (!mine(t) || t.bucket === 'unreviewed' || !(t.counterparty || t.reference)) continue;
    // An import whose stream is missing or being re-chosen would teach the wrong stream.
    const business = t.bucket === 'business_income' || t.bucket === 'business_expense';
    if (t.classifiedBy === 'import' && business && (!t.streamId || t.meta.aiRestream === '1')) continue;
    const key = `${t.direction}:${(t.counterparty || t.reference).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
