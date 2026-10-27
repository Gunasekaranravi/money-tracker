import * as SQLite from 'expo-sqlite';
import type { ParsedTxn, TxnType } from './parser';

// null = not reviewed yet
export type Label = 'need' | 'want' | 'income' | 'ignored';

export type Txn = {
  id: string;
  type: TxnType;
  amount: number;
  party: string;
  bank: string;
  account: string | null;
  ref: string | null;
  date: number;
  body: string;
  label: Label | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const d = await SQLite.openDatabaseAsync('money.db');
      await d.execAsync(`
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
          label TEXT
        );
        CREATE INDEX IF NOT EXISTS txns_ref ON txns(ref);
        CREATE INDEX IF NOT EXISTS txns_date ON txns(date);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      `);
      return d;
    })();
  }
  return dbPromise;
}

export async function getMeta(key: string): Promise<string | null> {
  const row = await (await db()).getFirstAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string) {
  await (await db()).runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

/** Inserts a parsed SMS. Skips it if we already have it, or the same UPI ref (some banks send 2 SMS). */
export async function insertTxn(id: string, p: ParsedTxn, date: number, body: string) {
  const d = await db();
  if (p.ref) {
    const dup = await d.getFirstAsync('SELECT id FROM txns WHERE ref = ? AND type = ?', p.ref, p.type);
    if (dup) return false;
  }
  const r = await d.runAsync(
    `INSERT OR IGNORE INTO txns (id, type, amount, party, bank, account, ref, date, body, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    id, p.type, p.amount, p.party, p.bank, p.account, p.ref, date, body,
  );
  return r.changes > 0;
}

export async function setLabel(id: string, label: Label | null) {
  await (await db()).runAsync('UPDATE txns SET label = ? WHERE id = ?', label, id);
}

/** Cards still waiting for a swipe, oldest first so you review in order. */
export async function getPending(): Promise<Txn[]> {
  return (await db()).getAllAsync<Txn>('SELECT * FROM txns WHERE label IS NULL ORDER BY date ASC');
}

export async function getRecent(limit = 15): Promise<Txn[]> {
  return (await db()).getAllAsync<Txn>(
    'SELECT * FROM txns WHERE label IS NOT NULL ORDER BY date DESC LIMIT ?',
    limit,
  );
}

export type Summary = {
  inflow: number;
  outflow: number;
  need: number;
  want: number;
  unreviewedOut: number;
};

export async function getSummary(from: number, to: number): Promise<Summary> {
  const row = await (await db()).getFirstAsync<Summary>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS inflow,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS outflow,
       COALESCE(SUM(CASE WHEN label = 'need' THEN amount END), 0) AS need,
       COALESCE(SUM(CASE WHEN label = 'want' THEN amount END), 0) AS want,
       COALESCE(SUM(CASE WHEN type = 'expense' AND label IS NULL THEN amount END), 0) AS unreviewedOut
     FROM txns
     WHERE date >= ? AND date < ? AND (label IS NULL OR label != 'ignored')`,
    from,
    to,
  );
  return row ?? { inflow: 0, outflow: 0, need: 0, want: 0, unreviewedOut: 0 };
}

export async function clearAll() {
  await (await db()).execAsync('DELETE FROM txns; DELETE FROM meta;');
}
