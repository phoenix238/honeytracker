import { getDb, ConfigError } from './db.js';
import { repo as makeRepo, type Repo, type NewTransaction } from './repo.js';
import { AuthConfigError, checkPassword, clearCookie, isCron, isSignedIn, sessionCookie } from './auth.js';
import { runSync, cstlConfigured, type SyncResult } from './sync.js';
import { starlingTokens } from './starling.js';
import { extractReceipt, receiptsAiConfigured } from './receipts.js';
import { applyRule, findRule } from '../src/core/rules.js';
import { autoMatch } from '../src/core/receiptMatch.js';
import { findBankTwin, type ImportedItem } from '../src/core/importers.js';
import { ledgerCsv } from '../src/core/exportCsv.js';
import { invoiceTotal, paymentCandidates } from '../src/core/invoices.js';
import { buildInvoicePdf } from './invoicePdf.js';
import { AI_SORT_BATCH, aiSortBatch, pickExamples } from './aiSort.js';
import { linkInvoicePayment } from './sync.js';
import { isCategory } from '../src/core/hmrc.js';
import { taxYearBounds, taxYearOf, today, withinBounds } from '../src/core/dates.js';
import type { Bucket, BusinessProfile, Direction, Invoice, InvoiceLine, Settings, Stream, TaxYearFacts, Transaction } from '../src/core/types.js';
import { DEFAULT_PROFILE } from '../src/core/types.js';
import { addDays } from '../src/core/dates.js';

// The whole API as one web-standard handler: Request in, Response out. The Vercel function
// and the local dev server both just call handle(), and the tests call it directly.

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

const BUCKETS: Bucket[] = ['unreviewed', 'business_income', 'business_expense', 'personal', 'transfer'];
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  // Mutations must be JSON: blocks a cross-site <form> post from ever reaching a handler.
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw new HttpError(415, 'Expected JSON');
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const pence = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000_000) throw new HttpError(400, 'Amount must be whole pence');
  return n;
};

/** Validate a classification patch from the app. Clears fields that don't apply to the bucket. */
function classification(b: Record<string, unknown>, current?: Transaction) {
  const patch: Partial<Pick<Transaction, 'bucket' | 'streamId' | 'category' | 'businessPercent' | 'note'>> = {};
  if (b.bucket !== undefined) {
    if (!BUCKETS.includes(b.bucket as Bucket)) throw new HttpError(400, 'Unknown classification');
    patch.bucket = b.bucket as Bucket;
  }
  if (b.streamId !== undefined) patch.streamId = b.streamId === null ? null : str(b.streamId, 64);
  if (b.category !== undefined) {
    if (b.category !== null && !isCategory(b.category)) throw new HttpError(400, 'Unknown category');
    patch.category = b.category as Transaction['category'];
  }
  if (b.businessPercent !== undefined) {
    const p = Number(b.businessPercent);
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new HttpError(400, 'Business % must be 0–100');
    patch.businessPercent = Math.round(p);
  }
  if (b.note !== undefined) patch.note = str(b.note, 1000);
  const bucket = patch.bucket ?? current?.bucket;
  if (bucket && bucket !== 'business_income' && bucket !== 'business_expense') patch.streamId = null;
  if (bucket && bucket !== 'business_expense') {
    patch.category = null;
    patch.businessPercent = 100;
  }
  if (bucket === 'business_expense' && !(patch.category ?? current?.category)) patch.category = 'otherExpenses';
  return patch;
}

async function dropCstlOther(r: Repo, bookingId: string): Promise<void> {
  const list = (await r.getKv<{ bookingId: string }[]>('cstl:other')) ?? [];
  await r.setKv('cstl:other', list.filter((x) => x.bookingId !== bookingId));
}

/** The database plan's size limit. Neon's free plan is 0.5 GB; set DB_STORAGE_LIMIT_MB after upgrading. */
function storageLimitBytes(): number {
  const mb = Number(process.env.DB_STORAGE_LIMIT_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 512) * 1024 * 1024;
}

