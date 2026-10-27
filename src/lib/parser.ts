// Turns a bank SMS into a transaction. Returns null for anything that isn't a
// completed debit/credit (OTPs, offers, reminders, failed payments, personal SMS).

export type TxnType = 'income' | 'expense';

export type ParsedTxn = {
  type: TxnType;
  amount: number;
  party: string; // who you paid / who paid you
  bank: string;
  account: string | null; // last digits
  ref: string | null; // UPI / bank reference, used to drop duplicate SMS
  // Money that came back (refund / reversal). Still type 'income' so totals behave as before;
  // not stored in the database yet.
  refund: boolean;
};

const BANKS: Record<string, string> = {
  HDFCBK: 'HDFC', HDFCBN: 'HDFC',
  SBIUPI: 'SBI', SBIINB: 'SBI', SBIPSG: 'SBI', ATMSBI: 'SBI', CBSSBI: 'SBI', SBICRD: 'SBI Card',
  ICICIB: 'ICICI', ICICIT: 'ICICI',
  AXISBK: 'Axis', AXISMR: 'Axis',
  KOTAKB: 'Kotak', KOTAK: 'Kotak',
  PNBSMS: 'PNB', BOIIND: 'Bank of India', BOBTXN: 'Bank of Baroda', BOBSMS: 'Bank of Baroda',
  IOBCHN: 'IOB', IOBBNK: 'IOB', CANBNK: 'Canara', INDBNK: 'Indian Bank', UNIONB: 'Union Bank',
  YESBNK: 'Yes Bank', IDFCFB: 'IDFC First', PAYTMB: 'Paytm Bank', FEDBNK: 'Federal',
  KVBANK: 'KVB', CUBANK: 'City Union', TMBANK: 'TMB', TMBLTD: 'TMB', INDUSB: 'IndusInd',
  AUBANK: 'AU Bank', JUPITR: 'Jupiter', FIMONY: 'Fi', SLCEIT: 'Slice',
};

// Messages that mention money but aren't a finished transaction.
const SKIP = [
  /\botp\b/i,
  /one[\s-]?time password/i,
  /\bwill be (debited|deducted|charged)/i,
  /\b(is|are) due\b|\bdue (date|on|by)\b|\bminimum amount due\b/i,
  /\brequested\b|\bcollect request\b|\bpayment request\b/i,
  /\b(failed|declined|unsuccessful)\b/i,
  /\bpre-?approved\b|\bloan offer\b|\bcashback (of )?up ?to\b|\bwin\b/i,
  /\bavailable (bal|balance|limit) is\b(?![\s\S]*\b(debited|credited|spent|sent)\b)/i,
];

const DEBIT_WORDS = /\b(debited|spent|sent|paid|withdrawn|deducted|purchase|txn of)\b/i;
const CREDIT_WORDS = /\b(credited|received|deposited|refund(ed)?|reversed)\b/i;
const REFUND_WORDS = /\b(refund(ed)?|reversed|reversal)\b/i;
const MONEYISH = /a\/c|acct|account|\bcard\b|upi|vpa|bank|imps|neft/i;

