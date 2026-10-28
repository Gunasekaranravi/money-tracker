// Run: npm run test:parser
import { isRefundText, parseSms } from '../src/lib/parser.ts';
import { REGRESSION_SMS, SAMPLE_SMS, type SampleSms } from '../src/lib/samples.ts';

let failed = 0;

function run(title: string, cases: SampleSms[]) {
  console.log(`\n${title}`);
  for (const s of cases) {
    const got = parseSms(s.address, s.body);
    const e = s.expect;
    const ok =
      e === null
        ? got === null
        : got !== null &&
          got.type === e.type &&
          got.amount === e.amount &&
          (e.party === undefined || got.party === e.party) &&
          (e.refund === undefined || got.refund === e.refund);
    // The migration backfill uses isRefundText(); it must agree with parseSms() on every message.
    const agrees = isRefundText(s.body) === (got?.refund ?? false);
    if (!ok || !agrees) failed++;
    const label = s.name ?? s.address;
    console.log(ok && agrees ? 'PASS' : 'FAIL', label.padEnd(56), JSON.stringify(got), agrees ? '' : '(isRefundText disagrees)');
  }
}

run('Demo samples', SAMPLE_SMS);
run('Regression cases', REGRESSION_SMS);

const total = SAMPLE_SMS.length + REGRESSION_SMS.length;
console.log(failed ? `\n${failed} of ${total} failed` : `\nall ${total} passed`);
process.exit(failed ? 1 : 0);
