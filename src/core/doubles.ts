import { isBankRow, type Transaction } from './types.js';
import { isYou, nameKey } from './transfers.js';

// The same money in the ledger twice, and old-app records the bank can't back up.
//
// - A copy: the bank's line, and the same money recorded somewhere else — the old app, CSTL
//   marking a session paid in cash, an invoice marked "paid in cash", a line added by hand.
// - A statement twin: one payment brought in twice from two bank sources (the live Starling
//   feed and a statement file of the same account).
// - An unbacked old-app record: nothing in the bank matches it. Either it was cash (real income,
//   keep it) or it isn't real money in these accounts (remove it).
//
// The bank's line is always the one kept; merging moves anything useful on the other onto it.

const DAY = 86_400_000;
/** How far apart a copy and its bank line can be. Old-app records carry the day you marked them paid, often weeks off. */
export const WINDOW_DAYS = { import: 45, other: 10, statement: 3 } as const;

export type DoubleKind = 'copy' | 'statement';

export interface Double {
  kind: DoubleKind;
  /** The bank's line — kept. */
  bank: Transaction;
  /** The other — merged into it. */
  copy: Transaction;
  /** Days between the two. */
  days: number;
  /** To the penny. */
  exact: boolean;
  /** The payee/payer names share a word. */
  sameName: boolean;
  /** Neither line could be paired with anything else — the strongest sign it's the same money. */
  alone: boolean;
}

const counts = (t: Transaction) => t.bucket === 'business_income' || t.bucket === 'business_expense';

/** Where the copy came from, in words. */
export function copyKind(t: Pick<Transaction, 'source' | 'meta'>): string {
  if (t.source === 'import') return 'Old app record';
  if (t.source === 'cstl') return 'CSTL: paid in cash';
  if (t.source === 'cash') return t.meta.invoiceId ? 'Invoice marked paid in cash' : 'Cash you added';
  if (t.source === 'monzo' || t.source === 'bankcsv') return `Statement file${t.meta.account ? ` (${t.meta.account})` : ''}`;
  return 'Added by hand';
}

/** A bank line already tied to something else of the same kind can't be this copy's twin. */
function tiedElsewhere(bank: Transaction, copy: Transaction): boolean {
  const same = (k: string) => bank.meta[k] && copy.meta[k] && bank.meta[k] !== copy.meta[k];
  return Boolean(same('importedFrom') || same('cstlBookingId') || same('invoiceId'));
}

const STOP = new Set(['the', 'and', 'for', 'ltd', 'session', 'payment', 'invoice', 'from', 'with', 'cash', 'client']);
function words(t: Transaction): Set<string> {
  return new Set(nameKey(`${t.counterparty} ${t.reference}`).split(' ').filter((w) => w.length >= 3 && !STOP.has(w)));
}
const shareWord = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w));

