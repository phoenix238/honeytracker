import type { Repo } from './repo.js';
import { certainDoubles } from '../src/core/doubles.js';
import { isBankRow, type Transaction } from '../src/core/types.js';

// Merging the same money counted twice into the bank's line. Everything worth keeping on the
// copy moves across first — your note, its receipts, the stream and category, and what it's
// tied to (the old-app record, the CSTL booking, the invoice) — so importing the backup again,
// or the next CSTL sync, sees it's already there and doesn't bring the copy back.

const SYSTEM_NOTE = /^Imported from Honey — not found in the bank feed/;
const CARRY = ['importedFrom', 'cstlBookingId', 'cstlRef', 'cstlReceipt', 'clinic', 'invoiceId'] as const;

export async function mergeDouble(r: Repo, bankId: string, copyId: string): Promise<Transaction> {
  const [bank, copy] = await Promise.all([r.getTransaction(bankId), r.getTransaction(copyId)]);
  if (!bank || !copy) throw new Error('One of those lines no longer exists');
  if (!isBankRow(bank)) throw new Error('The line to keep must be the bank’s');
  // Two bank lines are only ever the same payment brought in from two sources (the live feed
  // and a statement file); the statement file's line is the one that goes.
  const statementTwin = isBankRow(copy);
  if (statementTwin && (copy.source === 'starling' || copy.source === bank.source)) throw new Error('Both are the bank’s own lines — the bank never records one payment twice');
  if (bank.direction !== copy.direction) throw new Error('One is money in, the other money out');

  for (const rc of (await r.listReceipts()).filter((x) => x.transactionId === copy.id)) await r.updateReceipt(rc.id, { transactionId: bank.id });
  if (copy.meta.invoiceId) {
    const inv = await r.getInvoice(copy.meta.invoiceId);
    if (inv?.paidTransactionId === copy.id) await r.updateInvoice(inv.id, { paidTransactionId: bank.id });
  }

  const meta: Record<string, string> = { mergedFrom: copy.source };
  for (const k of CARRY) if (copy.meta[k] && !bank.meta[k]) meta[k] = copy.meta[k]!;
  const copyNote = SYSTEM_NOTE.test(copy.note) ? '' : copy.note.replace(/^Cash · /, '');
  const note = bank.note || copyNote || (copy.source === 'import' ? copy.counterparty : '');
  // Your own decision on the bank line stands; otherwise it takes what the copy was filed as.
  const takeCopy = bank.classifiedBy !== 'user' || bank.bucket === 'unreviewed';
  await r.updateTransaction(bank.id, {
    ...(takeCopy
      ? { bucket: copy.bucket, streamId: copy.streamId, category: copy.category, businessPercent: copy.businessPercent, classifiedBy: copy.classifiedBy === 'user' ? 'user' : copy.classifiedBy ?? 'import' }
      : {}),
    note,
    meta,
  });
  await r.deleteTransaction(copy.id);
  // Bringing the same statement in again mustn't recreate it.
  if (statementTwin && copy.sourceId) await remember(r, STATEMENT_REMOVED, `${copy.source}:${copy.sourceId}`);
  return (await r.getTransaction(bank.id))!;
}

export const STATEMENT_REMOVED = 'statement:removed';

async function remember(r: Repo, key: string, ...ids: string[]): Promise<void> {
  const list = new Set((await r.getKv<string[]>(key)) ?? []);
  for (const id of ids) list.add(id);
  await r.setKv(key, [...list]);
}

/** After new bank lines arrive: merge the old-app copies that are certainly the same money. */
export async function mergeCertainDoubles(r: Repo): Promise<number> {
  let merged = 0;
  for (const d of certainDoubles(await r.listTransactions())) {
    await mergeDouble(r, d.bank.id, d.copy.id);
    merged++;
  }
  return merged;
}
