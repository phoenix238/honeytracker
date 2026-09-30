import type { Bucket, Transaction } from './types.js';

// Bank transfers, sorted without asking. Money moving between your own accounts (Starling
// Spaces, Monzo pots, Monzo ↔ Starling in your own name) is never income or a cost. Money you
// send by bank transfer — rent, friends, paying someone back — is personal, while your work
// spending goes on the card. Money that arrives by transfer from someone else is left for
// you: that's how clients pay.

/** Letters only, no "Ltd"/"Mr": names compare however the bank writes them. */
export const nameKey = (s: string) => s.toLowerCase().replace(/\b(ltd|limited|mr|mrs|ms|mx|miss)\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();

/** The payee or payer is you — your name, however the bank spells it. Short names aren't trusted. */
export function isYou(name: string, yourNames: readonly string[]): boolean {
  const who = ` ${nameKey(name)} `;
  return yourNames.map(nameKey).some((n) => n.length >= 5 && who.includes(` ${n} `));
}

// How banks label a transfer: Starling's feed sources, and statement "type" columns.
const STARLING_OUT = new Set(['FASTER_PAYMENTS_OUT', 'STANDING_ORDER', 'ON_US_PAY_ME', 'SEPA_CREDIT_TRANSFER']);
const STATEMENT_TRANSFER = /faster payment|bank transfer|\btransfer\b|standing order|\b(fpo|tfr|so)\b/i;

export type TransferKind = 'own' | 'sent' | null;

/** Whether a line is a move between your own accounts, a transfer you sent, or neither. */
export function transferKind(t: Pick<Transaction, 'direction' | 'counterparty' | 'meta'>, yourNames: readonly string[]): TransferKind {
  if (t.meta.starlingSource === 'INTERNAL_TRANSFER' || /\bpot\b/i.test(t.meta.bankType ?? '')) return 'own';
  const transfer = STARLING_OUT.has(t.meta.starlingSource ?? '') || t.meta.starlingSource === 'FASTER_PAYMENTS_IN' || STATEMENT_TRANSFER.test(t.meta.bankType ?? '');
  if (transfer && isYou(t.counterparty, yourNames)) return 'own';
  if (t.direction === 'out' && (STARLING_OUT.has(t.meta.starlingSource ?? '') || STATEMENT_TRANSFER.test(t.meta.bankType ?? ''))) return 'sent';
  return null;
}

/** What an unsorted transfer becomes: a move between your accounts, or personal. */
export function transferBucket(kind: Exclude<TransferKind, null>): Exclude<Bucket, 'unreviewed'> {
  return kind === 'own' ? 'transfer' : 'personal';
}

/** A line not yet sorted, sorted as a transfer if it is one. Anything already decided is left alone. */
export function sortTransfer<T extends Pick<Transaction, 'bucket' | 'classifiedBy' | 'direction' | 'counterparty' | 'meta'>>(row: T, yourNames: readonly string[]): T {
  if (row.bucket !== 'unreviewed' || row.classifiedBy) return row;
  const kind = transferKind(row, yourNames);
  if (!kind) return row;
  return { ...row, bucket: transferBucket(kind), classifiedBy: 'rule', meta: { ...row.meta, autoSorted: 'transfer' } };
}
