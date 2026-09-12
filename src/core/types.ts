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
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  business: '',
  taxPercent: 20,
  defaultRatePence: 3500,
};
