// Shared structured-extraction call used by both /api/receipts/scan (a photo) and
// /api/extract (an email body from Gmail import). One prompt/schema, two input shapes, so a
// receipt and an emailed invoice end up as the same Expense fields either way.

import type { ExtractedExpense } from '../src/core/extraction';

const SCHEMA = {
  type: 'object',
  properties: {
    isExpense: { type: 'boolean', description: 'false if this is not actually a receipt, invoice, or purchase confirmation' },
    merchant: { type: 'string' },
    amountPence: { type: 'integer', description: 'total amount in whole pence, e.g. 2350 for £23.50' },
    date: { type: 'string', description: 'ISO 8601 calendar date YYYY-MM-DD; today if no date is visible' },
    category: { type: 'string', description: "short expense category, e.g. 'travel', 'office', 'meals', 'software'" },
  },
  required: ['isExpense', 'merchant', 'amountPence', 'date', 'category'],
  additionalProperties: false,
} as const;

const SYSTEM = 'You extract structured expense data from receipts, invoices, and purchase confirmations for a UK freelancer\'s bookkeeping app. Read carefully and return only what the schema asks for. If the input is not a receipt/invoice/purchase confirmation, set isExpense to false and fill the other fields with your best guess or empty values.';

type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

async function callClaude(content: Content[]): Promise<ExtractedExpense> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured on this deployment.');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const textBlock = (data.content ?? []).find((b: { type: string }) => b.type === 'text');
  if (!textBlock) throw new Error('No text block in Claude response.');
  return JSON.parse(textBlock.text) as ExtractedExpense;
}

export function extractFromImage(base64DataUrl: string): Promise<ExtractedExpense> {
  const match = /^data:([^;]+);base64,(.+)$/.exec(base64DataUrl);
  if (!match) throw new Error('Expected a base64 data URL (data:<mediaType>;base64,<data>).');
  const mediaType = match[1]!;
  const data = match[2]!;
  return callClaude([
    { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
    { type: 'text', text: 'Extract this receipt/invoice into the schema.' },
  ]);
}

export function extractFromText(text: string): Promise<ExtractedExpense> {
  return callClaude([{ type: 'text', text: `Extract this email into the schema:\n\n${text.slice(0, 8000)}` }]);
}
