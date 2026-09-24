import type { Repo, NewTransaction } from './repo.js';
import { starlingTokens, listAccounts, fetchLines, type BankLine } from './starling.js';
import { findRule, applyRule } from '../src/core/rules.js';
import { autoMatch } from '../src/core/receiptMatch.js';
import { londonDate, taxYearBounds, taxYearOf } from '../src/core/dates.js';
import type { Invoice, Settings, Transaction } from '../src/core/types.js';
import { invoiceForPayment } from '../src/core/invoices.js';

// Pull everything new into the ledger. Safe to run any number of times: every row is keyed
// on its source's own id, so a second run over the same window adds nothing. Runs daily from
// the cron and on demand from the app.

export interface SyncResult {
  at: string;
  starling: { configured: boolean; accounts: number; newRows: number; autoClassified: number };
  cstl: { configured: boolean; matchedBank: number; cashRows: number; otherPaid: number; unpricedSkipped: number; voided: number };
  receiptsMatched: number;
  invoicesPaid: number;
  errors: string[];
}

/** Always re-read from the start of LAST tax year — last year's bill sets this year's payments. */
export function syncWindowStart(today: string): Date {
  const from = taxYearBounds(taxYearOf(today) - 1).from;
  return new Date(`${from}T00:00:00Z`);
}

export function bankLineToRow(line: BankLine): NewTransaction {
  const isSpacesMove = line.source === 'INTERNAL_TRANSFER';
  return {
    date: line.date,
    amountPence: line.amountPence,
    direction: line.direction,
    source: 'starling',
    sourceId: line.feedItemUid,
    counterparty: line.counterparty,
    reference: line.reference,
    // Moving money between your own Starling Spaces isn't income or spending.
    bucket: isSpacesMove ? 'transfer' : 'unreviewed',
    streamId: null,
    category: null,
    businessPercent: 100,
    note: '',
    classifiedBy: isSpacesMove ? 'rule' : null,
    meta: { account: line.accountName, starlingSource: line.source, spendingCategory: line.spendingCategory },
  };
}

export async function syncStarling(repo: Repo, result: SyncResult, fetchImpl: typeof fetch = fetch): Promise<void> {
  const tokens = starlingTokens();
  result.starling.configured = tokens.length > 0;
  if (!tokens.length) return;
  const rules = await repo.listRules();
  const since = syncWindowStart(londonDate(new Date()));
  // Overlap the watermark by 3 days: a transaction can settle after later ones.
  const watermark = await repo.getKv<Record<string, string>>('starling:watermarks') ?? {};

  for (const token of tokens) {
    for (const account of await listAccounts(token, fetchImpl)) {
      result.starling.accounts++;
      const last = watermark[account.accountUid];
      const from = last ? new Date(Math.max(since.getTime(), new Date(last).getTime() - 3 * 86_400_000)) : since;
      const startedAt = new Date();
      const lines = await fetchLines(token, account, from, startedAt, fetchImpl);
      for (const line of lines) {
        let row = bankLineToRow(line);
        const rule = row.bucket === 'unreviewed' ? findRule(rules, row) : null;
        if (rule) row = stripIds(applyRule(rule, withIds(row)));
        const inserted = await repo.insertTransaction(row);
        if (inserted) {
          result.starling.newRows++;
          if (rule) result.starling.autoClassified++;
        }
      }
      watermark[account.accountUid] = startedAt.toISOString();
    }
  }
  await repo.setKv('starling:watermarks', watermark);
}

function withIds(row: NewTransaction): Transaction {
  return { ...row, id: '', receiptIds: [], createdAt: '', updatedAt: '' };
}
function stripIds(t: Transaction): NewTransaction {
  const { id: _id, receiptIds: _r, createdAt: _c, updatedAt: _u, ...rest } = t;
  return rest;
}

// ── CSTL ──────────────────────────────────────────────────────────────────────────────

/** The contract with CSTL's /api/finance/events endpoint. Money facts only — no clinical data. */
export interface CstlEvent {
  bookingId: string;
  paidAt: string;
  amountPence: number | null;
  /** bank = settled by a bank transfer CSTL matched; cash; other = card or anything else. */
  method: 'bank' | 'cash' | 'other';
  feedItemUid: string | null;
  paymentRef: string;
  receiptNumber: string;
  clinic: string;
  note: string;
}

export function cstlConfigured(): boolean {
  return Boolean(process.env.CSTL_URL?.trim() && process.env.CSTL_FINANCE_TOKEN?.trim());
}

