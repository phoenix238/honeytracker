import type { Income, Expense, Settings } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import { STORES, getAll, put, del, getKeyed, putKeyed } from './db';

// Typed CRUD over the IndexedDB stores. The rest of the app talks to this, never to db.ts
// directly, so the storage shape stays swappable (a sync backend slots in behind here later).

const SETTINGS_KEY = 'settings';

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

  async loadSettings(): Promise<Settings> {
    const stored = await getKeyed<Partial<Settings>>(STORES.meta, SETTINGS_KEY);
    // Merge over defaults so a new field added later is never undefined on an old store.
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  },
  async saveSettings(settings: Settings): Promise<void> {
    return putKeyed(STORES.meta, SETTINGS_KEY, settings);
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
