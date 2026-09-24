import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type AppState, type Classification } from './api';
import { outbox, type OutboxItem } from './outbox';
import { prepareFile } from './image';
import { mkId } from '../core/id';
import { taxPicture, type TaxPicture } from '../core/ledger';
import type { Receipt, Rule, Settings, Stream, Transaction } from '../core/types';

// App state: the server's snapshot, held in React state and patched with each response.
// The server is the book of record, so every change waits for its answer and shows its
// error — no optimistic "saved" that later turns out not to be.

export type Phase = 'loading' | 'signin' | 'setup' | 'ready' | 'offline';

export interface App {
  phase: Phase;
  setupMessage: string;
  data: AppState | null;
  picture: TaxPicture | null;
  busy: boolean;
  error: string;
  notice: string;
  pending: number;
  clearMessages: () => void;
  signIn: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
  sync: () => Promise<void>;
  classify: (id: string, patch: Classification) => Promise<Transaction | null>;
  classifyMany: (ids: string[], patch: Classification) => Promise<void>;
  addTransaction: (t: Parameters<typeof api.addTransaction>[0]) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  saveStream: (s: Partial<Stream> & { name: string }) => Promise<Stream | null>;
  addRule: (r: Omit<Rule, 'id' | 'createdAt'>) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  uploadReceipts: (files: File[], transactionId?: string | null) => Promise<void>;
  updateReceipt: (id: string, patch: Partial<Receipt>) => Promise<void>;
  receiptToExpense: (id: string, body: Parameters<typeof api.receiptToExpense>[1]) => Promise<void>;
  deleteReceipt: (id: string) => Promise<void>;
  notify: (msg: string) => void;
}

