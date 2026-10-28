// Run: npm run test:summary
// Runs the real migration + summary SQL (src/lib/schema.ts) on Node's built-in SQLite,
// starting from a database in the old (pre-refund) format, and checks the browser store matches.
import { DatabaseSync } from 'node:sqlite';
import { isRefundText, parseSms } from '../src/lib/parser.ts';
import {
  CREATE_SQL,
  dashboard,
  insertTxnRow,
  migrate,
  retryableOnce,
  setLabelRow,
  SUMMARY_SQL,
  type MigrationDb,
  type Summary,
} from '../src/lib/schema.ts';

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

// ---------- 5. Failed migration rolls back, retry succeeds ----------
console.log('\nFailed migration');
const OLD_SCHEMA = `
  CREATE TABLE txns (
    id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL, party TEXT NOT NULL,
    bank TEXT NOT NULL, account TEXT, ref TEXT, date INTEGER NOT NULL, body TEXT NOT NULL, label TEXT
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
`;
const SALARY_WITH_REVERSAL =
  'INR 30,000.00 credited to HDFC Bank A/c XX1111 on 01-10-26 by NEFT from ACME LTD, for reversal queries contact your branch.';
{
  const f = new DatabaseSync(':memory:');
  f.exec(OLD_SCHEMA);
  const put = f.prepare(
    "INSERT INTO txns (id, type, amount, party, bank, account, ref, date, body, label) VALUES (?, 'income', ?, 'x', 'HDFC', NULL, NULL, ?, ?, ?)",
  );
  put.run('sms:1', 450, D(1), REVERSAL, 'income');
  put.run('sms:2', 799, D(2), REFUND, null);
  put.run('sms:3', 30000, D(3), SALARY_WITH_REVERSAL, 'income');
  const rowsBefore = f.prepare('SELECT * FROM txns ORDER BY id').all();
  f.exec(CREATE_SQL);
  let calls = 0;
  let threw = false;
  try {
    // Real migrate(); the 2nd refund check throws after the column was added and a row was marked.
    await migrate(adapt(f), (body) => {
      if (++calls === 2) throw new Error('simulated failure');
      return isRefundText(body);
    });
  } catch {
    threw = true;
  }
  const colsAfterFail = (f.prepare('PRAGMA table_info(txns)').all() as any[]).map((c) => c.name);
  check('failure is reported', threw);
  check('schema change rolled back (no kind column)', !colsAfterFail.includes('kind'), JSON.stringify(colsAfterFail));
  check('user_version still 0', (f.prepare('PRAGMA user_version').get() as any).user_version === 0);
  check('rows untouched after failure', eq(f.prepare('SELECT * FROM txns ORDER BY id').all(), rowsBefore));
  await migrate(adapt(f), isRefundText);
  const kinds = f.prepare('SELECT id, label, kind FROM txns ORDER BY id').all();
  check(
    'retry succeeds; salary mentioning reversal is not a refund',
    eq(kinds, [
      { id: 'sms:1', label: 'income', kind: 'refund' },
      { id: 'sms:2', label: null, kind: 'refund' },
      { id: 'sms:3', label: 'income', kind: null },
    ]),
    JSON.stringify(kinds),
  );
}

// ---------- 6. Opening the database can be retried ----------
console.log('\nRetryable open (db.ts uses retryableOnce)');
{
  let attempts = 0;
  const open = retryableOnce(async () => {
    attempts++;
    if (attempts === 1) throw new Error('disk busy');
    return { n: attempts };
  });
  const first = await open().then(() => 'ok', (e) => e.message);
  check('first failure is surfaced', first === 'disk busy', first);
  const [a, b] = await Promise.all([open(), open()]);
  check('next call retries and succeeds', a.n === 2, JSON.stringify(a));
  check('calls share one open', a === b && (await open()) === a && attempts === 2, `attempts=${attempts}`);
}