function invoiceDraft(b: Record<string, unknown>, current?: Invoice, terms = 14) {
  const lines: InvoiceLine[] = [];
  if (b.lines !== undefined) {
    if (!Array.isArray(b.lines) || b.lines.length > 50) throw new HttpError(400, 'Up to 50 lines per invoice');
    for (const raw of b.lines as Record<string, unknown>[]) {
      const quantity = Number(raw?.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000) throw new HttpError(400, 'Each line needs a quantity above zero');
      lines.push({ description: str(raw?.description, 500), quantity: Math.round(quantity * 100) / 100, unitPence: pence(raw?.unitPence) });
    }
  }
  const issueDate = b.issueDate !== undefined ? (isDate(b.issueDate) ? b.issueDate : null) : current?.issueDate ?? today();
  if (!issueDate) throw new HttpError(400, 'Bad invoice date');
  const dueDate = b.dueDate !== undefined ? (isDate(b.dueDate) ? b.dueDate : null) : current?.dueDate ?? addDays(issueDate, terms);
  if (!dueDate) throw new HttpError(400, 'Bad due date');
  return {
    streamId: b.streamId !== undefined ? (b.streamId ? str(b.streamId, 64) : null) : current?.streamId ?? null,
    clientName: b.clientName !== undefined ? str(b.clientName, 200) : current?.clientName ?? '',
    clientEmail: b.clientEmail !== undefined ? str(b.clientEmail, 200) : current?.clientEmail ?? '',
    clientAddress: b.clientAddress !== undefined ? str(b.clientAddress, 500) : current?.clientAddress ?? '',
    issueDate,
    dueDate,
    lines: b.lines !== undefined ? lines : current?.lines ?? [],
    notes: b.notes !== undefined ? str(b.notes, 1000) : current?.notes ?? '',
    status: (current?.status ?? 'draft') as Invoice['status'],
  };
}

function profileFrom(b: Partial<BusinessProfile> | undefined, current: BusinessProfile): BusinessProfile {
  if (!b) return current;
  const pick = (k: keyof BusinessProfile, max: number) => (b[k] !== undefined ? str(b[k], max) : (current[k] as string));
  const terms = b.paymentTermsDays !== undefined ? Math.round(Number(b.paymentTermsDays)) : current.paymentTermsDays;
  return {
    name: pick('name', 120),
    businessName: pick('businessName', 120),
    address: pick('address', 400),
    email: pick('email', 200),
    phone: pick('phone', 60),
    sortCode: pick('sortCode', 20),
    accountNumber: pick('accountNumber', 20),
    invoicePrefix: (pick('invoicePrefix', 12) || DEFAULT_PROFILE.invoicePrefix).replace(/[^\w-]/g, ''),
    paymentTermsDays: Number.isFinite(terms) && terms >= 0 && terms <= 365 ? terms : current.paymentTermsDays,
    footer: pick('footer', 500),
  };
}

/** Rows the AI may decide: unsorted, business with no stream yet, or flagged to re-stream. Never yours. */
function needsAi(t: Transaction): boolean {
  if (t.classifiedBy === 'user') return false;
  if (t.bucket === 'unreviewed') return true;
  const business = t.bucket === 'business_income' || t.bucket === 'business_expense';
  return business && (!t.streamId || t.meta.aiRestream === '1');
}

function config() {
  return {
    starling: starlingTokens().length > 0,
    cstl: cstlConfigured(),
    receiptsAi: receiptsAiConfigured(),
    aiSort: receiptsAiConfigured(),
    cron: Boolean(process.env.CRON_SECRET?.trim()),
  };
}

async function state(r: Repo) {
  const [transactions, streams, rules, receipts, settings, lastSync, cstlOther, invoices, invoiceCounter, dbBytes] = await Promise.all([
    r.listTransactions(),
    r.listStreams(),
    r.listRules(),
    r.listReceipts(),
    r.getSettings(),
    r.getKv<SyncResult>('sync:last'),
    r.getKv<unknown[]>('cstl:other'),
    r.listInvoices(),
    r.peekInvoiceCounter(),
    r.databaseBytes().catch(() => 0),
  ]);
  return {
    transactions, streams, rules, receipts, settings, lastSync, cstlOther: cstlOther ?? [], invoices, invoiceCounter,
    storage: { usedBytes: dbBytes, limitBytes: storageLimitBytes() },
    config: config(), today: today(),
  };
}

type Handler = (req: Request, r: Repo, params: string[], url: URL) => Promise<Response>;

