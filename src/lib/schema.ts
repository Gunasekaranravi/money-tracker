// SQLite schema, migrations, row writes and the summary query. No Expo imports, so Node tests
// can run the same code against a real SQLite database (scripts/test-summary.ts).
import type { ParsedTxn } from './parser';

export const SCHEMA_VERSION = 1;

/**
 * Runs `open` once and shares the result. If it fails, the failure is not kept:
 * the next call tries again (nothing is cleared or deleted).
 */
export function retryableOnce<T>(open: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = open().catch((e) => {
        pending = null;
        throw e;
      });
    }
    return pending;
  };
}

// kind: NULL = normal transaction, 'refund' = money returned (type stays 'income').
export const CREATE_SQL = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS txns (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    party TEXT NOT NULL,
    bank TEXT NOT NULL,
    account TEXT,
    ref TEXT,
    date INTEGER NOT NULL,
    body TEXT NOT NULL,
    label TEXT,
    kind TEXT
  );
  CREATE INDEX IF NOT EXISTS txns_ref ON txns(ref);
  CREATE INDEX IF NOT EXISTS txns_date ON txns(date);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
`;

/** The few database calls migrations need (expo-sqlite's API shape). */
export type MigrationDb = {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
};

/**
 * Brings an existing database up to SCHEMA_VERSION. Never deletes rows or changes labels.
 * v1: adds `kind` and marks saved income rows whose SMS is a completed refund.
 */
export async function migrate(d: MigrationDb, isRefundText: (body: string) => boolean) {
  const row = await d.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;

  if (version < 1) {
    await d.withTransactionAsync(async () => {
      const cols = await d.getAllAsync<{ name: string }>('PRAGMA table_info(txns)');
      if (!cols.some((c) => c.name === 'kind')) {
        await d.execAsync('ALTER TABLE txns ADD COLUMN kind TEXT');
      }
      // Only income rows: older expense rows keep their type and Need/Want label.
      const incomes = await d.getAllAsync<{ id: string; body: string }>(
        "SELECT id, body FROM txns WHERE type = 'income' AND kind IS NULL",
      );
      for (const r of incomes) {
        if (isRefundText(r.body)) {
          await d.runAsync("UPDATE txns SET kind = 'refund' WHERE id = ?", r.id);
        }
      }
      await d.execAsync('PRAGMA user_version = 1');
    });
  }
}

/**
 * Inserts a parsed SMS. Skips it if the id already exists (never overwrites label or kind),
 * or if a row with the same UPI ref and type exists (some banks send 2 SMS).
 */
export async function insertTxnRow(d: MigrationDb, id: string, p: ParsedTxn, date: number, body: string) {
  if (p.ref) {
    const dup = await d.getFirstAsync('SELECT id FROM txns WHERE ref = ? AND type = ?', p.ref, p.type);
    if (dup) return false;
  }
  const r = await d.runAsync(
    `INSERT OR IGNORE INTO txns (id, type, amount, party, bank, account, ref, date, body, label, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    id, p.type, p.amount, p.party, p.bank, p.account, p.ref, date, body, p.refund ? 'refund' : null,
  );
  return r.changes > 0;
}

export async function setLabelRow(d: MigrationDb, id: string, label: string | null) {
  await d.runAsync('UPDATE txns SET label = ? WHERE id = ?', label, id);
}

export type Summary = {
  inflow: number; // earned income (refunds not included)
  outflow: number; // all money paid out
  refunds: number; // money returned
  need: number;
  want: number;
  unreviewedOut: number;
};

export const EMPTY_SUMMARY: Summary = {
  inflow: 0,
  outflow: 0,
  refunds: 0,
  need: 0,
  want: 0,
  unreviewedOut: 0,
};

// Params: from, to (epoch ms). "Don't count" rows are left out.
export const SUMMARY_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN type = 'income' AND COALESCE(kind, '') != 'refund' THEN amount END), 0) AS inflow,
    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS outflow,
    COALESCE(SUM(CASE WHEN type = 'income' AND kind = 'refund' THEN amount END), 0) AS refunds,
    COALESCE(SUM(CASE WHEN label = 'need' THEN amount END), 0) AS need,
    COALESCE(SUM(CASE WHEN label = 'want' THEN amount END), 0) AS want,
    COALESCE(SUM(CASE WHEN type = 'expense' AND label IS NULL THEN amount END), 0) AS unreviewedOut
  FROM txns
  WHERE date >= ? AND date < ? AND (label IS NULL OR label != 'ignored')
`;

/** Numbers shown on the dashboard. Net equals money received minus money paid. */
export function dashboard(s: Summary) {
  const spent = s.outflow - s.refunds;
  return { spent, net: s.inflow + s.refunds - s.outflow };
}