/** Pairs of lines that look like the same money counted twice. Each line appears in one pair at most. */
export function findDoubles(txns: readonly Transaction[]): Double[] {
  // A bank line you've said yourself is personal, or a move between your own accounts, isn't counted.
  const bank = txns.filter((t) => isBankRow(t) && t.bucket !== 'transfer' && !(t.bucket === 'personal' && t.classifiedBy === 'user'));
  const byAmount = new Map<string, Transaction[]>();
  for (const b of bank) {
    const key = `${b.direction}:${b.amountPence}`;
    byAmount.set(key, [...(byAmount.get(key) ?? []), b]);
  }
  const wordsOf = new Map<string, Set<string>>();
  const w = (t: Transaction) => wordsOf.get(t.id) ?? (wordsOf.set(t.id, words(t)), wordsOf.get(t.id)!);

  const edges: Double[] = [];
  const consider = (kind: DoubleKind, b: Transaction, c: Transaction, window: number) => {
    const days = Math.round(Math.abs(Date.parse(b.date) - Date.parse(c.date)) / DAY);
    if (days > window) return;
    edges.push({ kind, bank: b, copy: c, days, exact: b.amountPence === c.amountPence, sameName: shareWord(w(b), w(c)), alone: false });
  };

  // Copies: anything that isn't the bank's record, counted as business. Your spreadsheet's rows
  // are your record too, so they're never anybody's copy.
  for (const c of txns) {
    if (isBankRow(c) || c.source === 'sheet' || !counts(c)) continue;
    const notThese = new Set((c.meta.notDoubleOf ?? '').split(',').filter(Boolean));
    const window = c.source === 'import' ? WINDOW_DAYS.import : WINDOW_DAYS.other;
    for (const d of [-1, 0, 1]) {
      for (const b of byAmount.get(`${c.direction}:${c.amountPence + d}`) ?? []) {
        if (notThese.has(b.id) || tiedElsewhere(b, c)) continue;
        // Far apart only counts when the names agree — a weekly client pays the same every week.
        const days = Math.abs(Date.parse(b.date) - Date.parse(c.date)) / DAY;
        if (days > WINDOW_DAYS.other && !shareWord(w(b), w(c))) continue;
        consider('copy', b, c, window);
      }
    }
  }

  // Statement twins: the live Starling feed and a statement file both holding the same payment.
  for (const c of bank) {
    if (c.source === 'starling') continue;
    const notThese = new Set((c.meta.notDoubleOf ?? '').split(',').filter(Boolean));
    for (const b of byAmount.get(`${c.direction}:${c.amountPence}`) ?? []) {
      if (b.id === c.id || b.source === c.source || notThese.has(b.id)) continue;
      if (b.source !== 'starling' && b.createdAt > c.createdAt) continue; // keep whichever came in first
      if (!shareWord(w(b), w(c)) && (b.counterparty || c.counterparty)) continue;
      consider('statement', b, c, WINDOW_DAYS.statement);
    }
  }

  const perBank = new Map<string, number>();
  const perCopy = new Map<string, number>();
  for (const e of edges) {
    perBank.set(e.bank.id, (perBank.get(e.bank.id) ?? 0) + 1);
    perCopy.set(e.copy.id, (perCopy.get(e.copy.id) ?? 0) + 1);
  }
  // Best evidence first: names agree, then closest dates, then to the penny. Each line in one pair only.
  edges.sort((a, b) => Number(b.sameName) - Number(a.sameName) || a.days - b.days || Number(b.exact) - Number(a.exact));
  const used = new Set<string>();
  const out: Double[] = [];
  for (const e of edges) {
    if (used.has(e.bank.id) || used.has(e.copy.id)) continue;
    used.add(e.bank.id);
    used.add(e.copy.id);
    out.push({ ...e, alone: perBank.get(e.bank.id) === 1 && perCopy.get(e.copy.id) === 1 });
  }
  return out.sort((a, b) => b.bank.date.localeCompare(a.bank.date));
}

/**
 * The ones certain enough to merge without asking: an old-app record with the bank line it
 * would have been joined to at import if the bank line had been there — same amount to the
 * penny, within six days, nothing else it could be — or the same payment from two statements.
 */
export function certainDoubles(txns: readonly Transaction[]): Double[] {
  return findDoubles(txns).filter((d) => d.exact && d.alone && ((d.kind === 'copy' && d.copy.source === 'import' && d.days <= 6) || (d.kind === 'statement' && d.days <= 1 && d.sameName)));
}

/**
 * Old-app records nothing in the bank backs up — only from when your bank history starts, since
 * earlier ones can't be checked. Records you've confirmed as cash aren't asked about again.
 */
export function unbackedOldRecords(txns: readonly Transaction[], doubles: readonly Double[] = findDoubles(txns)): Transaction[] {
  const bankFrom = txns.filter(isBankRow).reduce((min, t) => (t.date < min ? t.date : min), '9999');
  const paired = new Set(doubles.map((d) => d.copy.id));
  return txns
    .filter((t) => t.source === 'import' && counts(t) && t.meta.cashConfirmed !== '1' && !paired.has(t.id) && t.date >= bankFrom)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Money in from yourself (your other bank account, your savings) counted as business income:
 * it was income once already, when it first arrived — or it was never income at all.
 */
export function ownMoneyAsIncome(txns: readonly Transaction[], yourNames: readonly string[]): Transaction[] {
  // Who it came from only — clients often put your name in the reference.
  return txns.filter((t) => isBankRow(t) && t.direction === 'in' && t.bucket === 'business_income' && !t.meta.invoiceId && isYou(t.counterparty, yourNames));
}
