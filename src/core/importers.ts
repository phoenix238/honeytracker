import type { ExpenseCategory, IsoDate, Pence, Transaction } from './types.js';
import { legacyCategory } from './hmrc.js';
import { parsePence } from './money.js';
import { datesClose } from './dates.js';

// One-time migration of the old apps' data. Both old apps stored money they were TOLD about;
// the ledger is built from the bank. So an imported record that the bank feed already has
// must not become a second copy: it's matched to the bank row and just adds what the bank
// didn't know (who the client was, the receipt photo, the category). Only records with no
// bank counterpart — cash, mostly — become rows of their own.

export interface ImportedItem {
  /** Stable id, so running the import twice never duplicates. */
  sourceId: string;
  kind: 'income' | 'expense';
  date: IsoDate;
  amountPence: Pence;
  label: string;
  category: ExpenseCategory | null;
  /** Receipt photo as a data: URL, when the old app kept one. */
  imageDataUrl: string | null;
}

type Json = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObj) : []);

function amountOf(v: unknown): Pence {
  if (typeof v === 'number') return Math.round(v * 100);
  return parsePence(str(v));
}

function isoDate(v: unknown): IsoDate | null {
  const s = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Honeypot0101's "Export backup" file, in either of the two shapes it has written over
 * time: `{ keys: { 'mhq-entries': [...] } }` or `{ entries: [...], receipts: [...] }`.
 */
export function parseHoneypotBackup(raw: unknown): ImportedItem[] {
  if (!isObj(raw)) throw new Error('That file is not a Honey backup.');
  const keys = isObj(raw.keys) ? raw.keys : isObj(raw.data) ? raw.data : raw;
  const entries = arr(keys['mhq-entries'] ?? keys.entries);
  const receipts = arr(keys['mhq-receipts'] ?? keys.receipts);
  if (!entries.length && !receipts.length) throw new Error('No Honey entries or receipts found in that file.');

  const out: ImportedItem[] = [];
  for (const e of entries) {
    const status = str(e.status).toLowerCase();
    // Only money actually received counts. Unpaid invoices aren't income on the cash basis.
    if (status !== 'paid' || e.void === true || str(e.status) === 'void') continue;
    const date = isoDate(e.paidDate) ?? isoDate(e.date);
    const amountPence = amountOf(e.subtotal ?? e.amount);
    if (!date || amountPence <= 0) continue;
    out.push({
      sourceId: `honeypot:entry:${str(e.id)}`,
      kind: 'income',
      date,
      amountPence,
      label: [str(e.client), str(e.description)].filter(Boolean).join(' — '),
      category: null,
      imageDataUrl: null,
    });
  }
  for (const r of receipts) {
    if (str(r.status) === 'void' || str(r.category) !== 'business') continue;
    const date = isoDate(r.date);
    const amountPence = amountOf(r.amount);
    if (!date || amountPence <= 0) continue;
    const image = str(r.imageData);
    out.push({
      sourceId: `honeypot:receipt:${str(r.id)}`,
      kind: 'expense',
      date,
      amountPence,
      label: str(r.description) || str(r.vendor) || 'Receipt',
      category: legacyCategory(str(r.subcategory)),
      imageDataUrl: image.startsWith('data:') ? image : null,
    });
  }
  return out;
}

/** Records from the first version of this app, which kept them in the browser only. */
export function parseLocalV0(income: readonly Json[], expenses: readonly Json[]): ImportedItem[] {
  const out: ImportedItem[] = [];
  for (const i of income) {
    const date = isoDate(i.date);
    const amountPence = Number(i.grossPence) || 0;
    if (!date || amountPence <= 0) continue;
    out.push({ sourceId: `local:income:${str(i.id)}`, kind: 'income', date, amountPence, label: str(i.client) || str(i.note), category: null, imageDataUrl: null });
  }
  for (const e of expenses) {
    const date = isoDate(e.date);
    const amountPence = Number(e.amountPence) || 0;
    if (!date || amountPence <= 0 || e.deductible === false) continue;
    out.push({ sourceId: `local:expense:${str(e.id)}`, kind: 'expense', date, amountPence, label: str(e.note) || str(e.category), category: legacyCategory(str(e.category)), imageDataUrl: null });
  }
  return out;
}

/**
 * The bank row an imported record describes, if there is one: same direction, same amount
 * to the penny, within six days, and not already claimed by another imported record.
 */
export function findBankTwin(
  item: ImportedItem,
  bankRows: readonly Transaction[],
  claimed: ReadonlySet<string>,
): Transaction | null {
  const direction = item.kind === 'income' ? 'in' : 'out';
  let best: Transaction | null = null;
  let bestGap = Infinity;
  for (const t of bankRows) {
    if (t.source !== 'starling' || t.direction !== direction || claimed.has(t.id)) continue;
    if (t.amountPence !== item.amountPence || !datesClose(t.date, item.date, 6)) continue;
    const gap = Math.abs(new Date(t.date).getTime() - new Date(item.date).getTime());
    if (gap < bestGap) {
      best = t;
      bestGap = gap;
    }
  }
  return best;
}
