import Anthropic from '@anthropic-ai/sdk';
import { anthropicClient } from './anthropic.js';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema.mjs';
import { CATEGORIES, isCategory } from '../src/core/hmrc.js';
import { parsePence } from '../src/core/money.js';
import type { ExpenseCategory, IsoDate, Pence } from '../src/core/types.js';

// Reads a receipt photo or PDF with Claude and pulls out what the ledger needs: who, when,
// how much, the VAT, and a suggested HMRC category. The file is kept whatever happens — a
// failed read just means you type the three fields yourself.

export interface ExtractedReceipt {
  merchant: string;
  date: IsoDate | null;
  totalPence: Pence | null;
  vatPence: Pence | null;
  category: ExpenseCategory | null;
  description: string;
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export function receiptsAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

const SCHEMA = {
  type: 'object',
  properties: {
    merchant: { type: 'string', description: 'Shop or supplier name as printed. Empty string if unreadable.' },
    date: { type: 'string', description: 'Transaction date as YYYY-MM-DD. Empty string if not shown.' },
    total: { type: 'string', description: 'Total paid in GBP as a plain number like "23.50". Empty string if unreadable.' },
    vat: { type: 'string', description: 'VAT amount in GBP as a plain number, or empty string if none shown.' },
    currency: { type: 'string', description: 'ISO currency code of the total, e.g. GBP.' },
    category: { type: 'string', enum: CATEGORIES.map((c) => c.key) },
    description: { type: 'string', description: 'A few words on what was bought.' },
  },
  required: ['merchant', 'date', 'total', 'vat', 'currency', 'category', 'description'],
  additionalProperties: false,
} as const;

const CATEGORY_GUIDE = CATEGORIES.map((c) => `- ${c.key}: ${c.label} (e.g. ${c.hint})`).join('\n');

const PROMPT = `This is a receipt or invoice for a UK sole trader. Read it and fill in the fields.

For category, pick the HMRC self-employment expense category it most likely belongs to:
${CATEGORY_GUIDE}

Rules: copy numbers exactly as printed; never guess a total you can't read — leave it empty instead. If the total is not in GBP, still give the printed number and its currency.`;

function fileBlock(mime: string, dataBase64: string): Anthropic.Beta.BetaContentBlockParam | null {
  if (mime === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dataBase64 } };
  if ((IMAGE_TYPES as readonly string[]).includes(mime)) return { type: 'image', source: { type: 'base64', media_type: mime as ImageType, data: dataBase64 } };
  return null;
}

export async function extractReceipt(mime: string, dataBase64: string, client = anthropicClient()): Promise<ExtractedReceipt | null> {
  const file = fileBlock(mime, dataBase64);
  if (!file) return null;
  const out = await ask(client, [file, { type: 'text', text: PROMPT }], SCHEMA);
  return out ? tidy(out) : null;
}

type Raw = { merchant: string; date: string; total: string; vat: string; currency: string; category: string; description: string };

async function ask<S extends Record<string, unknown>>(client: Anthropic, content: Anthropic.Beta.BetaContentBlockParam[], schema: S) {
  const response = await client.beta.messages.parse({
    model: process.env.RECEIPT_MODEL?.trim() || 'claude-opus-5',
    max_tokens: 4000,
    // A receipt is a quick read; low effort keeps each one cheap.
    output_config: { effort: 'low', format: betaJSONSchemaOutputFormat(schema as never) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
  return response.parsed_output as unknown as Raw & { kind?: string };
}

// ── Anything found in Gmail or Drive: first decide whether it's a purchase at all ──

export interface FoundDoc extends ExtractedReceipt {
  kind: 'purchase' | 'income' | 'other';
}

const DOC_SCHEMA = {
  ...SCHEMA,
  properties: {
    kind: {
      type: 'string',
      enum: ['purchase', 'income', 'other'],
      description: 'purchase: a receipt, invoice or order confirmation for something this person paid for. income: money paid TO them (an invoice they sent, a remittance, a payslip). other: anything else.',
    },
    ...SCHEMA.properties,
  },
  required: ['kind', ...SCHEMA.required],
} as const;

const DOC_PROMPT = `This came from a UK sole trader's email or files, found while looking for their receipts. First decide what it is:
- purchase: proof they paid for something — a receipt, a paid invoice or bill, an order or booking confirmation with a price.
- income: money paid to them — an invoice they sent, a remittance advice, a payslip.
- other: anything else — marketing, a quote, a delivery update, a bank statement, a reminder with no payment.

For a purchase, fill in the fields. For income or other, leave the fields empty.

For category, pick the HMRC self-employment expense category it most likely belongs to:
${CATEGORY_GUIDE}

Rules: copy numbers exactly as printed; the total is what they actually paid; never guess a total you can't read — leave it empty instead.`;

/** Read a file (PDF or photo) or, when there's none, the email itself. */
export async function readFoundDoc(
  input: { mime?: string; dataBase64?: string; emailText?: string },
  client = anthropicClient(),
): Promise<FoundDoc | null> {
  const file = input.mime && input.dataBase64 ? fileBlock(input.mime, input.dataBase64) : null;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (file) content.push(file);
  if (input.emailText) content.push({ type: 'text', text: `The email it came with:\n\n${input.emailText.slice(0, 12_000)}` });
  if (!content.length) return null;
  content.push({ type: 'text', text: DOC_PROMPT });
  const out = await ask(client, content, DOC_SCHEMA);
  if (!out) return null;
  const kind = out.kind === 'purchase' || out.kind === 'income' ? out.kind : 'other';
  return { kind, ...tidy(out) };
}

function tidy(out: Raw): ExtractedReceipt {
  const gbp = !out.currency || out.currency.toUpperCase() === 'GBP';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(out.date) ? out.date : null;
  const total = out.total ? parsePence(out.total) : 0;
  const vat = out.vat ? parsePence(out.vat) : 0;
  return {
    merchant: (out.merchant ?? '').trim(),
    date,
    // A foreign-currency total can't be matched to a GBP bank line, so it's left for you.
    totalPence: gbp && total > 0 ? total : null,
    vatPence: gbp && vat > 0 ? vat : null,
    category: isCategory(out.category) ? out.category : null,
    description: [(out.description ?? '').trim(), gbp ? '' : `(${out.total} ${out.currency})`].filter(Boolean).join(' '),
  };
}
