import { STORES, getAll, put, del } from '../storage/db';
import type { PreparedFile } from './image';

// Receipts snapped with no signal wait here, on the phone, and upload by themselves the
// next time the app is open and online. A receipt is never lost to a bad connection.

export interface OutboxItem extends PreparedFile {
  id: string;
  addedAt: string;
  transactionId: string | null;
}

export const outbox = {
  list: () => getAll<OutboxItem>(STORES.outbox),
  add: (item: OutboxItem) => put(STORES.outbox, item),
  remove: (id: string) => del(STORES.outbox, id),
};
