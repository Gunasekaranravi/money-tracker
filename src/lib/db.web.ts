// Web-only stand-in for db.ts, used by the browser preview (Metro picks .web.ts on web).
// Same API, kept in memory and saved to localStorage. Android uses the real SQLite in db.ts.
import type { ParsedTxn } from './parser';
import type { Label, Summary, Txn } from './db';

export type { Label, Summary, Txn } from './db';

const KEY = 'money-tracker-preview';

type Store = { txns: Txn[]; meta: Record<string, string> };

function load(): Store {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {}
  return { txns: [], meta: {} };
}

const store = load();

function save() {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(store));
  } catch {}
}

export async function getMeta(key: string): Promise<string | null> {
  return store.meta[key] ?? null;
}

export async function setMeta(key: string, value: string) {
  store.meta[key] = value;
  save();
}

export async function insertTxn(id: string, p: ParsedTxn, date: number, body: string) {
  if (store.txns.some((t) => t.id === id)) return false;
  if (p.ref && store.txns.some((t) => t.ref === p.ref && t.type === p.type)) return false;
  store.txns.push({ id, ...p, date, body, label: null });
  save();
  return true;
}

export async function setLabel(id: string, label: Label | null) {
  const t = store.txns.find((x) => x.id === id);
  if (t) {
    t.label = label;
    save();
  }
}

export async function getPending(): Promise<Txn[]> {
  return store.txns.filter((t) => t.label === null).sort((a, b) => a.date - b.date);
}

export async function getRecent(limit = 15): Promise<Txn[]> {
  return store.txns
    .filter((t) => t.label !== null)
    .sort((a, b) => b.date - a.date)
    .slice(0, limit);
}

export async function getSummary(from: number, to: number): Promise<Summary> {
  const s: Summary = { inflow: 0, outflow: 0, need: 0, want: 0, unreviewedOut: 0 };
  for (const t of store.txns) {
    if (t.date < from || t.date >= to || t.label === 'ignored') continue;
    if (t.type === 'income') s.inflow += t.amount;
    else s.outflow += t.amount;
    if (t.label === 'need') s.need += t.amount;
    if (t.label === 'want') s.want += t.amount;
    if (t.type === 'expense' && t.label === null) s.unreviewedOut += t.amount;
  }
  return s;
}

export async function clearAll() {
  store.txns = [];
  store.meta = {};
  save();
}
