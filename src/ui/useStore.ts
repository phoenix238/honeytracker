import { useCallback, useEffect, useState } from 'react';
import type { Income, Expense, Invoice, Client, Settings } from '../core/types';
import { repository } from '../storage/repository';
import { isExpired, type GoogleAuth } from '../integrations/google';

// Local-first store. IndexedDB is loaded once on mount into React state, which is the fast
// authoritative copy for the session; every mutation updates state AND persists, awaiting the
// write so a failure surfaces instead of being swallowed (the old app's silent-save bug).

export interface Store {
  loading: boolean;
  income: Income[];
  expenses: Expense[];
  invoices: Invoice[];
  settings: Settings;
  /** Non-empty when the last write failed; render it, don't hide it. */
  error: string;
  clearError: () => void;
  addIncome: (income: Income) => Promise<void>;
  removeIncome: (id: string) => Promise<void>;
  addExpense: (expense: Expense) => Promise<void>;
  removeExpense: (expense: Expense) => Promise<void>;
  addInvoice: (invoice: Invoice) => Promise<void>;
  updateInvoice: (invoice: Invoice) => Promise<void>;
  clients: Client[];
  addClient: (client: Client) => Promise<void>;
  removeClient: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  googleAuth: GoogleAuth | null;
  setGoogleAuth: (auth: GoogleAuth) => Promise<void>;
  disconnectGoogle: () => Promise<void>;
  /** Returns a valid access token, refreshing first if the stored one is near expiry. Throws if not connected or the refresh fails. */
  freshGoogleAccessToken: () => Promise<string>;
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
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [googleAuth, setGoogleAuthState] = useState<GoogleAuth | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [i, e, inv, c, s, g] = await Promise.all([
          repository.loadIncome(),
          repository.loadExpenses(),
          repository.loadInvoices(),
          repository.loadClients(),
          repository.loadSettings(),
          repository.loadGoogleAuth(),
        ]);
        if (!live) return;
        setIncome(i);
        setExpenses(e);
        setInvoices(inv);
        setClients(c);
        setSettings(s);
        setGoogleAuthState(g);
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

  const addInvoice = useCallback(async (record: Invoice) => {
    setInvoices((prev) => [record, ...prev]);
    try {
      await repository.saveInvoice(record);
    } catch (e) {
      setInvoices((prev) => prev.filter((r) => r.id !== record.id));
      setError(message(e));
    }
  }, []);

  const updateInvoice = useCallback(
    async (record: Invoice) => {
      const previous = invoices;
      setInvoices((prev) => prev.map((r) => (r.id === record.id ? record : r)));
      try {
        await repository.saveInvoice(record);
      } catch (e) {
        setInvoices(previous);
        setError(message(e));
      }
    },
    [invoices],
  );

  const addClient = useCallback(async (record: Client) => {
    setClients((prev) => [record, ...prev]);
    try {
      await repository.saveClient(record);
    } catch (e) {
      setClients((prev) => prev.filter((r) => r.id !== record.id));
      setError(message(e));
    }
  }, []);

  const removeClient = useCallback(
    async (id: string) => {
      const previous = clients;
      setClients((prev) => prev.filter((r) => r.id !== id));
      try {
        await repository.deleteClient(id);
      } catch (e) {
        setClients(previous);
        setError(message(e));
      }
    },
    [clients],
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

  const setGoogleAuth = useCallback(async (auth: GoogleAuth) => {
    setGoogleAuthState(auth);
    try {
      await repository.saveGoogleAuth(auth);
    } catch (e) {
      setError(message(e));
    }
  }, []);

  const disconnectGoogle = useCallback(async () => {
    setGoogleAuthState(null);
    try {
      await repository.clearGoogleAuth();
    } catch (e) {
      setError(message(e));
    }
  }, []);

  const freshGoogleAccessToken = useCallback(async () => {
    if (!googleAuth) throw new Error('Gmail is not connected.');
    if (!isExpired(googleAuth)) return googleAuth.accessToken;
    const res = await fetch('/api/auth/google/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: googleAuth.refreshToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not refresh the Gmail connection.');
    const next: GoogleAuth = {
      ...googleAuth,
      accessToken: data.accessToken,
      expiresAt: Date.now() + data.expiresIn * 1000,
    };
    await setGoogleAuth(next);
    return next.accessToken;
  }, [googleAuth, setGoogleAuth]);

  return {
    loading: loading || settings === null,
    income,
    expenses,
    invoices,
    settings: settings ?? ({} as Settings),
    error,
    clearError: () => setError(''),
    addIncome,
    removeIncome,
    addExpense,
    removeExpense,
    addInvoice,
    updateInvoice,
    clients,
    addClient,
    removeClient,
    updateSettings,
    googleAuth,
    setGoogleAuth,
    disconnectGoogle,
    freshGoogleAccessToken,
  };
}