// Security / promo footer lines ("Never share your OTP", "If not requested by you, call 1800…",
// "win rewards"). They are dropped before the skip rules run, so they can't reject a real transaction.
const FOOTER_MARKERS = [
  /\b(never|do not|don'?t)\s+share\b/i,
  /\bnot\s+(you|u)\b/i,
  /\bif\s+not\s+(done|requested|initiated|made|authori[sz]ed|performed)\b/i,
  /\b(call|sms|whatsapp|report)\b[^\n]*\d{5,}/i,
  /\b(win|rewards?|offers?)\b/i,
  /https?:\/\/|www\./i,
];
// A line that clearly reports a completed transaction is never treated as a footer.
const EVENT_WORDS = /\b(debited|credited|spent|withdrawn|deposited)\b/i;

function splitLines(body: string): string[] {
  return body
    .replace(/([.!?])\s+/g, '$1\n')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The message without its footer lines. Skip rules, type and amount are read from this. */
function coreText(body: string): string {
  return splitLines(body)
    .filter((line) => !(FOOTER_MARKERS.some((r) => r.test(line)) && !EVENT_WORDS.test(line)))
    .join('\n');
}

// Future credits ("will be reversed in 48 hrs") are not a completed refund.
const PENDING_CREDIT = /\bwill be (credited|reversed|refunded)\b[^\n]*/gi;

function bankFrom(address: string): string {
  // Sender IDs look like "AX-HDFCBK-S" or "VM-SBIUPI".
  const parts = address.toUpperCase().split('-');
  const code = parts.length > 1 ? parts[1] : parts[0];
  return BANKS[code] ?? BANKS[code.slice(0, 6)] ?? code;
}

const CURRENCY_AMOUNT = /(?:\brs\.?|\binr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)/gi;
// Text right before an amount that marks it as a balance or limit, not the transaction.
const INFO_BEFORE =
  /(?:\b(?:avl|avbl|available|a\/c|acct)\.?\s*)?(?:\bbal|balance|limit|\blmt)\.?(?:\s+(?:is|of|was))?[\s:.\-]*$/i;
const BARE_AMOUNT =
  /\b(?:debited|credited|sent|spent|withdrawn|reversed|refunded)\s+(?:by|for|with|of)?\s*(\d[\d,]*(?:\.\d{1,2})?)/i;

function toAmount(raw: string): number | null {
  const n = parseFloat(raw.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** First ₹/Rs/INR amount that isn't a balance or limit; else a bare number after "debited by" etc. */
function parseAmount(text: string): number | null {
  for (const m of text.matchAll(CURRENCY_AMOUNT)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 25), m.index);
    if (INFO_BEFORE.test(before)) continue;
    const n = toAmount(m[1]);
    if (n) return n;
  }
  const bare = text.match(BARE_AMOUNT);
  return bare ? toAmount(bare[1]) : null;
}

function detectType(body: string): TxnType | null {
  const d = body.search(DEBIT_WORDS);
  const c = body.search(CREDIT_WORDS);
  if (d === -1 && c === -1) return null;
  if (d === -1) return 'income';
  if (c === -1) return 'expense';
  // Both appear (e.g. "A/c debited ... AMAZON credited"): the first one is about your account.
  return d < c ? 'expense' : 'income';
}

const clean = (s: string) =>
  s.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim().slice(0, 40);

function parseParty(body: string, type: TxnType, refund: boolean): string {
  const patterns: RegExp[] =
    type === 'expense'
      ? [
          /\bto\s+VPA\s+([\w.\-]+@[\w]+)/i,
          /\btrf to\s+([A-Za-z0-9 .&'*-]+?)(?=\s+Ref|\s+on\b|\.|$)/i,
          /\bat\s+([A-Za-z0-9 .&'*-]+?)\s+on\b/i,
          /;\s*([A-Za-z0-9 .&'*-]+?)\s+credited/i,
          /(?:^|\n)\s*To\s+([^\n]+)/i,
          /\bto\s+([\w.\-]+@[\w]+)/i,
          /UPI\/P2[AM]\/\d+\/([^\s/\n]+)/i,
          /\bto\s+([A-Za-z][A-Za-z0-9 .&'*-]{2,}?)(?=\s+on\b|\s+Ref|\.|$)/i,
        ]
      : [
          /\bfrom\s+VPA\s+([\w.\-]+@[\w]+)/i,
          /\bby\s+VPA\s+([\w.\-]+@[\w]+)/i,
          /(?:^|\n)\s*From\s+(?!.*\bA\/?c\b)([^\n]+)/i,
          /\bfrom\s+([\w.\-]+@[\w]+)/i,
          /UPI\/P2[AM]\/\d+\/([^\s/\n]+)/i,
          /\bfrom\s+(?!a\/c|ac\b|acct|your)([A-Za-z][A-Za-z0-9 .&'*-]{2,}?)(?=\s*\(|\s+on\b|\s+Ref|\.|$)/i,
          /\bby\s+(?!a\/c|ac\b|acct|your)([A-Za-z][A-Za-z0-9 .&'*-]{2,}?)(?=\s*\(|\s+on\b|\s+Ref|\.|$)/i,
        ];
  for (const p of patterns) {
    const m = body.match(p);
    if (m?.[1]) {
      const v = clean(m[1]);
      if (v && !/^(?:(?:a\/?c|your|ur|upi)\b|rs\.?\s*\d|inr\b|₹|\d)/i.test(v)) return v;
    }
  }
  if (refund) return 'Refund / reversal';
  return type === 'expense' ? 'Payment' : 'Money received';
}

function parseRef(body: string): string | null {
  const m =
    body.match(/UPI\/P2[AM]\/(\d{9,14})/i) ??
    body.match(
      /(?:ref(?:erence)?\.?\s*(?:no|id)?|refno|upi\s*(?:ref|txn)(?:\s*(?:no|id))?|rrn|upi)[\s:.#-]*(\d{9,14})/i,
    );
  return m?.[1] ?? null;
}

function parseAccount(body: string): string | null {
  const m = body.match(/(?:a\/?c|acct|account|card)\s*(?:no\.?|number)?\s*[:.]?\s*[x*]+\s*(\d{3,6})/i);
  return m?.[1] ?? null;
}

export function parseSms(address: string | null, body: string | null): ParsedTxn | null {
  if (!address || !body) return null;
  // Personal numbers (+91..., 10 digits) are not banks.
  if (/^\+?\d[\d\s]{6,}$/.test(address.trim())) return null;
  if (!MONEYISH.test(body)) return null;

  const core = coreText(body);
  if (SKIP.some((r) => r.test(core))) return null;

  const settled = core.replace(PENDING_CREDIT, '');
  // A completed refund/reversal is money coming back, even if the SMS also says "debited".
  const refund = REFUND_WORDS.test(settled);
  const type = refund ? 'income' : detectType(settled);
  if (!type) return null;
  const amount = parseAmount(settled);
  if (!amount) return null;

  return {
    type,
    amount,
    party: parseParty(body, type, refund),
    bank: bankFrom(address),
    account: parseAccount(body),
    ref: parseRef(body),
    refund,
  };
}
