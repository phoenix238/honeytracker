import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Repo } from './repo.js';
import { readFoundDoc } from './receipts.js';
import { autoMatch } from '../src/core/receiptMatch.js';
import { addDays } from '../src/core/dates.js';
import type { Receipt } from '../src/core/types.js';

// The Google receipt finder. A small script runs inside your own Google account (so Honey never
// holds a key to your inbox), searches Gmail and Drive for anything that looks like a receipt,
// and sends each one here. Honey reads it, keeps it only if it's a purchase, and attaches it to
// the bank line it explains. Sorting that line stays with the AI sort and your check.

const TOKEN_KEY = 'google:tokenHash';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** A fresh key for the script; any earlier one stops working. Only its hash is stored. */
export async function newGoogleToken(r: Repo): Promise<string> {
  const token = `hny_${randomBytes(24).toString('hex')}`;
  await r.setKv(TOKEN_KEY, { hash: hash(token) });
  return token;
}

export async function dropGoogleToken(r: Repo): Promise<void> {
  await r.setKv(TOKEN_KEY, { hash: '' });
}

export async function googleConnected(r: Repo): Promise<boolean> {
  return Boolean((await r.getKv<{ hash: string }>(TOKEN_KEY))?.hash);
}

export async function isGoogleScript(r: Repo, authHeader: string | null): Promise<boolean> {
  const stored = (await r.getKv<{ hash: string }>(TOKEN_KEY))?.hash;
  const given = /^Bearer (.+)$/.exec(authHeader ?? '')?.[1]?.trim();
  if (!stored || !given) return false;
  const a = Buffer.from(hash(given));
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface FoundItem {
  id: string;
  source: 'gmail' | 'drive';
  from: string;
  subject: string;
  date: string;
  text: string;
  file: { name: string; mime: string; dataBase64: string } | null;
}

export const FILE_TYPES = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/;
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));

/** The same purchase already on file — say an email that's also saved in Drive, or a photo you took. */
function duplicateOf(doc: { merchant: string; date: string | null; totalPence: number | null }, receipts: Receipt[]): Receipt | null {
  if (!doc.totalPence || !doc.date) return null;
  const mine = words(doc.merchant);
  return (
    receipts.find(
      (r) =>
        r.totalPence === doc.totalPence &&
        r.date != null &&
        // Same amount on the same day is the same purchase; a day or two apart, only if the
        // shop's name agrees too.
        (r.date === doc.date ||
          (r.date >= addDays(doc.date!, -2) && r.date <= addDays(doc.date!, 2) && [...words(r.merchant)].some((w) => mine.has(w)))),
    ) ?? null
  );
}

export type Outcome = 'receipt' | 'duplicate' | 'income' | 'other' | 'unreadable';

export async function takeFoundItem(r: Repo, item: FoundItem): Promise<{ outcome: Outcome; receiptId: string | null; matched: boolean }> {
  const sourceId = `google:${item.source}:${item.id}`;
  const emailText =
    item.source === 'gmail'
      ? `From: ${item.from}\nSubject: ${item.subject}\nDate: ${item.date}\n\n${item.text}`
      : item.text;
  // Throws on an API failure, so the item isn't marked seen and the script sends it again later.
  const doc = await readFoundDoc({ mime: item.file?.mime, dataBase64: item.file?.dataBase64, emailText: emailText.trim() || undefined });

  let outcome: Outcome;
  let receipt: Receipt | null = null;
  let matched = false;
  if (!doc) outcome = 'unreadable';
  else if (doc.kind !== 'purchase') outcome = doc.kind;
  else if (!doc.totalPence) outcome = 'unreadable'; // no GBP total: nothing to match or claim
  else if (duplicateOf(doc, await r.listReceipts())) outcome = 'duplicate';
  else {
    const stored = item.file ?? {
      name: `${item.subject || 'email'}.txt`,
      mime: 'text/plain; charset=utf-8',
      dataBase64: Buffer.from(emailText, 'utf8').toString('base64'),
    };
    receipt = await r.insertReceipt(
      {
        filename: stored.name.slice(0, 200),
        mime: stored.mime,
        merchant: doc.merchant,
        date: doc.date,
        totalPence: doc.totalPence,
        vatPence: doc.vatPence,
        suggestedCategory: doc.category,
        description: [doc.description, item.source === 'gmail' ? `(from Gmail: ${item.subject.slice(0, 80)})` : '(from Google Drive)'].filter(Boolean).join(' '),
        transactionId: null,
      },
      stored.dataBase64,
      sourceId,
    );
    outcome = receipt ? 'receipt' : 'duplicate';
    if (receipt) {
      // Attach it to its bank line, but don't decide the line: a receipt in your inbox can
      // still be a personal purchase. The AI sort reads it; you check.
      const line = autoMatch(receipt, await r.listTransactions());
      if (line) {
        await r.updateReceipt(receipt.id, { transactionId: line.id });
        matched = true;
      }
    }
  }
  await r.googleMarkSeen(sourceId, outcome, receipt?.id ?? null);
  return { outcome, receiptId: receipt?.id ?? null, matched };
}
