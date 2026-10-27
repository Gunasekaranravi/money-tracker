// Run: node --experimental-strip-types scripts/test-parser.ts
import { parseSms } from '../src/lib/parser.ts';
import { SAMPLE_SMS } from '../src/lib/samples.ts';

let failed = 0;
for (const s of SAMPLE_SMS) {
  const got = parseSms(s.address, s.body);
  const e = s.expect;
  const ok =
    e === null
      ? got === null
      : got !== null &&
        got.type === e.type &&
        got.amount === e.amount &&
        (e.party === undefined || got.party === e.party);
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL', s.address.padEnd(14), JSON.stringify(got));
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
