import type { Invoice, Receipt, Rule, Settings, Stream, Transaction } from '../core/types';
import type { StatementLine } from '../core/bankCsv';
import type { FreshPlan, FreshProblem, FreshRow } from '../core/freshSheet';

// The app's only door to the server. Every call either returns data or throws an ApiError
// carrying the server's own message — nothing fails silently.

export class ApiError extends Error {
  constructor(public status: number, message: string, public setup = false) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No connection — nothing was saved. Try again when you’re back online.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; setup?: boolean };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Server error ${res.status}`, Boolean(data.setup));
  return data as T;
}

export interface SyncResult {
  at: string;
  starling: { configured: boolean; accounts: number; newRows: number; autoClassified: number };
  cstl: { configured: boolean; matchedBank: number; cashRows: number; otherPaid: number; bankUnlinked?: number; unpricedSkipped: number; voided: number };
  receiptsMatched: number;
  invoicesPaid: number;
  errors: string[];
}

export interface CstlOther {
  bookingId: string;
  date: string;
  amountPence: number;
  note: string;
}

/** A CSTL session paid by transfer that CSTL couldn't tie to a bank payment. */
export interface CstlBankUnlinked {
  bookingId: string;
  date: string;
  amountPence: number;
  paymentRef: string;
  clinic: string;
  note: string;
}

export interface AppState {
  transactions: Transaction[];
  streams: Stream[];
  rules: Rule[];
  receipts: Receipt[];
  settings: Settings;
  lastSync: SyncResult | null;
  cstlOther: CstlOther[];
  cstlBankUnlinked: CstlBankUnlinked[];
  invoices: Invoice[];
  invoiceCounter: number;
  storage: { usedBytes: number; limitBytes: number };
  /** The Google receipt finder: whether a script key exists, and what it has sent so far. */
  google: { connected: boolean; checked: number; found: number; matched: number; lastAt: string | null };
  config: { starling: boolean; cstl: boolean; receiptsAi: boolean; cron: boolean };
  today: string;
  /** Set once you've started fresh from your spreadsheet: it's the record up to `cutoff`. */
  fresh: { cutoff: string; at: string; canUndo: boolean } | null;
}

/** One event from your calendar, in UK time. */
export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  start: string | null;
  end: string | null;
  hours: number | null;
  location: string;
}

export type Classification = Partial<Pick<Transaction, 'bucket' | 'streamId' | 'category' | 'businessPercent' | 'note'>>;

/** One row of a batch: the decision, and the version of the row it was made against. */
export interface BatchItem {
  id: string;
  patch: Classification;
  expectUpdatedAt?: string;
  /** Leave the row alone if you'd already sorted it yourself (used for "similar" rows). */
  unlessYours?: boolean;
  /** Receipts (emailed or snapped) to attach to the row as its evidence. */
  attachReceiptIds?: string[];
  /** The invoice this money in settles — it's marked paid with the same swipe. */
  payInvoiceId?: string;
}

export interface BatchResult {
  batchId: string;
  updated: Transaction[];
  skipped: { id: string; reason: 'not found' | 'changed since' | 'yours' }[];
  ruleId: string | null;
  rule: Rule | null;
  receiptsAttached: number;
  invoicesPaid: number;
}

export const api = {
  login: (password: string) => call<{ ok: true }>('POST', '/api/login', { password }),
  logout: () => call<{ ok: true }>('POST', '/api/logout', {}),
  state: () => call<AppState>('GET', '/api/state'),
  sync: () => call<SyncResult>('POST', '/api/sync', {}),

  classify: (id: string, patch: Classification & { date?: string; amountPence?: number; counterparty?: string }) =>
    call<Transaction>('PATCH', `/api/transactions/${id}`, patch),
  classifyMany: (ids: string[], patch: Classification) => call<Transaction[]>('POST', '/api/transactions/bulk', { ids, patch }),
  saveBatch: (b: { batchId: string; items: BatchItem[]; rule?: Omit<Rule, 'id' | 'createdAt'> | null }) =>
    call<BatchResult>('POST', '/api/transactions/batch', b),
  undoBatch: (batchId: string) => call<{ undone: number; kept: number; ruleRemoved: boolean }>('POST', `/api/batches/${batchId}/undo`, {}),
  addTransaction: (t: { date: string; amountPence: number; direction: 'in' | 'out'; counterparty: string; cstlBookingId?: string } & Classification) =>
    call<Transaction>('POST', '/api/transactions', t),
  deleteTransaction: (id: string) => call<{ ok: true }>('DELETE', `/api/transactions/${id}`),
  history: (id: string) => call<{ at: string; action: string; detail: unknown }[]>('GET', `/api/transactions/${id}/history`),

  saveStream: (s: Partial<Stream> & { name: string }) => call<Stream>('POST', '/api/streams', s),
  addRule: (r: Omit<Rule, 'id' | 'createdAt'> & { applyToExisting?: boolean }) => call<{ rule: Rule; applied: number }>('POST', '/api/rules', r),
  dismissCstl: (bookingId: string) => call<{ ok: true }>('POST', '/api/cstl/dismiss', { bookingId }),
  linkCstl: (bookingId: string, transactionId: string) => call<Transaction>('POST', '/api/cstl/link', { bookingId, transactionId }),
  deleteRule: (id: string) => call<{ ok: true }>('DELETE', `/api/rules/${id}`),
  saveSettings: (s: Partial<Settings>) => call<Settings>('PUT', '/api/settings', s),

  uploadReceipt: (r: { filename: string; mime: string; dataBase64: string; transactionId?: string | null }) =>
    call<{ receipt: Receipt; matchedTransactionId: string | null; readError: string; read: boolean }>('POST', '/api/receipts', r),
  updateReceipt: (id: string, patch: Partial<Receipt>) => call<Receipt>('PATCH', `/api/receipts/${id}`, patch),
  receiptsAside: (ids: string[], notNeeded: boolean) => call<{ changed: number }>('POST', '/api/receipts/aside', { ids, notNeeded }),
  freshPreview: (dataBase64: string) => call<FreshPreview>('POST', '/api/fresh/preview', { dataBase64 }),
  freshApply: (dataBase64: string, cutoff: string) => call<{ inserted: number; removed: number; cutoff: string; streamsMade: string[]; invoices: number; receipts: number; invoicesLeftOpen: string[] }>('POST', '/api/fresh/apply', { dataBase64, cutoff }),
  freshUndo: () => call<{ restored: number; removed: number }>('POST', '/api/fresh/undo', {}),
  receiptToExpense: (id: string, body: { streamId: string | null; category?: string; date?: string; amountPence?: number; paidWith?: string }) =>
    call<Transaction>('POST', `/api/receipts/${id}/expense`, body),
  deleteReceipt: (id: string) => call<{ ok: true }>('DELETE', `/api/receipts/${id}`),

  createInvoice: (d: Partial<Invoice>) => call<Invoice>('POST', '/api/invoices', d),
  updateInvoice: (id: string, d: Partial<Invoice>) => call<Invoice>('PATCH', `/api/invoices/${id}`, d),
  deleteInvoice: (id: string) => call<{ ok: true }>('DELETE', `/api/invoices/${id}`),
  payInvoice: (id: string, body: { transactionId?: string; date?: string; method?: string }) =>
    call<{ invoice: Invoice; transaction: Transaction }>('POST', `/api/invoices/${id}/pay`, body),
  unpayInvoice: (id: string) => call<Invoice>('POST', `/api/invoices/${id}/unpay`, {}),
  invoiceCandidates: (id: string) => call<Transaction[]>('GET', `/api/invoices/${id}/candidates`),
  calendarEvents: (from: string, to: string) =>
    call<{ events: CalendarEvent[] }>('GET', `/api/calendar/events?from=${from}&to=${to}`),
  saveSettingsWithCounter: (s: Partial<Settings> & { nextInvoiceNumber?: number }) => call<Settings>('PUT', '/api/settings', s),

  googleConnect: () => call<{ token: string; since: string }>('POST', '/api/google/connect', {}),
  googleDisconnect: () => call<{ ok: boolean }>('POST', '/api/google/disconnect', {}),

  importBank: (b: { importId: string; account: string; kind: 'monzo' | 'bank'; lines: StatementLine[] }) =>
    call<{ added: number; sortedByRules: number; potMoves: number; already: number; unreadable: number }>('POST', '/api/import/bank', b),
  undoImport: (importId: string) => call<{ removed: number; kept: number }>('POST', `/api/imports/${importId}/undo`, {}),
};

export const receiptFileUrl = (id: string) => `/api/receipts/${id}/file`;
export const freshTemplateUrl = (prefill: boolean) => `/api/fresh/template.xlsx${prefill ? '' : '?prefill=0'}`;

export interface FreshPreview {
  read: { count: number; sample: FreshRow[]; problems: FreshProblem[]; columns: string[] };
  plan: FreshPlan | null;
}
export const invoicePdfUrl = (id: string, download = false) => `/api/invoices/${id}/pdf${download ? '?download=1' : ''}`;
export const exportCsvUrl = (year: number) => `/api/export.csv?year=${year}`;
export const exportEditUrl = (year: number | 'all') => `/api/export-edit.csv?year=${year}`;
export const exportWorkbookUrl = (year: number) => `/api/export.xlsx?year=${year}`;
