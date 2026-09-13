import type { Income, Expense, Invoice, Client, Settings } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import type { GoogleAuth } from '../integrations/google';
import { STORES, getAll, put, del, getKeyed, putKeyed } from './db';

// Typed CRUD over the IndexedDB stores. The rest of the app talks to this, never to db.ts
// directly, so the storage shape stays swappable (a sync backend slots in behind here later).

const SETTINGS_KEY = 'settings';
// Deliberately its own meta key, separate from settings — so a Gmail token never rides along
// in the JSON backup export/import, which is meant to be a shareable, storable file.
const GOOGLE_AUTH_KEY = 'googleAuth';

export const repository = {
  async loadIncome(): Promise<Income[]> {
    return getAll<Income>(STORES.income);
  },
  async saveIncome(income: Income): Promise<void> {
    return put(STORES.income, income);
  },
  async deleteIncome(id: string): Promise<void> {
    return del(STORES.income, id);
  },

  async loadExpenses(): Promise<Expense[]> {
    return getAll<Expense>(STORES.expenses);
  },
  async saveExpense(expense: Expense): Promise<void> {
    return put(STORES.expenses, expense);
  },
  /** Deletes the expense and, if it had one, its photo — no orphaned blobs. */
  async deleteExpense(expense: Expense): Promise<void> {
    await del(STORES.expenses, expense.id);
    if (expense.imageId) await del(STORES.images, expense.imageId);
  },

  async loadInvoices(): Promise<Invoice[]> {
    return getAll<Invoice>(STORES.invoices);
  },
  async saveInvoice(invoice: Invoice): Promise<void> {
    return put(STORES.invoices, invoice);
  },
  async deleteInvoice(id: string): Promise<void> {
    return del(STORES.invoices, id);
  },

  async loadClients(): Promise<Client[]> {
    return getAll<Client>(STORES.clients);
  },
  async saveClient(client: Client): Promise<void> {
    return put(STORES.clients, client);
  },
  async deleteClient(id: string): Promise<void> {
    return del(STORES.clients, id);
  },

  async loadSettings(): Promise<Settings> {
    const stored = await getKeyed<Partial<Settings>>(STORES.meta, SETTINGS_KEY);
    // Merge over defaults so a new field added later is never undefined on an old store.
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  },
  async saveSettings(settings: Settings): Promise<void> {
    return putKeyed(STORES.meta, SETTINGS_KEY, settings);
  },

  async loadGoogleAuth(): Promise<GoogleAuth | null> {
    return getKeyed<GoogleAuth>(STORES.meta, GOOGLE_AUTH_KEY);
  },
  async saveGoogleAuth(auth: GoogleAuth): Promise<void> {
    return putKeyed(STORES.meta, GOOGLE_AUTH_KEY, auth);
  },
  async clearGoogleAuth(): Promise<void> {
    return del(STORES.meta, GOOGLE_AUTH_KEY);
  },

  async saveImage(id: string, blob: Blob): Promise<void> {
    return putKeyed(STORES.images, id, blob);
  },
  async loadImage(id: string): Promise<Blob | null> {
    return getKeyed<Blob>(STORES.images, id);
  },
  async deleteImage(id: string): Promise<void> {
    return del(STORES.images, id);
  },
};

export type Repository = typeof repository;
