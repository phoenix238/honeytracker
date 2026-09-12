import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { indexedDB } from 'fake-indexeddb';
import { repository } from '../repository';
import { _resetForTests } from '../db';
import { DEFAULT_SETTINGS, type Income, type Expense } from '../../core/types';

// Each test gets a clean database: drop the cached connection and delete the store.
beforeEach(async () => {
  _resetForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('honeytracker');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

const income = (id: string, grossPence: number): Income => ({
  id,
  date: '2026-05-01',
  grossPence,
  method: 'bank',
  client: 'Sarah',
  createdAt: '2026-05-01T00:00:00Z',
});
const expense = (id: string, amountPence: number, imageId?: string): Expense => ({
  id,
  date: '2026-05-02',
  amountPence,
  category: 'travel',
  deductible: true,
  imageId,
  createdAt: '2026-05-02T00:00:00Z',
});

describe('repository — income & expenses', () => {
  it('round-trips income records', async () => {
    await repository.saveIncome(income('i1', 12000));
    await repository.saveIncome(income('i2', 5000));
    const loaded = await repository.loadIncome();
    expect(loaded).toHaveLength(2);
    expect(loaded.find((r) => r.id === 'i1')?.grossPence).toBe(12000);
  });

  it('deletes an income record', async () => {
    await repository.saveIncome(income('i1', 12000));
    await repository.deleteIncome('i1');
    expect(await repository.loadIncome()).toEqual([]);
  });

  it('starts empty', async () => {
    expect(await repository.loadIncome()).toEqual([]);
    expect(await repository.loadExpenses()).toEqual([]);
  });
});

describe('repository — settings', () => {
  it('returns defaults before anything is saved', async () => {
    expect(await repository.loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists and merges settings over defaults', async () => {
    await repository.saveSettings({ ...DEFAULT_SETTINGS, taxPercent: 30, name: 'Alex' });
    const s = await repository.loadSettings();
    expect(s.taxPercent).toBe(30);
    expect(s.name).toBe('Alex');
    expect(s.defaultRatePence).toBe(DEFAULT_SETTINGS.defaultRatePence);
  });
});

describe('repository — images as Blobs', () => {
  it('round-trips a Blob (not base64 in localStorage)', async () => {
    const blob = new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' });
    await repository.saveImage('img1', blob);
    const got = await repository.loadImage('img1');
    expect(got).toBeInstanceOf(Blob);
    expect(got?.type).toBe('image/jpeg');
    expect(await got!.text()).toBe('fake-jpeg-bytes');
  });

  it('returns null for a missing image', async () => {
    expect(await repository.loadImage('nope')).toBeNull();
  });

  it('deleting an expense with a photo removes the photo too (no orphans)', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await repository.saveImage('img1', blob);
    await repository.saveExpense(expense('e1', 4800, 'img1'));

    await repository.deleteExpense(expense('e1', 4800, 'img1'));

    expect(await repository.loadExpenses()).toEqual([]);
    expect(await repository.loadImage('img1')).toBeNull();
  });

  it('deleting an expense without a photo leaves other images alone', async () => {
    const blob = new Blob(['keep'], { type: 'image/jpeg' });
    await repository.saveImage('keep-me', blob);
    await repository.saveExpense(expense('e1', 4800));
    await repository.deleteExpense(expense('e1', 4800));
    expect(await repository.loadImage('keep-me')).not.toBeNull();
  });
});
