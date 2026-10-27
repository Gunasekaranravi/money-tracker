import { getMessages } from '../../modules/sms-reader';
import { getMeta, insertTxn, setMeta } from './db';
import { parseSms } from './parser';
import { SAMPLE_SMS } from './samples';

const FIRST_SYNC_DAYS = 60;

/** Reads SMS newer than the last sync, saves the bank transactions. Returns how many were added. */
export async function syncSms(): Promise<number> {
  const last = Number((await getMeta('lastSmsDate')) ?? 0);
  const since = last || Date.now() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000;
  const messages = await getMessages(since);

  let added = 0;
  let newest = last;
  // Oldest first, so if the same UPI ref comes twice we keep the first SMS.
  for (const m of [...messages].reverse()) {
    newest = Math.max(newest, m.date);
    const parsed = parseSms(m.address, m.body);
    if (parsed && (await insertTxn(`sms:${m.id}`, parsed, m.date, m.body ?? ''))) added++;
  }
  if (newest > last) await setMeta('lastSmsDate', String(newest));
  return added;
}

/** Loads the sample messages so the app can be tried without SMS access. */
export async function loadDemoData(): Promise<number> {
  let added = 0;
  const now = Date.now();
  for (let i = 0; i < SAMPLE_SMS.length; i++) {
    const s = SAMPLE_SMS[i];
    const parsed = parseSms(s.address, s.body);
    // Spread the demo messages over the last few days.
    const date = now - i * 7 * 60 * 60 * 1000;
    if (parsed && (await insertTxn(`demo:${i}`, parsed, date, s.body))) added++;
  }
  await setMeta('demo', '1');
  return added;
}
