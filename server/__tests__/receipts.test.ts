import { describe, it, expect, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { doubtAbout, extractReceipt, readFoundDoc } from '../receipts';

// A stand-in for Claude: each model gives its own answer, and every call is recorded.
function fakeClient(answers: Record<string, object | Error>) {
  const calls: { model: string; params: Record<string, unknown> }[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          const model = String(params.model);
          calls.push({ model, params });
          const a = answers[model];
          if (a instanceof Error) throw a;
          return { stop_reason: 'end_turn', parsed_output: a ?? null };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const good = { merchant: 'Shell', date: '2026-09-27', total: '45.50', vat: '7.58', currency: 'GBP', category: 'carVanTravelExpenses', description: 'Petrol' };
const png = 'iVBORw0KGgo=';

afterEach(() => {
  delete process.env.RECEIPT_MODEL;
  delete process.env.RECEIPT_CHECK_MODEL;
});

describe('reading receipts, cheapest first', () => {
  it('keeps Haiku’s answer when it adds up, and never asks the dearer model', async () => {
    const { client, calls } = fakeClient({ 'claude-haiku-4-5': good });
    const r = await extractReceipt('image/png', png, client);
    expect(r).toMatchObject({ merchant: 'Shell', totalPence: 4550, vatPence: 758, date: '2026-09-27' });
    expect(calls.map((c) => c.model)).toEqual(['claude-haiku-4-5']);
    // Haiku takes no effort setting or refusal fallback — sending them would fail the request.
    expect(calls[0]!.params).not.toHaveProperty('fallbacks');
    expect((calls[0]!.params.output_config as Record<string, unknown>).effort).toBeUndefined();
  });

  it('re-reads with Sonnet when Haiku’s answer doesn’t add up, and keeps Sonnet’s', async () => {
    const { client, calls } = fakeClient({ 'claude-haiku-4-5': { ...good, total: '' }, 'claude-sonnet-5-5': good });
    expect((await extractReceipt('image/png', png, client))?.totalPence).toBe(4550);
    expect(calls.map((c) => c.model)).toEqual(['claude-haiku-4-5', 'claude-sonnet-5-5']);
    expect((calls[1]!.params.output_config as Record<string, unknown>).effort).toBe('low');
  });

  it('falls back to Sonnet when Haiku fails outright', async () => {
    const { client, calls } = fakeClient({ 'claude-haiku-4-5': new Error('overloaded'), 'claude-sonnet-5-5': good });
    expect((await extractReceipt('image/png', png, client))?.merchant).toBe('Shell');
    expect(calls).toHaveLength(2);
  });

  it('a snapped photo keeps Haiku’s rough read if Sonnet is down; an email waits for the next run', async () => {
    const rough = { ...good, total: '' };
    const photo = fakeClient({ 'claude-haiku-4-5': rough, 'claude-sonnet-5-5': new Error('down') });
    expect((await extractReceipt('image/png', png, photo.client))?.merchant).toBe('Shell');
    const email = fakeClient({ 'claude-haiku-4-5': { kind: 'purchase', ...rough }, 'claude-sonnet-5-5': new Error('down') });
    await expect(readFoundDoc({ emailText: 'Receipt from Shell' }, email.client)).rejects.toThrow('down');
  });

  it('re-reads an attached receipt Haiku waved away, but not a plain marketing email', async () => {
    const other = { kind: 'other', merchant: '', date: '', total: '', vat: '', currency: '', category: 'otherExpenses', description: '' };
    const withFile = fakeClient({ 'claude-haiku-4-5': other, 'claude-sonnet-5-5': { kind: 'purchase', ...good } });
    expect((await readFoundDoc({ mime: 'application/pdf', dataBase64: png, emailText: 'Your order' }, withFile.client))?.kind).toBe('purchase');
    const textOnly = fakeClient({ 'claude-haiku-4-5': other });
    expect((await readFoundDoc({ emailText: 'Sale ends Sunday!' }, textOnly.client))?.kind).toBe('other');
    expect(textOnly.calls).toHaveLength(1);
  });

  it('either model can be swapped in Vercel', async () => {
    process.env.RECEIPT_MODEL = 'claude-sonnet-5-5';
    const { client, calls } = fakeClient({ 'claude-sonnet-5-5': good });
    await extractReceipt('image/png', png, client);
    expect(calls.map((c) => c.model)).toEqual(['claude-sonnet-5-5']);
  });
});

describe('what counts as a misread', () => {
  const today = '2026-09-30';
  it('flags a missing total, shop or date, a future or ancient date, and impossible VAT', () => {
    expect(doubtAbout(good, today)).toBe('');
    expect(doubtAbout({ ...good, total: '0' }, today)).toBe('no total');
    expect(doubtAbout({ ...good, merchant: ' ' }, today)).toBe('no shop name');
    expect(doubtAbout({ ...good, date: '27/09/2026' }, today)).toBe('no date');
    expect(doubtAbout({ ...good, date: '2027-01-01' }, today)).toBe('date out of range');
    expect(doubtAbout({ ...good, date: '2012-01-01' }, today)).toBe('date out of range');
    expect(doubtAbout({ ...good, vat: '20.00' }, today)).toBe('VAT bigger than possible');
    expect(doubtAbout({ ...good, vat: '' }, today)).toBe(''); // no VAT shown is normal
  });
});
