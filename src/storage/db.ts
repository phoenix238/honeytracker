// Thin promise wrapper over IndexedDB. The device is the authoritative copy for the current
// session; this is where it lives. Two deliberate lessons from the old app are baked in:
//
//   1. Receipt photos are stored as Blobs in their own object store — never base64 in
//      localStorage, which capped out around 5MB and then failed silently. IndexedDB has no
//      practical size cap and stores Blobs natively.
//   2. Every write returns a promise that rejects on failure, so the caller can surface it.
//      Nothing here swallows an error.

const DB_NAME = 'honeytracker';
const DB_VERSION = 1;

export const STORES = {
  income: 'income',
  expenses: 'expenses',
  meta: 'meta', // single-document store, e.g. settings under key "settings"
  images: 'images', // receipt photos as Blobs, keyed by image id
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;
let openConnection: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e as Error);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.income)) db.createObjectStore(STORES.income, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.expenses)) db.createObjectStore(STORES.expenses, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta);
      if (!db.objectStoreNames.contains(STORES.images)) db.createObjectStore(STORES.images);
    };
    req.onsuccess = () => {
      openConnection = req.result;
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked by another open connection'));
  }).catch((e) => {
    dbPromise = null; // allow a later retry rather than caching the failure forever
    throw e;
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const req = run(transaction.objectStore(store));
        transaction.oncomplete = () => resolve((req ? req.result : undefined) as T);
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      }),
  );
}

/** Read every record in a keyPath store. */
export function getAll<T>(store: StoreName): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

/** Write one record (its own keyPath supplies the key). */
export function put<T>(store: StoreName, value: T): Promise<void> {
  return tx<void>(store, 'readwrite', (s) => void s.put(value));
}

/** Delete one record by key. */
export function del(store: StoreName, key: IDBValidKey): Promise<void> {
  return tx<void>(store, 'readwrite', (s) => void s.delete(key));
}

/** Read one value from a keyless store (meta, images). */
export function getKeyed<T>(store: StoreName, key: IDBValidKey): Promise<T | null> {
  return tx<T | null>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | null>).then((v) => v ?? null);
}

/** Write one value into a keyless store under an explicit key. */
export function putKeyed<T>(store: StoreName, key: IDBValidKey, value: T): Promise<void> {
  return tx<void>(store, 'readwrite', (s) => void s.put(value, key));
}

/** Test-only: close and drop the cached connection so a fresh open happens next call. */
export function _resetForTests(): void {
  openConnection?.close();
  openConnection = null;
  dbPromise = null;
}
