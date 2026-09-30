import { isBankRow, type Transaction } from './types.js';

// The same money recorded twice: once by the bank, and once somewhere else — the old app, CSTL
// marking a session paid in cash, an invoice marked "paid in cash", or a line you added by hand.
// Both count as income (or as a cost), so the total is doubled. The bank's line is the record
// to keep; the other one is the copy, and merging moves anything useful on it (your note, its
// receipts, what it was for) onto the bank's line before it goes.

const DAY = 86_400_000;
/** How far apart the two dates can be: a session on the 3rd is often paid on the 7th. */
export const DOUBLE_WINDOW_DAYS = 10;

export interface Double {
  bank: Transaction;
  copy: Transaction;
  /** Days between the two. */
  days: number;
  /** To the penny. */
  exact: boolean;
  /** Neither line could be paired with anything else — the strongest sign it's the same money. */
  alone: boolean;
}

const counts = (t: Transaction) => t.bucket === 'business_income' || t.bucket === 'business_expense';

/** Where the copy came from, in words. */
export function copyKind(t: Pick<Transaction, 'source' | 'meta'>): string {
  if (t.source === 'import') return 'Old app record';
  if (t.source === 'cstl') return 'CSTL: paid in cash';
  if (t.source === 'cash') return t.meta.invoiceId ? 'Invoice marked paid in cash' : 'Cash you added';
  return 'Added by hand';
}

/** A bank line already tied to something else of the same kind can't be this copy's twin. */
function tiedElsewhere(bank: Transaction, copy: Transaction): boolean {
  const same = (k: string) => bank.meta[k] && copy.meta[k] && bank.meta[k] !== copy.meta[k];
  return Boolean(same('importedFrom') || same('cstlBookingId') || same('invoiceId'));
}

/** Pairs of lines that look like the same money counted twice, closest first. */
export function findDoubles(txns: readonly Transaction[]): Double[] {
  // A bank line you've said yourself is personal, or a move between your own accounts, isn't counted.
  const bank = txns.filter((t) => isBankRow(t) && t.bucket !== 'transfer' && !(t.bucket === 'personal' && t.classifiedBy === 'user'));
  const copies = txns.filter((t) => !isBankRow(t) && counts(t));
  // Bank lines by direction and amount, so each copy only looks at the few that could match.
  const byAmount = new Map<string, Transaction[]>();
  for (const b of bank) {
    const key = `${b.direction}:${b.amountPence}`;
    byAmount.set(key, [...(byAmount.get(key) ?? []), b]);
  }
  const edges: Double[] = [];
  for (const c of copies) {
    const notThese = new Set((c.meta.notDoubleOf ?? '').split(',').filter(Boolean));
    const near = [-1, 0, 1].flatMap((d) => byAmount.get(`${c.direction}:${c.amountPence + d}`) ?? []);
    for (const b of near) {
      if (notThese.has(b.id) || tiedElsewhere(b, c)) continue;
      const diff = Math.abs(b.amountPence - c.amountPence);
      const days = Math.round(Math.abs(Date.parse(b.date) - Date.parse(c.date)) / DAY);
      if (diff > 1 || days > DOUBLE_WINDOW_DAYS) continue;
      edges.push({ bank: b, copy: c, days, exact: diff === 0, alone: false });
    }
  }
  const perBank = new Map<string, number>();
  const perCopy = new Map<string, number>();
  for (const e of edges) {
    perBank.set(e.bank.id, (perBank.get(e.bank.id) ?? 0) + 1);
    perCopy.set(e.copy.id, (perCopy.get(e.copy.id) ?? 0) + 1);
  }
  // Closest first, and each line in one pair only.
  edges.sort((a, b) => a.days - b.days || Number(b.exact) - Number(a.exact));
  const usedBank = new Set<string>();
  const usedCopy = new Set<string>();
  const out: Double[] = [];
  for (const e of edges) {
    if (usedBank.has(e.bank.id) || usedCopy.has(e.copy.id)) continue;
    usedBank.add(e.bank.id);
    usedCopy.add(e.copy.id);
    out.push({ ...e, alone: perBank.get(e.bank.id) === 1 && perCopy.get(e.copy.id) === 1 });
  }
  return out.sort((a, b) => b.bank.date.localeCompare(a.bank.date));
}

/**
 * The ones certain enough to merge without asking: an old-app record with the bank line it
 * would have been joined to at import if the bank line had been there — same amount to the
 * penny, within six days, and nothing else it could be.
 */
export function certainDoubles(txns: readonly Transaction[]): Double[] {
  return findDoubles(txns).filter((d) => d.copy.source === 'import' && d.exact && d.days <= 6 && d.alone);
}

/** Letters only, no "Ltd"/"Mr": names compare however the bank writes them. */
const nameKey = (s: string) => s.toLowerCase().replace(/\b(ltd|limited|mr|mrs|ms|mx|miss)\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();

/**
 * Money in from yourself (your other bank account, your savings) counted as business income:
 * it was income once already, when it first arrived — or it was never income at all.
 */
export function ownMoneyAsIncome(txns: readonly Transaction[], yourNames: readonly string[]): Transaction[] {
  const names = yourNames.map(nameKey).filter((n) => n.length >= 5);
  if (!names.length) return [];
  return txns.filter((t) => {
    if (!isBankRow(t) || t.direction !== 'in' || t.bucket !== 'business_income' || t.meta.invoiceId) return false;
    // Who it came from only — clients often put your name in the reference.
    const who = ` ${nameKey(t.counterparty)} `;
    return names.some((n) => who.includes(` ${n} `));
  });
}
