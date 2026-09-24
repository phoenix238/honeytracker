import type { Invoice, Receipt, Rule, Settings, Stream, Transaction } from '../core/types';
import type { ImportedItem } from '../core/importers';

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
  cstl: { configured: boolean; matchedBank: number; cashRows: number; otherPaid: number; unpricedSkipped: number; voided: number };
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

export interface AppState {
  transactions: Transaction[];
  streams: Stream[];
  rules: Rule[];
  receipts: Receipt[];
  settings: Settings;
  lastSync: SyncResult | null;
  cstlOther: CstlOther[];
  invoices: Invoice[];
  invoiceCounter: number;
  storage: { usedBytes: number; limitBytes: number };
  /** The Google receipt finder: whether a script key exists, and what it has sent so far. */
  google: { connected: boolean; checked: number; found: number; matched: number; lastAt: string | null };
  config: { starling: boolean; cstl: boolean; receiptsAi: boolean; aiSort: boolean; cron: boolean };
  today: string;
}

export type Classification = Partial<Pick<Transaction, 'bucket' | 'streamId' | 'category' | 'businessPercent' | 'note'>>;

export const api = {
  login: (password: string) => call<{ ok: true }>('POST', '/api/login', { password }),
  logout: () => call<{ ok: true }>('POST', '/api/logout', {}),
  state: () => call<AppState>('GET', '/api/state'),
  sync: () => call<SyncResult>('POST', '/api/sync', {}),

  classify: (id: string, patch: Classification & { date?: string; amountPence?: number; counterparty?: string }) =>
    call<Transaction>('PATCH', `/api/transactions/${id}`, patch),
  classifyMany: (ids: string[], patch: Classification) => call<Transaction[]>('POST', '/api/transactions/bulk', { ids, patch }),
  addTransaction: (t: { date: string; amountPence: number; direction: 'in' | 'out'; counterparty: string; cstlBookingId?: string } & Classification) =>
    call<Transaction>('POST', '/api/transactions', t),
  deleteTransaction: (id: string) => call<{ ok: true }>('DELETE', `/api/transactions/${id}`),
  history: (id: string) => call<{ at: string; action: string; detail: unknown }[]>('GET', `/api/transactions/${id}/history`),

  saveStream: (s: Partial<Stream> & { name: string }) => call<Stream>('POST', '/api/streams', s),
  addRule: (r: Omit<Rule, 'id' | 'createdAt'> & { applyToExisting?: boolean }) => call<{ rule: Rule; applied: number }>('POST', '/api/rules', r),
  dismissCstl: (bookingId: string) => call<{ ok: true }>('POST', '/api/cstl/dismiss', { bookingId }),
  deleteRule: (id: string) => call<{ ok: true }>('DELETE', `/api/rules/${id}`),
  saveSettings: (s: Partial<Settings>) => call<Settings>('PUT', '/api/settings', s),

  uploadReceipt: (r: { filename: string; mime: string; dataBase64: string; transactionId?: string | null }) =>
    call<{ receipt: Receipt; matchedTransactionId: string | null; readError: string; read: boolean }>('POST', '/api/receipts', r),
  updateReceipt: (id: string, patch: Partial<Receipt>) => call<Receipt>('PATCH', `/api/receipts/${id}`, patch),
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
  saveSettingsWithCounter: (s: Partial<Settings> & { nextInvoiceNumber?: number }) => call<Settings>('PUT', '/api/settings', s),

  aiRestreamImports: () => call<{ marked: number }>('POST', '/api/ai/restream-imports', {}),
  aiReadReceipts: () => call<{ read: number; tried: number; remaining: number }>('POST', '/api/ai/read-receipts', {}),
  googleConnect: () => call<{ token: string; since: string }>('POST', '/api/google/connect', {}),
  googleDisconnect: () => call<{ ok: boolean }>('POST', '/api/google/disconnect', {}),
  aiUndo: () => call<{ undone: number; kept: number; cleared: number }>('POST', '/api/ai/undo', {}),
  aiSort: () => call<{ sorted: number; skipped: number; remaining: number }>('POST', '/api/ai/sort', {}),

  importItems: (items: ImportedItem[], streamId: string | null) =>
    call<{ linked: number; created: number; skipped: number; already: number; unreadable: number; receipts: number }>('POST', '/api/import', { items, streamId }),
};

export const receiptFileUrl = (id: string) => `/api/receipts/${id}/file`;
export const invoicePdfUrl = (id: string, download = false) => `/api/invoices/${id}/pdf${download ? '?download=1' : ''}`;
export const exportCsvUrl = (year: number) => `/api/export.csv?year=${year}`;