// ---------- 7. Duplicates, ref dedupe, labels and kind ----------
console.log('\nDuplicates and labels (insertTxnRow / setLabelRow)');
{
  const t = new DatabaseSync(':memory:');
  t.exec(CREATE_SQL);
  const tdb = adapt(t);
  await migrate(tdb, isRefundText);
  const insert = async (id: string, address: string, body: string, date: number) => {
    const p = parseSms(address, body);
    if (!p) throw new Error(`parser rejected ${id}`);
    return insertTxnRow(tdb, id, p, date, body);
  };
  const PAY = 'Rs.300.00 debited from A/c XX1111 to VPA shop@okhdfc on 01-10-26. UPI Ref 612345678902';
  const PAY_REFUND = 'Rs.300.00 refunded to A/c XX1111 on 02-10-26 for UPI Ref 612345678902';
  const PAY_REFUND_AGAIN = 'INR 300.00 refunded to your A/c XX1111 UPI Ref 612345678902';
  const DEBIT_WITH_REVERSAL =
    'Rs.500.00 debited from A/c XX1111 to VPA cafe@okaxis on 03-10-26, if not done by you raise a reversal request at your branch';

  check('debit inserted', (await insert('sms:20', 'AX-HDFCBK', PAY, D(1))) === true);
  check('refund with the same UPI ref is kept (different type)', (await insert('sms:21', 'AX-HDFCBK', PAY_REFUND, D(2))) === true);
  check('2nd SMS for the same refund is dropped (same ref + type)', (await insert('sms:22', 'AX-HDFCBK', PAY_REFUND_AGAIN, D(2))) === false);
  check('salary mentioning reversal inserted', (await insert('sms:23', 'VM-HDFCBK', SALARY_WITH_REVERSAL, D(3))) === true);
  check('debit mentioning a reversal request inserted', (await insert('sms:24', 'AX-HDFCBK', DEBIT_WITH_REVERSAL, D(3))) === true);

  await setLabelRow(tdb, 'sms:20', 'want');
  await setLabelRow(tdb, 'sms:21', 'income');
  await setLabelRow(tdb, 'sms:23', 'income');
  await setLabelRow(tdb, 'sms:24', 'need');
  const snapshot = t.prepare('SELECT id, type, amount, label, kind FROM txns ORDER BY id').all();
  // Same SMS read again (e.g. a later sync): nothing may change.
  const again1 = await insert('sms:20', 'AX-HDFCBK', PAY, D(1));
  const again2 = await insert('sms:21', 'AX-HDFCBK', PAY_REFUND, D(2));
  check('re-inserting existing SMS is ignored', again1 === false && again2 === false);
  check('labels and kind unchanged after re-insert', eq(t.prepare('SELECT id, type, amount, label, kind FROM txns ORDER BY id').all(), snapshot));

  const rows = Object.fromEntries((snapshot as any[]).map((r) => [r.id, r]));
  check('salary mentioning reversal stored as income, not refund', rows['sms:23'].type === 'income' && rows['sms:23'].kind === null);
  check('debit mentioning reversal request stored as expense', rows['sms:24'].type === 'expense' && rows['sms:24'].kind === null);
  check('refund stored as income + kind refund', rows['sms:21'].type === 'income' && rows['sms:21'].kind === 'refund');

  const s1 = { ...(t.prepare(SUMMARY_SQL).get(FROM, TO) as Summary) };
  check(
    'summary: salary is inflow, refund is separate',
    s1.inflow === 30000 && s1.refunds === 300 && s1.outflow === 800 && s1.need === 500 && s1.want === 300,
    JSON.stringify(s1),
  );
  // "Don't count" the refund: it must leave the refunds total (and nothing else changes).
  await setLabelRow(tdb, 'sms:21', 'ignored');
  const s2 = { ...(t.prepare(SUMMARY_SQL).get(FROM, TO) as Summary) };
  check('ignored refund excluded from refunds', s2.refunds === 0 && s2.inflow === 30000 && s2.outflow === 800, JSON.stringify(s2));
}

const total = failed;
console.log(total ? `\n${total} failed` : '\nall summary/migration checks passed');
process.exit(total ? 1 : 0);
