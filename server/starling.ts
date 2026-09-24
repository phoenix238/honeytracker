import { londonDate } from '../src/core/dates.js';

// Starling Bank — the backbone feed. Reads EVERY settled transaction, in and out, from every
// account on every token given, and keeps the payer's reference and name as separate fields
// (the old Honey proxy collapsed them, losing the reference that says which client paid).
//
// Read-only: a personal access token with the account/transaction read scopes is all it
// needs. It never moves money.

const API = 'https://api.starlingbank.com/api/v2';

export function starlingTokens(): string[] {
  const raw = process.env.STARLING_TOKENS ?? process.env.STARLING_TOKEN ?? '';
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

async function get<T>(token: string, path: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Trimmed: errors can echo request detail and this reaches logs.
    throw new Error(`Starling returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export interface StarlingAccount {
  accountUid: string;
  categoryUid: string;
  name: string;
}

export interface BankLine {
  feedItemUid: string;
  accountUid: string;
  accountName: string;
  date: string;
  amountPence: number;
  direction: 'in' | 'out';
  counterparty: string;
  reference: string;
  /** Starling's own source, e.g. MASTER_CARD, FASTER_PAYMENTS_IN, INTERNAL_TRANSFER. */
  source: string;
  spendingCategory: string;
}

interface FeedItem {
  feedItemUid?: string;
  amount?: { minorUnits?: number; currency?: string };
  direction?: string;
  transactionTime?: string;
  settlementTime?: string;
  status?: string;
  counterPartyName?: string;
  reference?: string;
  source?: string;
  spendingCategory?: string;
}

export async function listAccounts(token: string, fetchImpl: typeof fetch = fetch): Promise<StarlingAccount[]> {
  const data = await get<{ accounts?: { accountUid: string; defaultCategory: string; name: string }[] }>(token, '/accounts', fetchImpl);
  return (data.accounts ?? []).map((a) => ({ accountUid: a.accountUid, categoryUid: a.defaultCategory, name: a.name }));
}

/** Map one feed item; null for anything that isn't settled money (pending, declined, reversed). */
export function toBankLine(item: FeedItem, account: StarlingAccount): BankLine | null {
  if (item.status !== 'SETTLED' || !item.feedItemUid) return null;
  const amountPence = Math.round(item.amount?.minorUnits ?? 0);
  if (amountPence <= 0) return null;
  const when = item.transactionTime ?? item.settlementTime;
  if (!when) return null;
  return {
    feedItemUid: item.feedItemUid,
    accountUid: account.accountUid,
    accountName: account.name,
    date: londonDate(when),
    amountPence,
    direction: item.direction === 'IN' ? 'in' : 'out',
    counterparty: (item.counterPartyName ?? '').trim(),
    reference: (item.reference ?? '').trim(),
    source: item.source ?? '',
    spendingCategory: item.spendingCategory ?? '',
  };
}

const WINDOW_MS = 90 * 86_400_000;

/**
 * Settled transactions between two instants, fetched in 90-day windows so a first sync
 * reaching back over a year never asks the API for one enormous range.
 */
export async function fetchLines(
  token: string,
  account: StarlingAccount,
  since: Date,
  until: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<BankLine[]> {
  const out: BankLine[] = [];
  for (let start = since.getTime(); start < until.getTime(); start += WINDOW_MS) {
    const end = Math.min(start + WINDOW_MS, until.getTime());
    const data = await get<{ feedItems?: FeedItem[] }>(
      token,
      `/feed/account/${account.accountUid}/category/${account.categoryUid}/transactions-between` +
        `?minTransactionTimestamp=${encodeURIComponent(new Date(start).toISOString())}` +
        `&maxTransactionTimestamp=${encodeURIComponent(new Date(end).toISOString())}`,
      fetchImpl,
    );
    for (const item of data.feedItems ?? []) {
      const line = toBankLine(item, account);
      if (line) out.push(line);
    }
  }
  return out;
}
