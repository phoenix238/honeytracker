import { useCallback, useEffect, useState } from 'react';
import type { Income, Expense, Settings } from '../core/types';
import { repository } from '../storage/repository';

// Local-first store. IndexedDB is loaded once on mount into React state, which is the fast
// authoritative copy for the session; every mutation updates state AND persists, awaiting the
// write so a failure surfaces instead of being swallowed (the old app's silent-save bug).

export interface Store {
  loading: boolean;
  income: Income[];
  expenses: Expense[];
  settings: Settings;
  /** Non-empty when the last write failed; render it, don't hide it. */
  error: string;
  clearError: () => void;
  addIncome: (income: Income) => Promise<void>;
  removeIncome: (id: string) => Promise<void>;
  addExpense: (expense: Expense) => Promise<void>;
  removeExpense: (expense: Expense) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}

function message(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'QuotaExceededError') return "This device's storage is full — your last change was not saved.";
  return 'Your last change could not be saved to this device.';
}

export function useStore(): Store {
  const [loading, setLoading] = useState(true);
  const [income, setIncome] = useState<Income[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [i, e, s] = await Promise.all([
          repository.loadIncome(),
          repository.loadExpenses(),
          repository.loadSettings(),
        ]);
        if (!live) return;
        setIncome(i);
        setExpenses(e);
        setSettings(s);
      } catch {
        if (live) setError('Could not open local storage on this device.');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const addIncome = useCallback(async (record: Income) => {
    setIncome((prev) => [record, ...prev]);
    try {
      await repository.saveIncome(record);
    } catch (e) {
      setIncome((prev) => prev.filter((r) => r.id !== record.id)); // roll back the optimistic add
      setError(message(e));
    }
  }, []);

  const removeIncome = useCallback(
    async (id: string) => {
      const previous = income;
      setIncome((prev) => prev.filter((r) => r.id !== id));
      try {
        await repository.deleteIncome(id);
      } catch (e) {
        setIncome(previous);
        setError(message(e));
      }
    },
    [income],
  );

  const addExpense = useCallback(async (record: Expense) => {
    setExpenses((prev) => [record, ...prev]);
    try {
      await repository.saveExpense(record);
    } catch (e) {
      setExpenses((prev) => prev.filter((r) => r.id !== record.id));
      setError(message(e));
    }
  }, []);

  const removeExpense = useCallback(
    async (record: Expense) => {
      const previous = expenses;
      setExpenses((prev) => prev.filter((r) => r.id !== record.id));
      try {
        await repository.deleteExpense(record);
      } catch (e) {
        setExpenses(previous);
        setError(message(e));
      }
    },
    [expenses],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const previous = settings;
      const next = { ...(settings as Settings), ...patch };
      setSettings(next);
      try {
        await repository.saveSettings(next);
      } catch (e) {
        setSettings(previous);
        setError(message(e));
      }
    },
    [settings],
  );

  return {
    loading: loading || settings === null,
    income,
    expenses,
    settings: settings ?? ({} as Settings),
    error,
    clearError: () => setError(''),
    addIncome,
    removeIncome,
    addExpense,
    removeExpense,
    updateSettings,
  };
}
