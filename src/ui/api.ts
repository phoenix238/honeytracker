import type { Receipt, Rule, Settings, Stream, Transaction } from '../core/types';
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
  config: { starling: boolean; cstl: boolean; receiptsAi: boolean; cron: boolean };
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

  importItems: (items: ImportedItem[], streamId: string | null) =>
    call<{ linked: number; created: number; skipped: number; receipts: number }>('POST', '/api/import', { items, streamId }),
};

export const receiptFileUrl = (id: string) => `/api/receipts/${id}/file`;
export const exportCsvUrl = (year: number) => `/api/export.csv?year=${year}`;
