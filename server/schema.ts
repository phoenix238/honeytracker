// The database schema. Idempotent — safe to run on every deploy and every cold start, so a
// new column never needs a manual migration step. Additive changes only: never drop or
// rename a column here, since the data in it is someone's tax records.

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS streams (
    id text PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL DEFAULT 'self_employment',
    color text NOT NULL DEFAULT '#E0A92E',
    archived boolean NOT NULL DEFAULT false,
    created_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id text PRIMARY KEY,
    date text NOT NULL,
    amount_pence integer NOT NULL CHECK (amount_pence >= 0),
    direction text NOT NULL CHECK (direction IN ('in', 'out')),
    source text NOT NULL,
    source_id text,
    counterparty text NOT NULL DEFAULT '',
    reference text NOT NULL DEFAULT '',
    bucket text NOT NULL DEFAULT 'unreviewed',
    stream_id text REFERENCES streams(id) ON DELETE SET NULL,
    category text,
    business_percent integer NOT NULL DEFAULT 100,
    note text NOT NULL DEFAULT '',
    classified_by text,
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`,
  // A bank transaction (or CSTL booking, or imported record) can only ever land once.
  `CREATE UNIQUE INDEX IF NOT EXISTS transactions_source_uid ON transactions (source, source_id) WHERE source_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS transactions_date ON transactions (date)`,
  `CREATE INDEX IF NOT EXISTS transactions_bucket ON transactions (bucket)`,
  `CREATE TABLE IF NOT EXISTS receipts (
    id text PRIMARY KEY,
    uploaded_at text NOT NULL,
    filename text NOT NULL DEFAULT '',
    mime text NOT NULL,
    data_base64 text NOT NULL,
    merchant text NOT NULL DEFAULT '',
    date text,
    total_pence integer,
    vat_pence integer,
    suggested_category text,
    description text NOT NULL DEFAULT '',
    transaction_id text REFERENCES transactions(id) ON DELETE SET NULL,
    source_id text UNIQUE
  )`,
  `CREATE INDEX IF NOT EXISTS receipts_transaction ON receipts (transaction_id)`,
  `CREATE TABLE IF NOT EXISTS rules (
    id text PRIMARY KEY,
    field text NOT NULL,
    pattern text NOT NULL,
    direction text,
    bucket text NOT NULL,
    stream_id text REFERENCES streams(id) ON DELETE CASCADE,
    category text,
    business_percent integer NOT NULL DEFAULT 100,
    created_at text NOT NULL
  )`,
  // Settings and sync watermarks: small JSON documents by key.
  `CREATE TABLE IF NOT EXISTS kv (
    key text PRIMARY KEY,
    value jsonb NOT NULL
  )`,
  // Every change to a classification, kept — so a figure on a return can always be traced
  // back to who (you, a rule, CSTL) decided it and when.
  `CREATE TABLE IF NOT EXISTS audit_log (
    id bigserial PRIMARY KEY,
    at text NOT NULL,
    transaction_id text,
    action text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS audit_log_txn ON audit_log (transaction_id)`,
];
