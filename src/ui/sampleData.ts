import type { Income, Expense } from '../core/types';

// Placeholder facts so the Home screen renders something real before the storage layer and
// importer land. These are the kind of records the app stores: gross amounts and who paid —
// no frozen tax or net. Delete once real data flows in.
export const sampleIncome: Income[] = [
  { id: 'i1', date: '2026-05-04', grossPence: 12000, method: 'bank', client: 'Sarah J', createdAt: '2026-05-04T09:00:00Z' },
  { id: 'i2', date: '2026-05-06', grossPence: 5000, method: 'cash', client: 'Emma', createdAt: '2026-05-06T14:00:00Z' },
  { id: 'i3', date: '2026-05-11', grossPence: 24000, method: 'bank', client: 'Acme Ltd', createdAt: '2026-05-11T11:00:00Z' },
];

export const sampleExpenses: Expense[] = [
  { id: 'e1', date: '2026-05-05', amountPence: 4800, category: 'travel', deductible: true, note: 'Fuel', createdAt: '2026-05-05T08:00:00Z' },
  { id: 'e2', date: '2026-05-09', amountPence: 1299, category: 'supplies', deductible: true, note: 'Oils', createdAt: '2026-05-09T16:00:00Z' },
];
