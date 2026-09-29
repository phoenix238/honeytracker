import type { Transaction } from '../src/core/types.js';

// Undo for a group of changes made together: one swipe that also sorted the similar rows, a
// spreadsheet brought back in, an AI proposal you accepted. The change log already holds each
// field's before and after, so undo just puts the "before" back — but only on rows still exactly
// as the batch left them. A row you've changed since is yours now, and stays.

type Change = Record<string, { from?: unknown; to?: unknown }>;

const FIELDS = ['bucket', 'streamId', 'category', 'businessPercent', 'note', 'classifiedBy'] as const;
type Field = (typeof FIELDS)[number];

export interface BatchUndo {
  id: string;
  patch: Partial<Pick<Transaction, Field>> & { meta?: Record<string, string> };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function planBatchUndo(
  txns: readonly Transaction[],
  updates: readonly { transactionId: string; detail: Change }[],
): { undo: BatchUndo[]; kept: number } {
  const byTxn = new Map<string, Change[]>();
  for (const u of updates) byTxn.set(u.transactionId, [...(byTxn.get(u.transactionId) ?? []), u.detail]);
  const undo: BatchUndo[] = [];
  let kept = 0;
  for (const [id, log] of byTxn) {
    const t = txns.find((x) => x.id === id);
    if (!t) continue; // gone (a typed-in row you deleted) — nothing to put back
    const before: Partial<Record<Field | 'meta', unknown>> = {};
    const after: Partial<Record<Field | 'meta', unknown>> = {};
    for (const d of log) {
      for (const f of [...FIELDS, 'meta'] as const) {
        if (!d[f]) continue;
        if (!(f in before)) before[f] = d[f]!.from;
        after[f] = d[f]!.to;
      }
    }
    const touched = FIELDS.filter((f) => f in after);
    if (touched.some((f) => !same(t[f], after[f]))) {
      kept++;
      continue;
    }
    const patch: BatchUndo['patch'] = {};
    for (const f of touched) (patch as Record<string, unknown>)[f] = before[f];
    if ('meta' in after) {
      // Meta is merged on write, so a key the batch added is cleared rather than removed.
      const from = (before.meta ?? {}) as Record<string, string>;
      const to = (after.meta ?? {}) as Record<string, string>;
      const meta: Record<string, string> = {};
      for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) if (from[k] !== to[k]) meta[k] = from[k] ?? '';
      if (Object.keys(meta).length) patch.meta = meta;
    }
    if (Object.keys(patch).length) undo.push({ id, patch });
  }
  return { undo, kept };
}
