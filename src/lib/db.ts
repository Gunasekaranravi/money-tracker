import * as SQLite from 'expo-sqlite';
import { isRefundText, type ParsedTxn, type TxnType } from './parser';
import { CREATE_SQL, EMPTY_SUMMARY, migrate, SUMMARY_SQL, type Summary } from './schema';

export type { Summary } from './schema';

// null = not reviewed yet
export type Label = 'need' | 'want' | 'income' | 'ignored';
// null = normal transaction
export type Kind = 'refund';

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
  kind: Kind | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const d = await SQLite.openDatabaseAsync('money.db');
      await d.execAsync(CREATE_SQL);
      // Other calls wait for this promise, so nothing runs between these steps.
      await migrate(d, isRefundText);
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
    `INSERT OR IGNORE INTO txns (id, type, amount, party, bank, account, ref, date, body, label, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    id, p.type, p.amount, p.party, p.bank, p.account, p.ref, date, body, p.refund ? 'refund' : null,
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

export async function getSummary(from: number, to: number): Promise<Summary> {
  const row = await (await db()).getFirstAsync<Summary>(SUMMARY_SQL, from, to);
  return row ?? EMPTY_SUMMARY;
}

export async function clearAll() {
  await (await db()).execAsync('DELETE FROM txns; DELETE FROM meta;');
}
