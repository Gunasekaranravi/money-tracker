// Run: npm run test:summary
// Runs the real migration + summary SQL (src/lib/schema.ts) on Node's built-in SQLite,
// starting from a database in the old (pre-refund) format, and checks the browser store matches.
import { DatabaseSync } from 'node:sqlite';
import { isRefundText, parseSms } from '../src/lib/parser.ts';
import { CREATE_SQL, dashboard, migrate, SUMMARY_SQL, type MigrationDb, type Summary } from '../src/lib/schema.ts';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : detail);
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function adapt(db: DatabaseSync): MigrationDb {
  return {
    async execAsync(sql) { db.exec(sql); },
    async runAsync(sql, ...p) { return db.prepare(sql).run(...p); },
    async getFirstAsync(sql, ...p) { return (db.prepare(sql).get(...p) as any) ?? null; },
    async getAllAsync(sql, ...p) { return db.prepare(sql).all(...p) as any; },
    async withTransactionAsync(task) {
      db.exec('BEGIN');
      try { await task(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

// Made-up messages.
const SALARY = 'Update! INR 30,000.00 deposited in HDFC Bank A/c XX1111 on 01-OCT-26 for NEFT Cr-ACME LTD.';
const REVERSAL = 'INR 450.00 reversed to your A/c XX1111 on 01-10-26 for UPI txn 612345678906';
const REFUND = 'Refund of Rs.799.00 credited to your HDFC Bank A/c XX1111 from AMAZON on 02-10-26. Ref 612345678907';
const GROCERY = 'Rs.1,200.00 debited from A/c XX1111 to VPA grocer@okaxis on 03-10-26. UPI Ref 612345678911';
const MOVIE = 'Rs.500.00 debited from A/c XX1111 to VPA cinema@okhdfc on 04-10-26. UPI Ref 612345678912';
const OLD_REVERSED_DEBIT = 'Rs 999.00 debited from A/C X1111 on 28Sep26 has been reversed to your account on 01Oct26. Ref 612345678908 -SBI';
const GIFT = 'Rs.2,000.00 credited to your A/c XX1111 from A FRIEND on 05-10-26. UPI Ref 612345678913';

const FROM = Date.UTC(2026, 9, 1);
const TO = Date.UTC(2026, 10, 1);
const D = (day: number) => Date.UTC(2026, 9, day, 12);

// ---------- 1. Migration from the old format ----------
console.log('\nMigration (old database without `kind`)');
const sql = new DatabaseSync(':memory:');
sql.exec(`
  CREATE TABLE txns (
    id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL, party TEXT NOT NULL,
    bank TEXT NOT NULL, account TEXT, ref TEXT, date INTEGER NOT NULL, body TEXT NOT NULL, label TEXT
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
`);
const oldRows: [string, string, number, string, string | null, number][] = [
  ['sms:1', 'income', 30000, SALARY, 'income', D(1)],
  ['sms:2', 'income', 450, REVERSAL, 'income', D(1)],
  ['sms:3', 'income', 799, REFUND, null, D(2)], // refund not swiped yet
  ['sms:4', 'expense', 1200, GROCERY, 'need', D(3)],
  ['sms:5', 'expense', 500, MOVIE, 'want', D(4)],
  ['sms:6', 'expense', 999, OLD_REVERSED_DEBIT, 'want', D(1)], // saved by the old parser as an expense
  ['sms:7', 'income', 2000, GIFT, 'ignored', D(5)], // "don't count"
];
const ins = sql.prepare(
  "INSERT INTO txns (id, type, amount, party, bank, account, ref, date, body, label) VALUES (?, ?, ?, 'x', 'HDFC', NULL, NULL, ?, ?, ?)",
);
for (const [id, type, amount, body, label, date] of oldRows) ins.run(id, type, amount, date, body, label);
const before = sql.prepare('SELECT id, type, amount, label FROM txns ORDER BY id').all();

const db = adapt(sql);
sql.exec(CREATE_SQL); // what the app runs on open (no-op for existing tables)
await migrate(db, isRefundText);

const after = sql.prepare('SELECT id, type, amount, label, kind FROM txns ORDER BY id').all() as any[];
check('no rows deleted', after.length === oldRows.length, `${after.length} rows`);
check(
  'type, amount and label unchanged',
  eq(after.map(({ kind, ...r }) => ({ ...r })), before.map((r: any) => ({ ...r }))),
);
const refundIds = after.filter((r) => r.kind === 'refund').map((r) => r.id);
check('only completed refunds on income rows marked', eq(refundIds, ['sms:2', 'sms:3']), JSON.stringify(refundIds));
check('old reversed-debit expense left alone', after.find((r) => r.id === 'sms:6').kind === null);
check('user_version is 1', (sql.prepare('PRAGMA user_version').get() as any).user_version === 1);
await migrate(db, isRefundText);
const again = sql.prepare('SELECT id, type, amount, label, kind FROM txns ORDER BY id').all();
check('running the migration again changes nothing', eq(again, after));

// ---------- 2. Summary on the migrated database ----------
console.log('\nSummary (SQL)');
const s = { ...(sql.prepare(SUMMARY_SQL).get(FROM, TO) as Summary) };
const expected: Summary = {
  inflow: 30000, // salary only; refunds and the ignored gift are out
  outflow: 1200 + 500 + 999,
  refunds: 450 + 799,
  need: 1200,
  want: 500 + 999,
  unreviewedOut: 0,
};
check('summary totals', eq(s, expected), JSON.stringify(s));
const { spent, net } = dashboard(s);
check('spent = outflow − refunds', spent === 2699 - 1249, String(spent));
// The old formula: every counted income minus every expense.
const oldNet = 30000 + 450 + 799 - (1200 + 500 + 999);
check('net unchanged from before refunds were split out', net === oldNet, `${net} vs ${oldNet}`);
check('refunds not in Need/Want', s.need + s.want === 1200 + 500 + 999);

// ---------- 3. Fresh install ----------
console.log('\nFresh database');
const fresh = new DatabaseSync(':memory:');
fresh.exec(CREATE_SQL);
await migrate(adapt(fresh), isRefundText);
const cols = (fresh.prepare('PRAGMA table_info(txns)').all() as any[]).map((c) => c.name);
check('has kind column and version 1', cols.includes('kind') && (fresh.prepare('PRAGMA user_version').get() as any).user_version === 1);

// ---------- 4. Browser store gives the same numbers ----------
console.log('\nBrowser store (db.web.ts)');
// One preview row saved before `kind` existed (it only had the parser's refund flag).
const mem = new Map<string, string>();
mem.set(
  'money-tracker-preview',
  JSON.stringify({
    txns: [{ id: 'demo:old', type: 'income', amount: 450, party: 'x', bank: 'Axis', account: null, ref: null, date: D(1), body: REVERSAL, label: 'income', refund: true }],
    meta: {},
  }),
);
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
};
const web = await import('../src/lib/db.web.ts');
const add = async (id: string, address: string, body: string, date: number, label: any) => {
  const p = parseSms(address, body);
  if (!p) throw new Error(`parser rejected ${id}`);
  await web.insertTxn(id, p, date, body);
  if (label) await web.setLabel(id, label);
};
await add('w1', 'VM-HDFCBK', SALARY, D(1), 'income');
await add('w3', 'AX-HDFCBK-S', REFUND, D(2), null);
await add('w4', 'AX-HDFCBK-S', GROCERY, D(3), 'need');
await add('w5', 'AX-HDFCBK-S', MOVIE, D(4), 'want');
await add('w7', 'AX-HDFCBK-S', GIFT, D(5), 'ignored');
const ws = await web.getSummary(FROM, TO);
const wExpected: Summary = { inflow: 30000, outflow: 1700, refunds: 450 + 799, need: 1200, want: 500, unreviewedOut: 0 };
check('old preview row upgraded to refund', ws.refunds === 1249, JSON.stringify(ws));
check('web summary totals', eq(ws, wExpected), JSON.stringify(ws));
const pending = await web.getPending();
check('refund card is pending with kind refund', pending.length === 1 && pending[0].kind === 'refund');

const total = failed;
console.log(total ? `\n${total} failed` : '\nall summary/migration checks passed');
process.exit(total ? 1 : 0);
