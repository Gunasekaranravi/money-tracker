// Web-only stand-in for db.ts, used by the browser preview (Metro picks .web.ts on web).
// Same API, kept in memory and saved to localStorage. Android uses the real SQLite in db.ts.
// Only type imports here, so Node tests can load this file directly.
import type { ParsedTxn } from './parser';
import type { Kind, Label, Txn } from './db';
import type { Summary } from './schema';

export type { Kind, Label, Summary, Txn } from './db';

const KEY = 'money-tracker-preview';

type Store = { txns: Txn[]; meta: Record<string, string> };

// Rows saved before `kind` existed carried the parser's `refund` flag instead.
type StoredTxn = Omit<Txn, 'kind'> & { kind?: Kind | null; refund?: boolean };

function load(): Store {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as { txns: StoredTxn[]; meta: Record<string, string> };
      const txns = s.txns.map(({ refund, kind, ...t }) => ({
        ...t,
        kind: kind ?? (refund && t.type === 'income' ? ('refund' as const) : null),
      }));
      return { txns, meta: s.meta };
    }
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
  store.txns.push({
    id,
    type: p.type,
    amount: p.amount,
    party: p.party,
    bank: p.bank,
    account: p.account,
    ref: p.ref,
    date,
    body,
    label: null,
    kind: p.refund ? 'refund' : null,
  });
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

/** Same rules as SUMMARY_SQL in schema.ts. */
export async function getSummary(from: number, to: number): Promise<Summary> {
  const s: Summary = { inflow: 0, outflow: 0, refunds: 0, need: 0, want: 0, unreviewedOut: 0 };
  for (const t of store.txns) {
    if (t.date < from || t.date >= to || t.label === 'ignored') continue;
    if (t.type === 'income') {
      if (t.kind === 'refund') s.refunds += t.amount;
      else s.inflow += t.amount;
    } else {
      s.outflow += t.amount;
    }
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
