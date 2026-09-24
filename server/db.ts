import { SCHEMA } from './schema.js';

/** A setting is missing — shown to you as a setup step, not a crash. */
export class ConfigError extends Error {}

// One tiny interface over two drivers: Neon's serverless HTTP driver in production, and
// PGlite (real Postgres compiled to WASM) for local dev and tests — so the SQL that runs in
// the tests is the SQL that runs in production, not a mock of it.

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

let cached: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!cached) {
    cached = open().catch((e) => {
      cached = null; // a failed connection shouldn't be cached forever
      throw e;
    });
  }
  return cached;
}

/** Swap in a database (tests). */
export function setDb(db: Db | null): void {
  cached = db ? Promise.resolve(db) : null;
}

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  let db: Db;
  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    db = { query: async (text, params = []) => (await sql.query(text, params)) as never };
  } else if (process.env.VERCEL) {
    throw new ConfigError('DATABASE_URL is not set — connect a Neon database in Vercel → Storage, then redeploy.');
  } else {
    // Local development: a real Postgres in a folder, no install needed.
    db = await pglite(process.env.PGLITE_DIR ?? '.data/pglite');
  }
  await migrate(db);
  return db;
}

export async function pglite(dir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dir ? new PGlite(dir) : new PGlite();
  return { query: async (text, params = []) => (await pg.query(text, params)).rows as never };
}

export async function migrate(db: Db): Promise<void> {
  for (const statement of SCHEMA) await db.query(statement);
}
