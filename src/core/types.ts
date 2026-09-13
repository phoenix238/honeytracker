// The domain model. The guiding rule of this rebuild: we store FACTS, never derived
// numbers. An income record holds the gross amount and who paid it — never a frozen `tax`
// or `net`, because those depend on settings that can change, and freezing them is what made
// the old app's tax figures wrong retroactively. Every derived number is computed on read
// by src/core/tax.ts from the current settings.

/** Money is always integer pence. Never a float — see src/core/money.ts for why. */
export type Pence = number;

/** ISO date, calendar day only: "YYYY-MM-DD". */
export type IsoDate = string;

/** How money physically arrived. Cash never touches the bank feed. */
export type IncomeMethod = 'bank' | 'cash' | 'other';

/**
 * Money received. The single source of truth for income totals — it counts on its own,
 * with or without an invoice or receipt document attached.
 */
export interface Income {
  id: string;
  date: IsoDate;
  /** Gross amount received, in pence. */
  grossPence: Pence;
  method: IncomeMethod;
  client?: string;
  note?: string;
  /** Optional link to a document generated for this income (invoice/receipt), by id. */
  documentId?: string;
  createdAt: string;
}

/** Money spent, with an optional photo (stored separately in IndexedDB, referenced by id). */
export interface Expense {
  id: string;
  date: IsoDate;
  amountPence: Pence;
  category: string;
  /** true = a business cost that reduces taxable profit; false = personal/reimbursable. */
  deductible: boolean;
  note?: string;
  imageId?: string;
  createdAt: string;
}

/** User settings. taxPercent is the ONLY tax knob, and it is honoured everywhere. */
export interface Settings {
  name: string;
  business: string;
  /** Whole-percent set-aside rate, e.g. 20. Derivation divides by 100. */
  taxPercent: number;
  defaultRatePence: Pence;
  /** 'light' or 'dark' — a fact the user chose, not derived. */
  theme: 'light' | 'dark';
  /**
   * How much of the current tax stash the user has actually moved to a savings account, as of
   * the last time they confirmed it. A fact, like everything else here — never recomputed
   * backwards, only ratcheted forward by "Move to savings".
   */
  taxSavedPence: Pence;
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  business: '',
  taxPercent: 20,
  defaultRatePence: 3500,
  theme: 'light',
  taxSavedPence: 0,
};

/** A saved contact — so an invoice or log-work entry can pick a client instead of retyping them. */
export interface Client {
  id: string;
  name: string;
  email?: string;
  /** Prefilled as the day/hour rate when this client is picked in Log work, if set. */
  defaultRatePence?: Pence;
  createdAt: string;
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid';

export interface InvoiceLine {
  id: string;
  label: string;
  qty: number;
  unitPence: Pence;
}

/**
 * A billing document. Optional and secondary to income by design (see README) — an invoice
 * only becomes income when it's marked paid, which creates a real Income record alongside it.
 */
export interface Invoice {
  id: string;
  /** Display number, e.g. "HP-0143". */
  number: string;
  client: string;
  clientEmail?: string;
  lines: InvoiceLine[];
  dueDate: IsoDate;
  status: InvoiceStatus;
  /** Set once status becomes 'paid', linking to the Income record it created. */
  incomeId?: string;
  createdAt: string;
}
