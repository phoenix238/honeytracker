import type { ExpenseCategory } from './types.js';

// HMRC's self-employment expense categories. Keyed by the field names the Making Tax Digital
// self-employment API uses, so a quarterly update is a straight mapping, and labelled with the
// matching box on the full self-employment pages (SA103F) so the year-end return is too.
//
// Box numbers are from the SA103F layout (boxes 17–30). Check them against the current year's
// form before filing — HMRC occasionally renumbers.

export interface CategoryInfo {
  key: ExpenseCategory;
  label: string;
  box: number;
  /** Everyday examples, to make picking the right one quick. General guidance, not advice. */
  hint: string;
  /** HMRC never allows these against tax (they're reported, then added back). */
  disallowable?: boolean;
}

export const CATEGORIES: readonly CategoryInfo[] = [
  { key: 'premisesRunningCosts', label: 'Rent, rates, power & insurance', box: 21, hint: 'Room hire, clinic rent, professional insurance, use-of-home costs' },
  { key: 'carVanTravelExpenses', label: 'Car, van & travel', box: 20, hint: 'Train/bus/taxi to work sites, mileage, parking, meals while travelling' },
  { key: 'adminCosts', label: 'Phone, stationery & office', box: 23, hint: 'Phone, broadband, software, subscriptions, postage, printing' },
  { key: 'advertisingCosts', label: 'Advertising & marketing', box: 24, hint: 'Website, directory listings, ads, business cards' },
  { key: 'professionalFees', label: 'Accountancy, legal & professional', box: 28, hint: 'Accountant, solicitor, professional body membership' },
  { key: 'otherExpenses', label: 'Other business expenses', box: 30, hint: 'Training/CPD, supervision, equipment (cash basis), anything else wholly for the business' },
  { key: 'costOfGoods', label: 'Goods bought for resale / used', box: 17, hint: 'Stock, materials used up in the work' },
  { key: 'maintenanceCosts', label: 'Repairs & maintenance', box: 22, hint: 'Fixing equipment or business premises' },
  { key: 'financeCharges', label: 'Bank & card charges', box: 26, hint: 'Account fees, card-reader fees, PayPal/Stripe fees' },
  { key: 'interestOnBankOtherLoans', label: 'Interest on business loans', box: 25, hint: 'Interest only, not the repayment' },
  { key: 'wagesAndStaffCosts', label: 'Staff costs', box: 19, hint: 'Wages, pensions for employees' },
  { key: 'paymentsToSubcontractors', label: 'Construction subcontractors', box: 18, hint: 'CIS only' },
  { key: 'irrecoverableDebts', label: 'Bad debts written off', box: 27, hint: 'Rarely applies on the cash basis' },
  { key: 'businessEntertainmentCosts', label: 'Business entertainment', box: 24, hint: 'Taking clients out — recorded but never tax-deductible', disallowable: true },
  { key: 'depreciation', label: 'Depreciation', box: 29, hint: 'Not deductible — equipment is claimed in full on the cash basis instead', disallowable: true },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

export function categoryInfo(key: ExpenseCategory): CategoryInfo {
  const info = BY_KEY.get(key);
  if (!info) throw new Error(`Unknown expense category: ${key}`);
  return info;
}

export function isCategory(value: unknown): value is ExpenseCategory {
  return typeof value === 'string' && BY_KEY.has(value as ExpenseCategory);
}

export function isDisallowable(key: ExpenseCategory): boolean {
  return Boolean(BY_KEY.get(key)?.disallowable);
}

/** The old Honey app's free-form categories, mapped onto HMRC's. */
export const LEGACY_CATEGORY_MAP: Record<string, ExpenseCategory> = {
  meals: 'carVanTravelExpenses',
  travel: 'carVanTravelExpenses',
  accommodation: 'carVanTravelExpenses',
  mileage: 'carVanTravelExpenses',
  equipment: 'otherExpenses',
  software: 'adminCosts',
  office: 'adminCosts',
  phone: 'adminCosts',
  training: 'otherExpenses',
  marketing: 'advertisingCosts',
  advertising: 'advertisingCosts',
  professional: 'professionalFees',
  insurance: 'premisesRunningCosts',
  rent: 'premisesRunningCosts',
  other: 'otherExpenses',
};

export function legacyCategory(raw: string | undefined | null): ExpenseCategory {
  if (!raw) return 'otherExpenses';
  if (isCategory(raw)) return raw;
  return LEGACY_CATEGORY_MAP[raw.toLowerCase().trim()] ?? 'otherExpenses';
}