export async function fetchCstlEvents(since: Date, fetchImpl: typeof fetch = fetch): Promise<CstlEvent[]> {
  const base = process.env.CSTL_URL!.trim().replace(/\/$/, '');
  const res = await fetchImpl(`${base}/api/finance/events?since=${encodeURIComponent(since.toISOString())}`, {
    headers: { Authorization: `Bearer ${process.env.CSTL_FINANCE_TOKEN!.trim()}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CSTL returned ${res.status}`);
  const body = (await res.json()) as { events?: CstlEvent[] };
  return body.events ?? [];
}

async function ensureCstlStream(repo: Repo, settings: Settings): Promise<string> {
  if (settings.cstlStreamId) {
    const streams = await repo.listStreams();
    if (streams.some((s) => s.id === settings.cstlStreamId)) return settings.cstlStreamId;
  }
  const stream = await repo.saveStream({ name: 'CSTL practice', kind: 'self_employment', color: '#6E86D0', archived: false });
  await repo.saveSettings({ ...settings, cstlStreamId: stream.id });
  return stream.id;
}

function cstlNote(e: CstlEvent): string {
  return ['CSTL session', e.clinic, e.paymentRef && `ref ${e.paymentRef}`, e.receiptNumber && `receipt ${e.receiptNumber}`]
    .filter(Boolean)
    .join(' · ');
}

export async function applyCstlEvents(repo: Repo, events: readonly CstlEvent[], result: SyncResult, windowStart: string): Promise<void> {
  const settings = await repo.getSettings();
  const streamId = await ensureCstlStream(repo, settings);
  const seenBookings = new Set<string>();
  const dismissed = new Set((await repo.getKv<string[]>('cstl:dismissed')) ?? []);
  const other: { bookingId: string; date: string; amountPence: number; note: string }[] = [];

  for (const e of events) {
    seenBookings.add(e.bookingId);
    if (e.amountPence == null || e.amountPence <= 0) {
      result.cstl.unpricedSkipped++;
      continue;
    }
    const meta = { cstlBookingId: e.bookingId, cstlRef: e.paymentRef, cstlReceipt: e.receiptNumber, clinic: e.clinic };
    const date = londonDate(e.paidAt);

    // A bank payment CSTL recorded by hand (not matched from the feed): the bank row is in the
    // ledger already and is classified there, so there's nothing to add here.
    if (e.method === 'bank' && !e.feedItemUid) continue;

    if (e.method === 'bank' && e.feedItemUid) {
      const bank = await repo.findBySource('starling', e.feedItemUid);
      if (!bank) continue; // the bank row arrives on a later Starling sync; retried next run
      // CSTL knows exactly what this money was. It classifies the row unless you already
      // classified it yourself — your own decision is never overwritten.
      const mine = bank.classifiedBy === 'user' || bank.classifiedBy === 'import';
      if (mine) {
        if (bank.meta.cstlBookingId !== e.bookingId) await repo.updateTransaction(bank.id, { meta });
      } else if (bank.bucket !== 'business_income' || bank.streamId !== streamId || bank.meta.cstlBookingId !== e.bookingId) {
        await repo.updateTransaction(bank.id, { bucket: 'business_income', streamId, category: null, classifiedBy: 'cstl', note: bank.note || cstlNote(e), meta });
        result.cstl.matchedBank++;
      }
      continue;
    }

    if (e.method === 'cash') {
      const existing = await repo.findBySource('cstl', `booking:${e.bookingId}`);
      if (!existing) {
        await repo.insertTransaction({
          date, amountPence: e.amountPence, direction: 'in', source: 'cstl', sourceId: `booking:${e.bookingId}`,
          counterparty: e.paymentRef ? `CSTL client ${e.paymentRef}` : 'CSTL client', reference: e.receiptNumber,
          bucket: 'business_income', streamId, category: null, businessPercent: 100, note: `Cash · ${cstlNote(e)}`,
          classifiedBy: 'cstl', meta: { ...meta, method: 'cash' },
        });
        result.cstl.cashRows++;
      } else if (existing.amountPence !== e.amountPence || existing.date !== date) {
        await repo.updateTransaction(existing.id, { amountPence: e.amountPence, date });
      }
      continue;
    }

    // Card or anything else: it may already be in the bank as a card-reader payout, so it is
    // NOT added automatically — listed for you to add or dismiss instead of double-counting.
    const added = await repo.findBySource('cstl', `booking:${e.bookingId}`);
    if (!added && !dismissed.has(e.bookingId)) other.push({ bookingId: e.bookingId, date, amountPence: e.amountPence, note: `${e.note || 'Other'} · ${cstlNote(e)}` });
  }
  result.cstl.otherPaid = other.length;
  await repo.setKv('cstl:other', other);

  // A cash payment CSTL no longer shows as paid (marked unpaid, deleted) goes back to review.
  for (const t of await repo.listTransactions()) {
    if (t.source !== 'cstl' || t.classifiedBy !== 'cstl' || t.date < windowStart) continue;
    const bookingId = t.sourceId?.replace(/^booking:/, '') ?? '';
    if (bookingId && !seenBookings.has(bookingId)) {
      await repo.updateTransaction(t.id, { bucket: 'unreviewed', streamId: null, classifiedBy: null, note: `${t.note} — CSTL no longer shows this session as paid` });
      result.cstl.voided++;
    }
  }
}

/**
 * Mark an invoice paid by a ledger row, and file that row as the invoice's income. When you
 * link it yourself, the row is classified whatever it was; when it's matched automatically,
 * a classification you made yourself is kept.
 */
export async function linkInvoicePayment(repo: Repo, inv: Invoice, txnId: string, byUser: boolean): Promise<void> {
  const t = await repo.getTransaction(txnId);
  if (!t) return;
  await repo.updateInvoice(inv.id, { paidTransactionId: t.id });
  const mine = t.classifiedBy === 'user' || t.classifiedBy === 'import';
  const note = t.note || `Invoice ${inv.number}${inv.clientName ? ` · ${inv.clientName}` : ''}`;
  if (byUser || !mine) {
    await repo.updateTransaction(t.id, { bucket: 'business_income', streamId: inv.streamId, category: null, classifiedBy: byUser ? 'user' : 'invoice', note, meta: { invoiceId: inv.id } });
  } else {
    await repo.updateTransaction(t.id, { meta: { invoiceId: inv.id } });
  }
}

/** Payments that quote an open invoice's number, for its exact amount, settle it. */
export async function matchInvoicePayments(repo: Repo): Promise<number> {
  const invoices = await repo.listInvoices();
  if (!invoices.some((i) => i.status === 'sent' && !i.paidTransactionId)) return 0;
  let matched = 0;
  for (const t of await repo.listTransactions()) {
    const inv = invoiceForPayment(t, invoices);
    if (!inv) continue;
    await linkInvoicePayment(repo, inv, t.id, false);
    inv.paidTransactionId = t.id; // so it isn't matched twice in this run
    matched++;
  }
  return matched;
}

/** Receipts uploaded before their bank line arrived get another chance to match. */
export async function matchLooseReceipts(repo: Repo): Promise<number> {
  const receipts = (await repo.listReceipts()).filter((r) => !r.transactionId);
  if (!receipts.length) return 0;
  const txns = await repo.listTransactions();
  let matched = 0;
  for (const r of receipts) {
    const t = autoMatch(r, txns);
    if (!t) continue;
    await repo.updateReceipt(r.id, { transactionId: t.id });
    t.receiptIds.push(r.id);
    matched++;
  }
  return matched;
}

export async function runSync(repo: Repo, fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const result: SyncResult = {
    at: new Date().toISOString(),
    starling: { configured: false, accounts: 0, newRows: 0, autoClassified: 0 },
    cstl: { configured: cstlConfigured(), matchedBank: 0, cashRows: 0, otherPaid: 0, unpricedSkipped: 0, voided: 0 },
    receiptsMatched: 0,
    invoicesPaid: 0,
    errors: [],
  };
  try {
    await syncStarling(repo, result, fetchImpl);
  } catch (e) {
    result.errors.push(`Bank: ${(e as Error).message}`);
  }
  if (result.cstl.configured) {
    try {
      const start = syncWindowStart(londonDate(new Date()));
      const events = await fetchCstlEvents(start, fetchImpl);
      await applyCstlEvents(repo, events, result, londonDate(start));
    } catch (e) {
      result.errors.push(`CSTL: ${(e as Error).message}`);
    }
  }
  try {
    result.invoicesPaid = await matchInvoicePayments(repo);
  } catch (e) {
    result.errors.push(`Invoices: ${(e as Error).message}`);
  }
  try {
    result.receiptsMatched = await matchLooseReceipts(repo);
  } catch (e) {
    result.errors.push(`Receipts: ${(e as Error).message}`);
  }
  await repo.setKv('sync:last', result);
  return result;
}