const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/state$/, async (_req, r) => json(await state(r))],

  // ── Transactions ──────────────────────────────────────────────────────────────────
  ['PATCH', /^\/api\/transactions\/([\w-]+)$/, async (req, r, [id]) => {
    const current = await r.getTransaction(id!);
    if (!current) throw new HttpError(404, 'Not found');
    const b = await body(req);
    const patch = classification(b, current);
    const extra: Partial<Pick<Transaction, 'date' | 'amountPence' | 'counterparty'>> = {};
    // Only rows you typed in can have their facts edited; bank rows are what the bank says.
    if (current.source === 'cash' || current.source === 'manual') {
      if (b.date !== undefined) { if (!isDate(b.date)) throw new HttpError(400, 'Bad date'); extra.date = b.date; }
      if (b.amountPence !== undefined) extra.amountPence = pence(b.amountPence);
      if (b.counterparty !== undefined) extra.counterparty = str(b.counterparty, 200);
    }
    const updated = await r.updateTransaction(id!, { ...patch, ...extra, classifiedBy: 'user' });
    return json(updated);
  }],

  ['POST', /^\/api\/transactions\/bulk$/, async (req, r) => {
    const b = await body<{ ids?: unknown; patch?: Record<string, unknown> }>(req);
    const ids = Array.isArray(b.ids) ? b.ids.map((x) => str(x, 64)).filter(Boolean).slice(0, 500) : [];
    const out: Transaction[] = [];
    for (const id of ids) {
      const current = await r.getTransaction(id);
      if (!current) continue;
      const t = await r.updateTransaction(id, { ...classification(b.patch ?? {}, current), classifiedBy: 'user' });
      if (t) out.push(t);
    }
    return json(out);
  }],

  ['POST', /^\/api\/transactions$/, async (req, r) => {
    const b = await body(req);
    if (!isDate(b.date)) throw new HttpError(400, 'Bad date');
    const direction: Direction = b.direction === 'out' ? 'out' : 'in';
    const amountPence = pence(b.amountPence);
    if (amountPence <= 0) throw new HttpError(400, 'Amount must be more than zero');
    const cls = classification({ bucket: b.bucket ?? 'unreviewed', streamId: b.streamId ?? null, category: b.category ?? null, businessPercent: b.businessPercent ?? 100, note: b.note ?? '' });
    // A CSTL session paid by card/other, added from the list sync leaves for you.
    const cstlBooking = b.cstlBookingId ? str(b.cstlBookingId, 64) : '';
    const row: NewTransaction = {
      date: b.date, amountPence, direction,
      source: cstlBooking ? 'cstl' : b.source === 'manual' ? 'manual' : 'cash',
      sourceId: cstlBooking ? `booking:${cstlBooking}` : null,
      counterparty: str(b.counterparty, 200), reference: '', bucket: cls.bucket ?? 'unreviewed', streamId: cls.streamId ?? null,
      category: cls.category ?? null, businessPercent: cls.businessPercent ?? 100, note: cls.note ?? '', classifiedBy: 'user',
      meta: cstlBooking ? { cstlBookingId: cstlBooking } : {},
    };
    const created = await r.insertTransaction(row);
    if (!created) throw new HttpError(409, 'That session is already in the ledger.');
    if (cstlBooking) await dropCstlOther(r, cstlBooking);
    return json(created, 201);
  }],

  // "It's already in the bank" — take a card/other CSTL session off the list for good.
  ['POST', /^\/api\/cstl\/dismiss$/, async (req, r) => {
    const b = await body(req);
    const id = str(b.bookingId, 64);
    const dismissed = (await r.getKv<string[]>('cstl:dismissed')) ?? [];
    if (id && !dismissed.includes(id)) await r.setKv('cstl:dismissed', [...dismissed, id]);
    await dropCstlOther(r, id);
    return json({ ok: true });
  }],

  ['DELETE', /^\/api\/transactions\/([\w-]+)$/, async (_req, r, [id]) => {
    const t = await r.getTransaction(id!);
    if (!t) throw new HttpError(404, 'Not found');
    // Bank rows can't be deleted — they'd come straight back on the next sync, and a gap in
    // the bank record is exactly what a tax enquiry looks for. Classify them as personal.
    if (t.source === 'starling') throw new HttpError(400, 'Bank rows can’t be deleted — mark it Personal instead.');
    await r.deleteTransaction(id!);
    return json({ ok: true });
  }],

  ['GET', /^\/api\/transactions\/([\w-]+)\/history$/, async (_req, r, [id]) => json(await r.history(id!))],

  // ── Streams ───────────────────────────────────────────────────────────────────────
  ['POST', /^\/api\/streams$/, async (req, r) => {
    const b = await body(req);
    const name = str(b.name, 80).trim();
    if (!name) throw new HttpError(400, 'Give the stream a name');
    const stream: Omit<Stream, 'id'> & { id?: string } = {
      id: b.id ? str(b.id, 64) : undefined,
      name,
      kind: b.kind === 'other' ? 'other' : 'self_employment',
      color: /^#[0-9a-f]{6}$/i.test(str(b.color)) ? str(b.color) : '#E0A92E',
      archived: b.archived === true,
    };
    return json(await r.saveStream(stream));
  }],

  // ── Rules ─────────────────────────────────────────────────────────────────────────
  ['POST', /^\/api\/rules$/, async (req, r) => {
    const b = await body(req);
    const pattern = str(b.pattern, 120).trim();
    if (pattern.length < 2) throw new HttpError(400, 'Pattern is too short');
    const cls = classification({ bucket: b.bucket, streamId: b.streamId ?? null, category: b.category ?? null, businessPercent: b.businessPercent ?? 100 });
    if (!cls.bucket || cls.bucket === 'unreviewed') throw new HttpError(400, 'Pick what it should become');
    const rule = await r.insertRule({
      field: b.field === 'reference' ? 'reference' : 'counterparty',
      pattern,
      direction: b.direction === 'in' || b.direction === 'out' ? b.direction : null,
      bucket: cls.bucket,
      streamId: cls.streamId ?? null,
      category: cls.category ?? null,
      businessPercent: cls.businessPercent ?? 100,
    });
    // Apply to everything already waiting in the inbox, too.
    let applied = 0;
    if (b.applyToExisting !== false) {
      const rules = await r.listRules();
      for (const t of await r.listTransactions()) {
        if (t.bucket !== 'unreviewed' || findRule(rules, t)?.id !== rule.id) continue;
        const next = applyRule(rule, t);
        await r.updateTransaction(t.id, { bucket: next.bucket, streamId: next.streamId, category: next.category, businessPercent: next.businessPercent, classifiedBy: 'rule' });
        applied++;
      }
    }
    return json({ rule, applied }, 201);
  }],
  ['DELETE', /^\/api\/rules\/([\w-]+)$/, async (_req, r, [id]) => {
    await r.deleteRule(id!);
    return json({ ok: true });
  }],

  // ── Settings ──────────────────────────────────────────────────────────────────────
  ['PUT', /^\/api\/settings$/, async (req, r) => {
    const b = await body<Partial<Settings>>(req);
    const current = await r.getSettings();
    const taxYears: Record<string, TaxYearFacts> = { ...current.taxYears };
    for (const [year, f] of Object.entries(b.taxYears ?? {})) {
      if (!/^\d{4}$/.test(year) || !f) continue;
      const opt = (v: unknown) => (v === null || v === undefined || v === '' ? null : pence(v));
      taxYears[year] = {
        employmentIncomePence: pence(f.employmentIncomePence ?? 0),
        payeTaxPence: pence(f.payeTaxPence ?? 0),
        priorYearLiabilityPence: opt(f.priorYearLiabilityPence),
        paidToHmrcPence: pence(f.paidToHmrcPence ?? 0),
        expectedProfitPence: opt(f.expectedProfitPence),
      };
    }
    const nb = b as Partial<Settings> & { nextInvoiceNumber?: unknown };
    if (nb.nextInvoiceNumber !== undefined) {
      const n = Math.round(Number(nb.nextInvoiceNumber));
      if (!Number.isFinite(n) || n < 1 || n > 999_999) throw new HttpError(400, 'Invoice number must be 1 or more');
      await r.setInvoiceCounter(n);
    }
    const next: Settings = {
      name: b.name !== undefined ? str(b.name, 80) : current.name,
      profile: profileFrom(b.profile, current.profile),
      receiptThresholdPence: b.receiptThresholdPence !== undefined ? pence(b.receiptThresholdPence) : current.receiptThresholdPence,
      cstlStreamId: b.cstlStreamId !== undefined ? (b.cstlStreamId ? str(b.cstlStreamId, 64) : null) : current.cstlStreamId,
      taxYears,
    };
    await r.saveSettings(next);
    return json(next);
  }],

  // ── Receipts ──────────────────────────────────────────────────────────────────────
  ['POST', /^\/api\/receipts$/, async (req, r) => {
    const b = await body(req);
    const mime = str(b.mime, 100);
    const data = str(b.dataBase64, 8_000_000);
    if (!data || Buffer.byteLength(data, 'base64') > MAX_UPLOAD_BYTES) throw new HttpError(400, 'File missing or over 4MB');
    if (!/^(image\/(jpeg|png|webp|gif|heic)|application\/pdf)$/.test(mime)) throw new HttpError(400, 'Receipts must be a photo or PDF');
    let extracted = null;
    let readError = '';
    if (receiptsAiConfigured()) {
      try {
        extracted = await extractReceipt(mime, data);
      } catch (e) {
        readError = (e as Error).message.slice(0, 200);
      }
    }
    const txnId = b.transactionId ? str(b.transactionId, 64) : null;
    if (txnId && !(await r.getTransaction(txnId))) throw new HttpError(404, 'That transaction no longer exists');
    const receipt = await r.insertReceipt(
      {
        filename: str(b.filename, 200) || 'receipt',
        mime,
        merchant: extracted?.merchant ?? '',
        date: extracted?.date ?? null,
        totalPence: extracted?.totalPence ?? null,
        vatPence: extracted?.vatPence ?? null,
        suggestedCategory: extracted?.category ?? null,
        description: extracted?.description ?? '',
        transactionId: txnId,
      },
      data,
    );
    if (!receipt) throw new HttpError(500, 'Receipt was not saved');
    let matched: Transaction | null = null;
    if (!txnId) {
      matched = autoMatch(receipt, await r.listTransactions());
      if (matched) await r.updateReceipt(receipt.id, { transactionId: matched.id });
    }
    const linkedId = txnId ?? matched?.id ?? null;
    // Evidence that arrives for an unreviewed row is a strong hint it's a business cost.
    if (linkedId) {
      const t = await r.getTransaction(linkedId);
      if (t && t.bucket === 'unreviewed' && receipt.suggestedCategory) {
        await r.updateTransaction(t.id, { bucket: 'business_expense', category: receipt.suggestedCategory, classifiedBy: 'rule' });
      }
    }
    return json({ receipt: await r.getReceipt(receipt.id), matchedTransactionId: linkedId, readError, read: Boolean(extracted) }, 201);
  }],
  ['GET', /^\/api\/receipts\/([\w-]+)\/file$/, async (_req, r, [id]) => {
    const f = await r.getReceiptFile(id!);
    if (!f) throw new HttpError(404, 'Not found');
    return new Response(new Uint8Array(f.data), {
      headers: {
        'Content-Type': f.mime,
        'Content-Disposition': `inline; filename="${f.filename.replace(/[^\w.-]/g, '_')}"`,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }],
  ['PATCH', /^\/api\/receipts\/([\w-]+)$/, async (req, r, [id]) => {
    const b = await body(req);
    const patch: Parameters<Repo['updateReceipt']>[1] = {};
    if (b.transactionId !== undefined) {
      patch.transactionId = b.transactionId ? str(b.transactionId, 64) : null;
      if (patch.transactionId && !(await r.getTransaction(patch.transactionId))) throw new HttpError(404, 'That transaction no longer exists');
    }
    if (b.merchant !== undefined) patch.merchant = str(b.merchant, 200);
    if (b.date !== undefined) patch.date = isDate(b.date) ? b.date : null;
    if (b.totalPence !== undefined) patch.totalPence = b.totalPence === null ? null : pence(b.totalPence);
    if (b.suggestedCategory !== undefined) patch.suggestedCategory = isCategory(b.suggestedCategory) ? b.suggestedCategory : null;
    if (b.description !== undefined) patch.description = str(b.description, 500);
    const updated = await r.updateReceipt(id!, patch);
    if (!updated) throw new HttpError(404, 'Not found');
    return json(updated);
  }],
  // Paid in cash or on a card that isn't synced: the receipt becomes its own expense row.
  ['POST', /^\/api\/receipts\/([\w-]+)\/expense$/, async (req, r, [id]) => {
    const receipt = await r.getReceipt(id!);
    if (!receipt) throw new HttpError(404, 'Not found');
    const b = await body(req);
    const date = isDate(b.date) ? b.date : receipt.date;
    const amountPence = b.amountPence !== undefined ? pence(b.amountPence) : receipt.totalPence;
    if (!date || !amountPence) throw new HttpError(400, 'Needs a date and an amount');
    const category = isCategory(b.category) ? b.category : receipt.suggestedCategory ?? 'otherExpenses';
    const t = await r.insertTransaction({
      date, amountPence, direction: 'out', source: 'cash', sourceId: null, counterparty: receipt.merchant, reference: '',
      bucket: 'business_expense', streamId: b.streamId ? str(b.streamId, 64) : null, category, businessPercent: 100,
      note: receipt.description, classifiedBy: 'user', meta: { paidWith: str(b.paidWith, 40) || 'cash' },
    });
    if (!t) throw new HttpError(500, 'Not saved');
    await r.updateReceipt(receipt.id, { transactionId: t.id });
    return json(await r.getTransaction(t.id), 201);
  }],
  ['DELETE', /^\/api\/receipts\/([\w-]+)$/, async (_req, r, [id]) => {
    await r.deleteReceipt(id!);
    return json({ ok: true });
  }],

  // ── Invoices ──────────────────────────────────────────────────────────────────────
  ['POST', /^\/api\/invoices$/, async (req, r) => {
    const b = await body(req);
    const settings = await r.getSettings();
    const draft = invoiceDraft(b, undefined, settings.profile.paymentTermsDays);
    const number = await r.nextInvoiceNumber(settings.profile.invoicePrefix || DEFAULT_PROFILE.invoicePrefix);
    return json(await r.insertInvoice(draft, number), 201);
  }],
  ['PATCH', /^\/api\/invoices\/([\w-]+)$/, async (req, r, [id]) => {
    const cur = await r.getInvoice(id!);
    if (!cur) throw new HttpError(404, 'Not found');
    if (cur.paidTransactionId) throw new HttpError(400, 'This invoice is paid — mark it unpaid first to change it.');
    const b = await body(req);
    const next = invoiceDraft(b, cur);
    if (b.status !== undefined) {
      if (!['draft', 'sent', 'void'].includes(String(b.status))) throw new HttpError(400, 'Unknown status');
      next.status = b.status as Invoice['status'];
    }
    if (next.status === 'sent' && (!next.clientName.trim() || next.lines.length === 0 || invoiceTotal(next) <= 0)) {
      throw new HttpError(400, 'An invoice needs a client and at least one line with an amount before it’s sent.');
    }
    return json(await r.updateInvoice(id!, next));
  }],
  ['DELETE', /^\/api\/invoices\/([\w-]+)$/, async (_req, r, [id]) => {
    const cur = await r.getInvoice(id!);
    if (!cur) throw new HttpError(404, 'Not found');
    // A sent invoice is part of your records — void it instead, so its number isn't reused.
    if (cur.status !== 'draft') throw new HttpError(400, 'Only drafts can be deleted — void a sent invoice instead.');
    await r.deleteInvoice(id!);
    return json({ ok: true });
  }],
  // Settle an invoice: with a bank payment already in the ledger, or as cash received.
  ['POST', /^\/api\/invoices\/([\w-]+)\/pay$/, async (req, r, [id]) => {
    const inv = await r.getInvoice(id!);
    if (!inv) throw new HttpError(404, 'Not found');
    if (inv.paidTransactionId) throw new HttpError(400, 'Already paid');
    if (inv.status === 'void') throw new HttpError(400, 'This invoice is void');
    const b = await body(req);
    let txnId: string;
    if (b.transactionId) {
      const t = await r.getTransaction(str(b.transactionId, 64));
      if (!t || t.direction !== 'in') throw new HttpError(400, 'Pick a payment that came in');
      if (t.meta.invoiceId) throw new HttpError(400, 'That payment already settles another invoice');
      txnId = t.id;
    } else {
      const date = isDate(b.date) ? b.date : today();
      const created = await r.insertTransaction({
        date, amountPence: invoiceTotal(inv), direction: 'in', source: 'cash', sourceId: null,
        counterparty: inv.clientName, reference: inv.number, bucket: 'business_income', streamId: inv.streamId,
        category: null, businessPercent: 100, note: `Invoice ${inv.number} · ${str(b.method, 30) || 'cash'}`,
        classifiedBy: 'invoice', meta: { invoiceId: inv.id },
      });
      if (!created) throw new HttpError(500, 'Payment not saved');
      txnId = created.id;
    }
    await linkInvoicePayment(r, inv, txnId, true);
    return json({ invoice: await r.getInvoice(inv.id), transaction: await r.getTransaction(txnId) });
  }],
  ['POST', /^\/api\/invoices\/([\w-]+)\/unpay$/, async (_req, r, [id]) => {
    const inv = await r.getInvoice(id!);
    if (!inv?.paidTransactionId) throw new HttpError(400, 'Not paid');
    const t = await r.getTransaction(inv.paidTransactionId);
    await r.updateInvoice(inv.id, { paidTransactionId: null });
    if (t) {
      // A cash payment recorded only for this invoice goes with it; a bank row stays (it's the bank's record).
      if (t.source === 'cash' && t.meta.invoiceId === inv.id) await r.deleteTransaction(t.id);
      else await r.updateTransaction(t.id, { meta: { invoiceId: '' } });
    }
    return json(await r.getInvoice(inv.id));
  }],
  ['GET', /^\/api\/invoices\/([\w-]+)\/candidates$/, async (_req, r, [id]) => {
    const inv = await r.getInvoice(id!);
    if (!inv) throw new HttpError(404, 'Not found');
    return json(paymentCandidates(inv, await r.listTransactions()).slice(0, 10));
  }],
  ['GET', /^\/api\/invoices\/([\w-]+)\/pdf$/, async (_req, r, [id], url) => {
    const inv = await r.getInvoice(id!);
    if (!inv) throw new HttpError(404, 'Not found');
    const paid = inv.paidTransactionId ? await r.getTransaction(inv.paidTransactionId) : null;
    const settings = await r.getSettings();
    const bytes = await buildInvoicePdf(inv, settings.profile, paid?.date ?? null);
    const kind = paid ? 'receipt' : 'invoice';
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename="${kind}-${inv.number.replace(/[^\w-]/g, '')}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  }],

  // ── AI sorting ────────────────────────────────────────────────────────────────────
  // Sorts the next batch of rows that need a decision: unreviewed rows, business rows with no
  // stream yet (e.g. imported from the old app, which had no streams), and imported rows you've
  // asked to have re-streamed. The app calls this repeatedly, one batch per request, so no
  // single request runs long; each sorted row waits for your check.
  ['POST', /^\/api\/ai\/sort$/, async (_req, r) => {
    if (!receiptsAiConfigured()) throw new HttpError(400, 'Add ANTHROPIC_API_KEY in Vercel to use AI sorting.');
    const all = await r.listTransactions();
    // A row the AI already looked at and skipped isn't offered again — it's yours to sort.
    const waiting = all.filter((t) => needsAi(t) && !t.meta.aiTried);
    const batch = waiting.slice(0, AI_SORT_BATCH);
    if (!batch.length) return json({ sorted: 0, skipped: 0, remaining: 0 });
    const [streams, rules] = await Promise.all([r.listStreams(), r.listRules()]);
    const decisions = await aiSortBatch(batch, streams, rules, pickExamples(all));
    let sorted = 0;
    for (const d of decisions) {
      const current = all.find((t) => t.id === d.id);
      if (!current || !needsAi(current)) continue; // you sorted it meanwhile
      await r.updateTransaction(d.id, {
        bucket: d.bucket, streamId: d.streamId, category: d.category, businessPercent: d.businessPercent,
        classifiedBy: 'ai', meta: { aiReason: d.reason, aiConfidence: d.confidence, aiRestream: '' },
      });
      sorted++;
    }
    const decided = new Set(decisions.map((d) => d.id));
    for (const t of batch) if (!decided.has(t.id)) await r.updateTransaction(t.id, { meta: { aiTried: '1', aiRestream: '' } });
    return json({ sorted, skipped: batch.length - sorted, remaining: waiting.length - batch.length });
  }],
  // Put everything imported from the old app back through the AI to choose its stream — for
  // when the import filed it all under one stream.
  ['POST', /^\/api\/ai\/restream-imports$/, async (_req, r) => {
    let marked = 0;
    for (const t of await r.listTransactions()) {
      if (t.classifiedBy !== 'import' || (t.bucket !== 'business_income' && t.bucket !== 'business_expense')) continue;
      await r.updateTransaction(t.id, { meta: { aiRestream: '1', aiTried: '' } });
      marked++;
    }
    return json({ marked });
  }],

  // ── Sync ──────────────────────────────────────────────────────────────────────────
  ['POST', /^\/api\/sync$/, async (_req, r) => json(await runSync(r))],

  // ── Import from the old apps ──────────────────────────────────────────────────────
  ['POST', /^\/api\/import$/, async (req, r) => {
    const b = await body<{ items?: ImportedItem[]; streamId?: string | null }>(req);
    const items = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
    const streamId = b.streamId ? str(b.streamId, 64) : null;
    const bank = (await r.listTransactions()).filter((t) => t.source === 'starling');
    // Bank rows already claimed by an earlier import batch stay claimed.
    const claimed = new Set(bank.filter((t) => t.meta.importedFrom).map((t) => t.id));
    const out = { linked: 0, created: 0, skipped: 0, receipts: 0 };
    for (const it of items) {
      if (!isDate(it.date) || !Number.isInteger(it.amountPence) || it.amountPence <= 0) { out.skipped++; continue; }
      if (await r.findBySource('import', str(it.sourceId, 120))) { out.skipped++; continue; }
      const already = bank.find((t) => t.meta.importedFrom === it.sourceId);
      if (already) { out.skipped++; continue; }
      const twin = findBankTwin(it, bank, claimed);
      const isIncome = it.kind === 'income';
      const category = isCategory(it.category) ? it.category : 'otherExpenses';
      let txnId: string;
      if (twin) {
        claimed.add(twin.id);
        const untouched = twin.bucket === 'unreviewed';
        await r.updateTransaction(twin.id, {
          ...(untouched ? { bucket: isIncome ? 'business_income' : 'business_expense', streamId, category: isIncome ? null : category, classifiedBy: 'import' as const } : {}),
          note: twin.note || str(it.label, 300),
          meta: { importedFrom: it.sourceId },
        });
        txnId = twin.id;
        out.linked++;
      } else {
        const created = await r.insertTransaction({
          date: it.date, amountPence: it.amountPence, direction: isIncome ? 'in' : 'out', source: 'import', sourceId: str(it.sourceId, 120),
          counterparty: str(it.label, 200), reference: '', bucket: isIncome ? 'business_income' : 'business_expense', streamId,
          category: isIncome ? null : category, businessPercent: 100,
          note: 'Imported from Honey — not found in the bank feed (cash, or another account?)', classifiedBy: 'import', meta: { importedFrom: it.sourceId },
        });
        if (!created) { out.skipped++; continue; }
        txnId = created.id;
        out.created++;
      }
      // Only photos and PDFs: the stored type is served back later, so an imported
      // "text/html" would otherwise become a page on this app's own origin.
      const m = /^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(str(it.imageDataUrl, 8_000_000));
      if (m) {
        const saved = await r.insertReceipt(
          { filename: `${str(it.label, 60) || 'receipt'}.jpg`, mime: m[1]!, merchant: str(it.label, 200), date: it.date, totalPence: it.amountPence, vatPence: null, suggestedCategory: isIncome ? null : category, description: 'Imported from Honey', transactionId: txnId },
          m[2]!,
          `${it.sourceId}:image`,
        );
        if (saved) out.receipts++;
      }
    }
    return json(out);
  }],

  // ── Export ────────────────────────────────────────────────────────────────────────
  ['GET', /^\/api\/export\.csv$/, async (_req, r, _p, url) => {
    const year = Number(url.searchParams.get('year')) || taxYearOf(today());
    const bounds = taxYearBounds(year);
    const txns = (await r.listTransactions()).filter((t) => withinBounds(t.date, bounds));
    const csv = ledgerCsv(txns, await r.listStreams());
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ledger-${year}-${String((year + 1) % 100).padStart(2, '0')}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }],
];

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Behind the vercel.json rewrite the original path arrives as ?__path=…
  const rewritten = url.searchParams.get('__path');
  const path = rewritten ? `/api/${rewritten.replace(/^\/+/, '')}` : url.pathname.replace(/\/+$/, '') || '/';
  const secure = url.protocol === 'https:';
  const res = await route(req, url, path, secure);
  // Which path the server actually saw — so a routing problem on the host is visible.
  res.headers.set('X-Honey-Path', path);
  return res;
}

async function route(req: Request, url: URL, path: string, secure: boolean): Promise<Response> {
  try {
    if (path === '/api/health') return json({ ok: true });

    if (path === '/api/login' && req.method === 'POST') {
      const b = await body<{ password?: string }>(req);
      if (!checkPassword(str(b.password, 200))) {
        await new Promise((res) => setTimeout(res, 600)); // slow down guessing
        throw new HttpError(401, 'Wrong password');
      }
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(secure) });
    }
    if (path === '/api/logout' && req.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(secure) });

    if (path === '/api/cron' && req.method === 'GET') {
      if (!isCron(req.headers.get('authorization'))) throw new HttpError(401, 'Not authorised');
      return json(await runSync(makeRepo(await getDb())));
    }

    if (!isSignedIn(req.headers.get('cookie'))) throw new HttpError(401, 'Not signed in');

    for (const [method, pattern, handler] of routes) {
      if (method !== req.method) continue;
      const m = pattern.exec(path);
      if (m) return await handler(req, makeRepo(await getDb()), m.slice(1), url);
    }
    throw new HttpError(404, 'No such endpoint');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof AuthConfigError || e instanceof ConfigError) return json({ error: e.message, setup: true }, 503);
    console.error(e);
    // Single-user app: showing the real cause beats a mystery.
    return json({ error: `Server error: ${(e as Error)?.message ?? String(e)}`.slice(0, 400) }, 500);
  }
}
