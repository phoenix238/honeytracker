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
  if (isBankRow(copy)) throw new Error('Both are bank lines — the bank never records one payment twice');
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
  return (await r.getTransaction(bank.id))!;
}

/** "Not the same money": this pair isn't offered again. */
export async function keepBoth(r: Repo, bankId: string, copyId: string): Promise<void> {
  const copy = await r.getTransaction(copyId);
  if (!copy) throw new Error('That line no longer exists');
  const list = new Set((copy.meta.notDoubleOf ?? '').split(',').filter(Boolean));
  list.add(bankId);
  await r.updateTransaction(copy.id, { meta: { notDoubleOf: [...list].join(',') } });
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
