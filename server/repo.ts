import type { Db } from './db.js';
import type {
  Invoice,
  InvoiceLine,
  Bucket,
  ClassifiedBy,
  Direction,
  ExpenseCategory,
  Receipt,
  Rule,
  Settings,
  Source,
  Stream,
  Transaction,
} from '../src/core/types.js';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from '../src/core/types.js';
import { formatInvoiceNumber } from '../src/core/invoices.js';
import { mkId } from '../src/core/id.js';

// Typed data access. Everything that touches SQL lives here, so the rest of the server
// works in domain objects.

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? '' : String(v));
const n = (v: unknown): number | null => (v == null ? null : Number(v));

function toTxn(r: Row, receiptIds: string[] = []): Transaction {
  return {
    id: s(r.id),
    date: s(r.date),
    amountPence: Number(r.amount_pence),
    direction: s(r.direction) as Direction,
    source: s(r.source) as Source,
    sourceId: r.source_id == null ? null : s(r.source_id),
    counterparty: s(r.counterparty),
    reference: s(r.reference),
    bucket: s(r.bucket) as Bucket,
    streamId: r.stream_id == null ? null : s(r.stream_id),
    category: (r.category ?? null) as ExpenseCategory | null,
    businessPercent: Number(r.business_percent ?? 100),
    note: s(r.note),
    classifiedBy: (r.classified_by ?? null) as ClassifiedBy | null,
    meta: (typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta ?? {}) as Record<string, string>,
    receiptIds,
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

function toReceipt(r: Row): Receipt {
  return {
    id: s(r.id),
    uploadedAt: s(r.uploaded_at),
    filename: s(r.filename),
    mime: s(r.mime),
    merchant: s(r.merchant),
    date: r.date == null ? null : s(r.date),
    totalPence: n(r.total_pence),
    vatPence: n(r.vat_pence),
    suggestedCategory: (r.suggested_category ?? null) as ExpenseCategory | null,
    description: s(r.description),
    transactionId: r.transaction_id == null ? null : s(r.transaction_id),
  };
}

function toStream(r: Row): Stream {
  return { id: s(r.id), name: s(r.name), kind: s(r.kind) as Stream['kind'], color: s(r.color), archived: Boolean(r.archived) };
}

function toRule(r: Row): Rule {
  return {
    id: s(r.id),
    field: s(r.field) as Rule['field'],
    pattern: s(r.pattern),
    direction: (r.direction ?? null) as Direction | null,
    bucket: s(r.bucket) as Rule['bucket'],
    streamId: r.stream_id == null ? null : s(r.stream_id),
    category: (r.category ?? null) as ExpenseCategory | null,
    businessPercent: Number(r.business_percent ?? 100),
    createdAt: s(r.created_at),
  };
}

function toInvoice(r: Row): Invoice {
  const lines = (typeof r.lines === 'string' ? JSON.parse(r.lines) : r.lines ?? []) as InvoiceLine[];
  return {
    id: s(r.id),
    number: s(r.number),
    streamId: r.stream_id == null ? null : s(r.stream_id),
    clientName: s(r.client_name),
    clientEmail: s(r.client_email),
    clientAddress: s(r.client_address),
    issueDate: s(r.issue_date),
    dueDate: s(r.due_date),
    lines,
    notes: s(r.notes),
    status: s(r.status) as Invoice['status'],
    paidTransactionId: r.paid_transaction_id == null ? null : s(r.paid_transaction_id),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

export type InvoiceDraft = Omit<Invoice, 'id' | 'number' | 'paidTransactionId' | 'createdAt' | 'updatedAt'>;

const TXN_COLS = 'id, date, amount_pence, direction, source, source_id, counterparty, reference, bucket, stream_id, category, business_percent, note, classified_by, meta, created_at, updated_at';
const RECEIPT_COLS = 'id, uploaded_at, filename, mime, merchant, date, total_pence, vat_pence, suggested_category, description, transaction_id';

export type NewTransaction = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'receiptIds'>;

export function repo(db: Db) {
  const now = () => new Date().toISOString();

  async function receiptIdsByTxn(): Promise<Map<string, string[]>> {
    const rows = await db.query<Row>('SELECT id, transaction_id FROM receipts WHERE transaction_id IS NOT NULL ORDER BY uploaded_at');
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const key = s(r.transaction_id);
      map.set(key, [...(map.get(key) ?? []), s(r.id)]);
    }
    return map;
  }

  const api = {
    // ── Transactions ──────────────────────────────────────────────────────────────────
    async listTransactions(): Promise<Transaction[]> {
      const [rows, links] = await Promise.all([
        db.query<Row>(`SELECT ${TXN_COLS} FROM transactions ORDER BY date DESC, created_at DESC`),
        receiptIdsByTxn(),
      ]);
      return rows.map((r) => toTxn(r, links.get(s(r.id)) ?? []));
    },

    async getTransaction(id: string): Promise<Transaction | null> {
      const [row] = await db.query<Row>(`SELECT ${TXN_COLS} FROM transactions WHERE id = $1`, [id]);
      if (!row) return null;
      const links = await db.query<Row>('SELECT id FROM receipts WHERE transaction_id = $1 ORDER BY uploaded_at', [id]);
      return toTxn(row, links.map((l) => s(l.id)));
    },

    async findBySource(source: Source, sourceId: string): Promise<Transaction | null> {
      const [row] = await db.query<Row>(`SELECT id FROM transactions WHERE source = $1 AND source_id = $2`, [source, sourceId]);
      return row ? api.getTransaction(s(row.id)) : null;
    },

    /** Insert, unless a row from the same source+id already exists. Returns null if it did. */
    async insertTransaction(t: NewTransaction): Promise<Transaction | null> {
      const id = mkId();
      const at = now();
      const rows = await db.query<Row>(
        `INSERT INTO transactions (${TXN_COLS})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$16)
         ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL DO NOTHING
         RETURNING ${TXN_COLS}`,
        [id, t.date, t.amountPence, t.direction, t.source, t.sourceId, t.counterparty, t.reference, t.bucket, t.streamId,
          t.category, t.businessPercent, t.note, t.classifiedBy, JSON.stringify(t.meta ?? {}), at],
      );
      const row = rows[0];
      if (!row) return null;
      await api.audit(id, 'create', { source: t.source, bucket: t.bucket, by: t.classifiedBy });
      return toTxn(row);
    },

    async updateTransaction(
      id: string,
      patch: Partial<Pick<Transaction, 'bucket' | 'streamId' | 'category' | 'businessPercent' | 'note' | 'classifiedBy' | 'meta' | 'date' | 'amountPence' | 'counterparty'>>,
    ): Promise<Transaction | null> {
      const existing = await api.getTransaction(id);
      if (!existing) return null;
      const next = { ...existing, ...patch, meta: { ...existing.meta, ...(patch.meta ?? {}) } };
      await db.query(
        `UPDATE transactions SET bucket=$2, stream_id=$3, category=$4, business_percent=$5, note=$6, classified_by=$7,
           meta=$8::jsonb, date=$9, amount_pence=$10, counterparty=$11, updated_at=$12 WHERE id=$1`,
        [id, next.bucket, next.streamId, next.category, next.businessPercent, next.note, next.classifiedBy,
          JSON.stringify(next.meta), next.date, next.amountPence, next.counterparty, now()],
      );
      const changed: Record<string, unknown> = {};
      for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
        if (JSON.stringify(existing[k]) !== JSON.stringify(next[k])) changed[k] = { from: existing[k], to: next[k] };
      }
      if (Object.keys(changed).length) await api.audit(id, 'update', changed);
      return api.getTransaction(id);
    },

    async deleteTransaction(id: string): Promise<void> {
      await db.query('DELETE FROM transactions WHERE id = $1', [id]);
      await api.audit(id, 'delete', {});
    },

    async audit(transactionId: string | null, action: string, detail: unknown): Promise<void> {
      await db.query('INSERT INTO audit_log (at, transaction_id, action, detail) VALUES ($1,$2,$3,$4::jsonb)', [
        now(), transactionId, action, JSON.stringify(detail ?? {}),
      ]);
    },

    async history(transactionId: string): Promise<{ at: string; action: string; detail: unknown }[]> {
      const rows = await db.query<Row>('SELECT at, action, detail FROM audit_log WHERE transaction_id = $1 ORDER BY id', [transactionId]);
      return rows.map((r) => ({ at: s(r.at), action: s(r.action), detail: r.detail }));
    },

    // ── Streams ───────────────────────────────────────────────────────────────────────
    async listStreams(): Promise<Stream[]> {
      return (await db.query<Row>('SELECT * FROM streams ORDER BY created_at')).map(toStream);
    },
    async saveStream(st: Omit<Stream, 'id'> & { id?: string }): Promise<Stream> {
      const id = st.id ?? mkId();
      await db.query(
        `INSERT INTO streams (id, name, kind, color, archived, created_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET name=$2, kind=$3, color=$4, archived=$5`,
        [id, st.name, st.kind, st.color, st.archived, now()],
      );
      return { id, name: st.name, kind: st.kind, color: st.color, archived: st.archived };
    },

    // ── Rules ─────────────────────────────────────────────────────────────────────────
    async listRules(): Promise<Rule[]> {
      return (await db.query<Row>('SELECT * FROM rules ORDER BY created_at')).map(toRule);
    },
    async insertRule(r: Omit<Rule, 'id' | 'createdAt'>): Promise<Rule> {
      const rule: Rule = { ...r, id: mkId(), createdAt: now() };
      await db.query(
        `INSERT INTO rules (id, field, pattern, direction, bucket, stream_id, category, business_percent, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [rule.id, rule.field, rule.pattern, rule.direction, rule.bucket, rule.streamId, rule.category, rule.businessPercent, rule.createdAt],
      );
      return rule;
    },
    async deleteRule(id: string): Promise<void> {
      await db.query('DELETE FROM rules WHERE id = $1', [id]);
    },

    // ── Receipts ──────────────────────────────────────────────────────────────────────
    async listReceipts(): Promise<Receipt[]> {
      return (await db.query<Row>(`SELECT ${RECEIPT_COLS} FROM receipts ORDER BY uploaded_at DESC`)).map(toReceipt);
    },
    async getReceipt(id: string): Promise<Receipt | null> {
      const [row] = await db.query<Row>(`SELECT ${RECEIPT_COLS} FROM receipts WHERE id = $1`, [id]);
      return row ? toReceipt(row) : null;
    },
    async getReceiptFile(id: string): Promise<{ mime: string; filename: string; data: Buffer } | null> {
      const [row] = await db.query<Row>('SELECT mime, filename, data_base64 FROM receipts WHERE id = $1', [id]);
      return row ? { mime: s(row.mime), filename: s(row.filename), data: Buffer.from(s(row.data_base64), 'base64') } : null;
    },
    /** Returns null when a receipt with this sourceId was already imported. */
    async insertReceipt(r: Omit<Receipt, 'id' | 'uploadedAt'>, dataBase64: string, sourceId: string | null = null): Promise<Receipt | null> {
      const id = mkId();
      const rows = await db.query<Row>(
        `INSERT INTO receipts (id, uploaded_at, filename, mime, data_base64, merchant, date, total_pence, vat_pence, suggested_category, description, transaction_id, source_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (source_id) DO NOTHING RETURNING ${RECEIPT_COLS}`,
        [id, now(), r.filename, r.mime, dataBase64, r.merchant, r.date, r.totalPence, r.vatPence, r.suggestedCategory, r.description, r.transactionId, sourceId],
      );
      return rows[0] ? toReceipt(rows[0]) : null;
    },
    async updateReceipt(id: string, patch: Partial<Omit<Receipt, 'id' | 'uploadedAt' | 'mime' | 'filename'>>): Promise<Receipt | null> {
      const existing = await api.getReceipt(id);
      if (!existing) return null;
      const next = { ...existing, ...patch };
      await db.query(
        `UPDATE receipts SET merchant=$2, date=$3, total_pence=$4, vat_pence=$5, suggested_category=$6, description=$7, transaction_id=$8 WHERE id=$1`,
        [id, next.merchant, next.date, next.totalPence, next.vatPence, next.suggestedCategory, next.description, next.transactionId],
      );
      if (patch.transactionId !== undefined && patch.transactionId !== existing.transactionId) {
        await api.audit(patch.transactionId ?? existing.transactionId, patch.transactionId ? 'receipt_attached' : 'receipt_detached', { receiptId: id });
      }
      return api.getReceipt(id);
    },
    async deleteReceipt(id: string): Promise<void> {
      await db.query('DELETE FROM receipts WHERE id = $1', [id]);
    },

    // ── Key/value: settings + sync state ─────────────────────────────────────────────
    async getKv<T>(key: string): Promise<T | null> {
      const [row] = await db.query<Row>('SELECT value FROM kv WHERE key = $1', [key]);
      if (!row) return null;
      return (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) as T;
    },
    async setKv(key: string, value: unknown): Promise<void> {
      await db.query(
        'INSERT INTO kv (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = $2::jsonb',
        [key, JSON.stringify(value)],
      );
    },
    async getSettings(): Promise<Settings> {
      const stored = await api.getKv<Partial<Settings>>('settings');
      return {
        ...DEFAULT_SETTINGS,
        ...(stored ?? {}),
        profile: { ...DEFAULT_PROFILE, ...(stored?.profile ?? {}) },
        taxYears: { ...(stored?.taxYears ?? {}) },
      };
    },

    // ── Invoices ──────────────────────────────────────────────────────────────────────
    async listInvoices(): Promise<Invoice[]> {
      return (await db.query<Row>('SELECT * FROM invoices ORDER BY issue_date DESC, number DESC')).map(toInvoice);
    },
    async getInvoice(id: string): Promise<Invoice | null> {
      const [row] = await db.query<Row>('SELECT * FROM invoices WHERE id = $1', [id]);
      return row ? toInvoice(row) : null;
    },
    /** The next number, taken atomically so two invoices can never share one. */
    async nextInvoiceNumber(prefix: string): Promise<string> {
      for (;;) {
        const [row] = await db.query<Row>(
          `INSERT INTO kv (key, value) VALUES ('invoice:next', '2'::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = to_jsonb((kv.value #>> '{}')::int + 1)
           RETURNING (value #>> '{}')::int - 1 AS n`,
        );
        const number = formatInvoiceNumber(prefix, Number(row!.n));
        // Skip any number already used (e.g. the counter was reset below an old invoice).
        const [taken] = await db.query<Row>('SELECT 1 FROM invoices WHERE number = $1', [number]);
        if (!taken) return number;
      }
    },
    async peekInvoiceCounter(): Promise<number> {
      return Number((await api.getKv<number>('invoice:next')) ?? 1);
    },
    async setInvoiceCounter(n: number): Promise<void> {
      await api.setKv('invoice:next', n);
    },
    async insertInvoice(d: InvoiceDraft, number: string): Promise<Invoice> {
      const id = mkId();
      const at = now();
      await db.query(
        `INSERT INTO invoices (id, number, stream_id, client_name, client_email, client_address, issue_date, due_date, lines, notes, status, paid_transaction_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,NULL,$12,$12)`,
        [id, number, d.streamId, d.clientName, d.clientEmail, d.clientAddress, d.issueDate, d.dueDate, JSON.stringify(d.lines), d.notes, d.status, at],
      );
      return (await api.getInvoice(id))!;
    },
    async updateInvoice(id: string, patch: Partial<InvoiceDraft> & { paidTransactionId?: string | null }): Promise<Invoice | null> {
      const cur = await api.getInvoice(id);
      if (!cur) return null;
      const n = { ...cur, ...patch };
      await db.query(
        `UPDATE invoices SET stream_id=$2, client_name=$3, client_email=$4, client_address=$5, issue_date=$6, due_date=$7,
           lines=$8::jsonb, notes=$9, status=$10, paid_transaction_id=$11, updated_at=$12 WHERE id=$1`,
        [id, n.streamId, n.clientName, n.clientEmail, n.clientAddress, n.issueDate, n.dueDate, JSON.stringify(n.lines), n.notes, n.status, n.paidTransactionId, now()],
      );
      return api.getInvoice(id);
    },
    async deleteInvoice(id: string): Promise<void> {
      await db.query('DELETE FROM invoices WHERE id = $1', [id]);
    },

    /** How much space the database is using, in bytes. */
    async databaseBytes(): Promise<number> {
      const [row] = await db.query<Row>('SELECT pg_database_size(current_database()) AS bytes');
      return Number(row?.bytes ?? 0);
    },
    async saveSettings(settings: Settings): Promise<void> {
      await api.setKv('settings', settings);
    },
  };
  return api;
}

export type Repo = ReturnType<typeof repo>;
