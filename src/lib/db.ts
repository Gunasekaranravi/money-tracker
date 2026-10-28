import * as SQLite from 'expo-sqlite';
import { isRefundText, type ParsedTxn, type TxnType } from './parser';
import {
  CREATE_SQL,
  EMPTY_SUMMARY,
  insertTxnRow,
  migrate,
  retryableOnce,
  setLabelRow,
  SUMMARY_SQL,
  type Summary,
} from './schema';

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

// Opened once and shared. If opening or migrating fails, the next call retries
// (the migration rolls back, so a retry starts from the same data).
const db = retryableOnce(async () => {
  const d = await SQLite.openDatabaseAsync('money.db');
  await d.execAsync(CREATE_SQL);
  // Other calls wait for this promise, so nothing runs between these steps.
  await migrate(d, isRefundText);
  return d;
});

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
  return insertTxnRow(await db(), id, p, date, body);
}

export async function setLabel(id: string, label: Label | null) {
  await setLabelRow(await db(), id, label);
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
