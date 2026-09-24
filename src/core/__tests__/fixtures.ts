import type { Transaction } from '../types.js';

let n = 0;
/** A ledger row with sensible defaults; override what the test cares about. */
export function txn(over: Partial<Transaction> = {}): Transaction {
  n++;
  return {
    id: `t${n}`,
    date: '2026-05-01',
    amountPence: 10_000,
    direction: 'in',
    source: 'starling',
    sourceId: `feed-${n}`,
    counterparty: '',
    reference: '',
    bucket: 'unreviewed',
    streamId: null,
    category: null,
    businessPercent: 100,
    note: '',
    classifiedBy: null,
    meta: {},
    receiptIds: [],
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...over,
  };
}
