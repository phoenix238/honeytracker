// The domain model. The guiding rule: store FACTS, never derived numbers. A ledger row holds
// what the bank (or you) said happened and how you classified it — never a frozen `tax` or
// `net`, because those depend on rates and settings that change. Every figure is derived on
// read by src/core/ledger.ts and src/core/ukTax.ts.
//
// The backbone is the bank feed: every movement of money is one Transaction, and the whole
// job of the app is to say what each one IS. Cash is the only thing typed in by hand.

/** Money is always integer pence. Never a float — see src/core/money.ts for why. */
export type Pence = number;

/** ISO date, calendar day only: "YYYY-MM-DD" (UK local date). */
export type IsoDate = string;

export type Direction = 'in' | 'out';

/**
 * What a transaction IS, for tax. Exactly one per row. `unreviewed` rows sit in the inbox;
 * a tax year is "done" when none are left and every business expense has its evidence.
 */
export type Bucket = 'unreviewed' | 'business_income' | 'business_expense' | 'personal' | 'transfer';

/** Where a row came from. `sourceId` is that source's own unique id — the idempotency key. */
export type Source = 'starling' | 'cash' | 'manual' | 'cstl' | 'import';

/** Who set the classification — so auto-classified rows can be spot-checked. */
export type ClassifiedBy = 'user' | 'rule' | 'cstl' | 'import' | 'invoice' | 'ai';

export interface Transaction {
  id: string;
  date: IsoDate;
  /** Always positive; `direction` says which way it moved. */
  amountPence: Pence;
  direction: Direction;
  source: Source;
  /** Unique per source (Starling feedItemUid, CSTL booking id, …). Null for hand-typed rows. */
  sourceId: string | null;
  counterparty: string;
  reference: string;
  bucket: Bucket;
  /** Which income stream / business this belongs to. Required once bucket is business_*. */
  streamId: string | null;
  /** HMRC expense category (MTD field name) — only for business_expense. */
  category: ExpenseCategory | null;
  /** For mixed-use costs (phone, broadband): the business share, 0–100. Default 100. */
  businessPercent: number;
  note: string;
  classifiedBy: ClassifiedBy | null;
  /** Free-form facts from the source, e.g. the CSTL booking a payment settled. */
  meta: Record<string, string>;
  /** Receipts attached as evidence. */
  receiptIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type StreamKind = 'self_employment' | 'other';

/**
 * An income stream — "CSTL practice", "Freelance design", … Each self-employment is
 * reported on its own self-employment pages, so every business row belongs to one.
 */
export interface Stream {
  id: string;
  name: string;
  kind: StreamKind;
  color: string;
  archived: boolean;
}

/** HMRC's expense categories, keyed by the field names Making Tax Digital uses. */
export type ExpenseCategory =
  | 'costOfGoods'
  | 'paymentsToSubcontractors'
  | 'wagesAndStaffCosts'
  | 'carVanTravelExpenses'
  | 'premisesRunningCosts'
  | 'maintenanceCosts'
  | 'adminCosts'
  | 'businessEntertainmentCosts'
  | 'advertisingCosts'
  | 'interestOnBankOtherLoans'
  | 'financeCharges'
  | 'irrecoverableDebts'
  | 'professionalFees'
  | 'depreciation'
  | 'otherExpenses';

/** A receipt or invoice — the evidence behind an expense. */
export interface Receipt {
  id: string;
  uploadedAt: string;
  filename: string;
  mime: string;
  /** What the reader pulled off it. Every field optional: a blurry photo still gets stored. */
  merchant: string;
  date: IsoDate | null;
  totalPence: Pence | null;
  vatPence: Pence | null;
  suggestedCategory: ExpenseCategory | null;
  description: string;
  /** The ledger row it evidences, once matched. */
  transactionId: string | null;
}

/**
 * "Whenever the counterparty/reference contains X, it's Y." Created from the inbox with
 * one tap ("always do this"), applied to every new row from the bank.
 */
export interface Rule {
  id: string;
  field: 'counterparty' | 'reference';
  /** Case-insensitive substring. */
  pattern: string;
  /** Only match money moving this way; null matches both. */
  direction: Direction | null;
  bucket: Exclude<Bucket, 'unreviewed'>;
  streamId: string | null;
  category: ExpenseCategory | null;
  businessPercent: number;
  createdAt: string;
}

/** Facts about a tax year that don't come from the bank — mostly from HMRC or a P60. */
export interface TaxYearFacts {
  /** Gross pay from any PAYE job this year (P60 / payslips). Uses up your bands first. */
  employmentIncomePence: Pence;
  /** Income tax already deducted through PAYE this year. */
  payeTaxPence: Pence;
  /**
   * Last year's Self Assessment bill (income tax + Class 4, after PAYE) — this is what
   * HMRC bases this year's payments on account on. From last year's calculation (SA302).
   */
  priorYearLiabilityPence: Pence | null;
  /** Everything already paid to HMRC towards THIS year's bill (payments on account etc). */
  paidToHmrcPence: Pence;
  /** Your own guess of this year's total profit, used before there's enough data to project. */
  expectedProfitPence: Pence | null;
}

export interface InvoiceLine {
  description: string;
  /** Hours, days or units. Decimals allowed (2.5 hours). */
  quantity: number;
  /** Price per unit, in pence. */
  unitPence: Pence;
}

/**
 * A bill you've sent. It's a document, not money: nothing counts towards tax until the payment
 * actually arrives (the cash basis). "Paid" isn't stored as a flag — an invoice is paid when a
 * ledger row is linked to it, so the ledger stays the one record of money.
 */
export interface Invoice {
  id: string;
  /** e.g. "INV-0042" — also the payment reference the client is asked to use. */
  number: string;
  streamId: string | null;
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  issueDate: IsoDate;
  dueDate: IsoDate;
  lines: InvoiceLine[];
  notes: string;
  status: 'draft' | 'sent' | 'void';
  /** The ledger row (bank or cash) that paid it. */
  paidTransactionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Who the invoices are from, and where to pay. */
export interface BusinessProfile {
  name: string;
  businessName: string;
  address: string;
  email: string;
  phone: string;
  sortCode: string;
  accountNumber: string;
  invoicePrefix: string;
  paymentTermsDays: number;
  footer: string;
}

export const DEFAULT_PROFILE: BusinessProfile = {
  name: '',
  businessName: '',
  address: '',
  email: '',
  phone: '',
  sortCode: '',
  accountNumber: '',
  invoicePrefix: 'INV-',
  paymentTermsDays: 14,
  footer: 'Thank you!',
};

export interface Settings {
  name: string;
  profile: BusinessProfile;
  /** Keyed by the calendar year the tax year starts in, e.g. "2026" for 2026/27. */
  taxYears: Record<string, TaxYearFacts>;
  /** Business expenses above this with no receipt are flagged. */
  receiptThresholdPence: Pence;
  /** The stream CSTL session income is filed under. */
  cstlStreamId: string | null;
}

export const DEFAULT_TAX_YEAR_FACTS: TaxYearFacts = {
  employmentIncomePence: 0,
  payeTaxPence: 0,
  priorYearLiabilityPence: null,
  paidToHmrcPence: 0,
  expectedProfitPence: null,
};

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  profile: DEFAULT_PROFILE,
  taxYears: {},
  receiptThresholdPence: 0,
  cstlStreamId: null,
};

export function factsFor(settings: Settings, taxYear: number): TaxYearFacts {
  return { ...DEFAULT_TAX_YEAR_FACTS, ...(settings.taxYears[String(taxYear)] ?? {}) };
}
