import { describe, it, expect } from 'vitest';
import { parseHoneypotBackup, findBankTwin } from '../importers.js';
import { txn } from './fixtures.js';

describe('Honeypot backup import', () => {
  const backup = {
    app: 'money-tracker-backup',
    keys: {
      'mhq-entries': [
        { id: 'e1', type: 'lump', date: '2026-05-01', client: 'Sarah', description: 'Session', subtotal: 80, status: 'Paid' },
        { id: 'e2', type: 'lump', date: '2026-05-02', client: 'Jo', subtotal: 60, status: 'Pending' },
        { id: 'e3', type: 'timed', date: '2026-05-03', subtotal: '49.50', status: 'Paid', void: true },
      ],
      'mhq-receipts': [
        { id: 'r1', description: 'Ryman', amount: '12.99', date: '2026-05-04', category: 'business', subcategory: 'office', imageData: 'data:image/jpeg;base64,AAA' },
        { id: 'r2', description: 'Lunch', amount: '8', date: '2026-05-04', category: 'reimbursable' },
      ],
    },
  };

  it('keeps only money actually received, and business receipts', () => {
    const items = parseHoneypotBackup(backup);
    expect(items.map((i) => i.sourceId)).toEqual(['honeypot:entry:e1', 'honeypot:receipt:r1']);
    expect(items[0]!.amountPence).toBe(8_000);
    expect(items[1]!.category).toBe('adminCosts');
    expect(items[1]!.imageDataUrl).toMatch(/^data:image/);
  });

  it('reads the older flat backup shape too', () => {
    const items = parseHoneypotBackup({ entries: backup.keys['mhq-entries'] });
    expect(items).toHaveLength(1);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseHoneypotBackup({ foo: 1 })).toThrow();
  });

  it('finds the bank row an imported payment describes instead of duplicating it', () => {
    const [item] = parseHoneypotBackup(backup);
    const bank = txn({ source: 'starling', direction: 'in', amountPence: 8_000, date: '2026-05-03' });
    const other = txn({ source: 'starling', direction: 'in', amountPence: 8_000, date: '2026-06-30' });
    expect(findBankTwin(item!, [other, bank], new Set())?.id).toBe(bank.id);
    expect(findBankTwin(item!, [bank], new Set([bank.id]))).toBeNull();
  });
});