export function useApp(): App {
  const [phase, setPhase] = useState<Phase>('loading');
  const [setupMessage, setSetupMessage] = useState('');
  const [data, setData] = useState<AppState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(0);
  const flushing = useRef(false);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      setPhase('signin');
      return;
    }
    setError(e instanceof Error ? e.message : 'Something went wrong.');
  }, []);

  const reload = useCallback(async () => {
    try {
      const s = await api.state();
      setData(s);
      setPhase('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setPhase('signin');
      else if (e instanceof ApiError && e.setup) {
        setSetupMessage(e.message);
        setPhase('setup');
      } else if (e instanceof ApiError && e.status === 0) setPhase('offline');
      else {
        setError(e instanceof Error ? e.message : 'Could not load.');
        setPhase('offline');
      }
    }
  }, []);

  // Upload anything snapped while offline.
  const flushOutbox = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const items = await outbox.list().catch(() => [] as OutboxItem[]);
      setPending(items.length);
      let uploaded = 0;
      for (const item of items) {
        try {
          await api.uploadReceipt(item);
          await outbox.remove(item.id);
          uploaded++;
        } catch (e) {
          if (e instanceof ApiError && e.status === 0) break; // still offline; try later
          await outbox.remove(item.id); // the server rejected it outright; don't retry forever
          setError(`A saved receipt couldn’t be uploaded: ${(e as Error).message}`);
        }
      }
      setPending((await outbox.list().catch(() => [])).length);
      if (uploaded) {
        setNotice(`${uploaded} saved receipt${uploaded === 1 ? '' : 's'} uploaded.`);
        await reload();
      }
    } finally {
      flushing.current = false;
    }
  }, [reload]);

  useEffect(() => {
    void reload().then(flushOutbox);
    const online = () => void flushOutbox();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [reload, flushOutbox]);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setError('');
      try {
        return await fn();
      } catch (e) {
        fail(e);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fail],
  );

  const patchTxn = (t: Transaction) =>
    setData((d) => (d ? { ...d, transactions: d.transactions.map((x) => (x.id === t.id ? t : x)) } : d));

  const picture = useMemo(
    () => (data ? taxPicture(data.transactions, data.streams, data.settings, data.today) : null),
    [data],
  );

  return {
    phase,
    setupMessage,
    data,
    picture,
    busy,
    error,
    notice,
    pending,
    clearMessages: () => {
      setError('');
      setNotice('');
    },
    notify: setNotice,
    signIn: async (password) => {
      await run(async () => {
        await api.login(password);
        await reload();
        void flushOutbox();
      });
    },
    signOut: async () => {
      await run(api.logout);
      setData(null);
      setPhase('signin');
    },
    reload,
    sync: async () => {
      const r = await run(api.sync);
      if (!r) return;
      await reload();
      const bits = [
        r.starling.configured ? `${r.starling.newRows} new from the bank` : 'Bank not connected',
        r.cstl.configured ? `${r.cstl.matchedBank + r.cstl.cashRows} CSTL sessions matched` : '',
        r.receiptsMatched ? `${r.receiptsMatched} receipts matched` : '',
      ].filter(Boolean);
      setNotice(bits.join(' · '));
      if (r.errors.length) setError(r.errors.join(' — '));
    },
    classify: async (id, patch) => {
      const t = await run(() => api.classify(id, patch));
      if (t) patchTxn(t);
      return t;
    },
    classifyMany: async (ids, patch) => {
      const ts = await run(() => api.classifyMany(ids, patch));
      if (ts) setData((d) => (d ? { ...d, transactions: d.transactions.map((x) => ts.find((t) => t.id === x.id) ?? x) } : d));
    },
    addTransaction: async (t) => {
      const created = await run(() => api.addTransaction(t));
      if (created) setData((d) => (d ? { ...d, transactions: [created, ...d.transactions] } : d));
    },
    deleteTransaction: async (id) => {
      const ok = await run(() => api.deleteTransaction(id));
      if (ok) setData((d) => (d ? { ...d, transactions: d.transactions.filter((x) => x.id !== id) } : d));
    },
    saveStream: async (s) => {
      const saved = await run(() => api.saveStream(s));
      if (saved) setData((d) => (d ? { ...d, streams: [...d.streams.filter((x) => x.id !== saved.id), saved] } : d));
      return saved;
    },
    addRule: async (r) => {
      const res = await run(() => api.addRule(r));
      if (!res) return;
      setNotice(res.applied ? `Rule saved — applied to ${res.applied} waiting row${res.applied === 1 ? '' : 's'}.` : 'Rule saved.');
      await reload();
    },
    deleteRule: async (id) => {
      const ok = await run(() => api.deleteRule(id));
      if (ok) setData((d) => (d ? { ...d, rules: d.rules.filter((r) => r.id !== id) } : d));
    },
    saveSettings: async (s) => {
      const saved = await run(() => api.saveSettings(s));
      if (saved) setData((d) => (d ? { ...d, settings: saved } : d));
    },
    uploadReceipts: async (files, transactionId = null) => {
      setBusy(true);
      setError('');
      let matched = 0;
      let saved = 0;
      let queued = 0;
      try {
        for (const file of files) {
          let prepared;
          try {
            prepared = await prepareFile(file);
          } catch (e) {
            setError((e as Error).message);
            continue;
          }
          try {
            const res = await api.uploadReceipt({ ...prepared, transactionId });
            saved++;
            if (res.matchedTransactionId) matched++;
            if (res.readError) setError(`Saved, but it couldn’t be read automatically: ${res.readError}`);
          } catch (e) {
            if (e instanceof ApiError && e.status === 0) {
              await outbox.add({ ...prepared, id: mkId(), addedAt: new Date().toISOString(), transactionId });
              queued++;
            } else fail(e);
          }
        }
      } finally {
        setBusy(false);
      }
      if (queued) {
        setPending((p) => p + queued);
        setNotice(`No signal — ${queued} receipt${queued === 1 ? '' : 's'} saved on this phone and will upload automatically.`);
      } else if (saved) {
        setNotice(`${saved} receipt${saved === 1 ? '' : 's'} saved${matched ? `, ${matched} matched to the bank` : ''}.`);
      }
      if (saved) await reload();
    },
    updateReceipt: async (id, patch) => {
      const r = await run(() => api.updateReceipt(id, patch));
      if (r) await reload();
    },
    receiptToExpense: async (id, body) => {
      const t = await run(() => api.receiptToExpense(id, body));
      if (t) await reload();
    },
    deleteReceipt: async (id) => {
      const ok = await run(() => api.deleteReceipt(id));
      if (ok) setData((d) => (d ? { ...d, receipts: d.receipts.filter((r) => r.id !== id) } : d));
    },
  };
}
