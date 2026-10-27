// Realistic bank SMS used for demo mode (no SMS permission / emulator) and parser tests.
// `expect` is what the parser should produce (null = should be skipped).

export type SampleSms = {
  address: string;
  body: string;
  expect: { type: 'income' | 'expense'; amount: number; party?: string } | null;
};

export const SAMPLE_SMS: SampleSms[] = [
  {
    address: 'AX-HDFCBK-S',
    body: 'Sent Rs.250.00\nFrom HDFC Bank A/C *4521\nTo SWIGGY\nOn 26/10/26\nRef 630112345678\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808',
    expect: { type: 'expense', amount: 250, party: 'SWIGGY' },
  },
  {
    address: 'VM-SBIUPI',
    body: 'Dear UPI user A/C X7788 debited by 150.0 on date 26Oct26 trf to ZOMATO LTD Refno 630298765432. If not u? call 1800111109. -SBI',
    expect: { type: 'expense', amount: 150, party: 'ZOMATO LTD' },
  },
  {
    address: 'JD-ICICIB-S',
    body: 'ICICI Bank Acct XX123 debited for Rs 1,299.00 on 25-Oct-26; AMAZON PAY credited. UPI:630011223344. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766.',
    expect: { type: 'expense', amount: 1299, party: 'AMAZON PAY' },
  },
  {
    address: 'AD-AXISBK-S',
    body: 'INR 60.00 debited\nA/c no. XX9087\n25-10-26, 18:42:10\nUPI/P2M/630155667788/RAPIDO\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank',
    expect: { type: 'expense', amount: 60, party: 'RAPIDO' },
  },
  {
    address: 'BZ-KOTAKB',
    body: 'Sent Rs.500.00 from Kotak Bank AC X3344 to ravi.kumar@okaxis on 24-10-26.UPI Ref 630144556677. Not you, https://kotak.com/KBANKT/Fraud',
    expect: { type: 'expense', amount: 500, party: 'ravi.kumar@okaxis' },
  },
  {
    address: 'AX-HDFCBK-T',
    body: 'Credit Alert!\nRs.25000.00 credited to HDFC Bank A/c XX4521 on 01-10-26 from VPA acme.payroll@hdfcbank (UPI 627412345678)',
    expect: { type: 'income', amount: 25000, party: 'acme.payroll@hdfcbank' },
  },
  {
    address: 'VK-SBIUPI',
    body: 'Dear SBI UPI User, ur A/cX7788 credited by Rs2000 on 23Oct26 by (Ref no 629987654321)',
    expect: { type: 'income', amount: 2000 },
  },
  {
    address: 'VM-IOBCHN',
    body: 'Your a/c no. XXXXX6612 is debited for Rs.89.00 on 23-10-2026 and credited to a/c no. XXXXX0001 (UPI Ref no 629911112222) -IOB',
    expect: { type: 'expense', amount: 89 },
  },
  {
    address: 'AD-TMBANK',
    body: 'Rs.1500.00 credited to your A/c XX2201 on 22-10-2026 by UPI from SURESH M. UPI Ref 629855554444 - TMB',
    expect: { type: 'income', amount: 1500, party: 'SURESH M' },
  },
  {
    address: 'AX-HDFCBK',
    body: 'Rs.799 spent on HDFC Bank Card x9921 at NETFLIX on 2026-10-21:09:12:44. Not You? To Block+Reissue Call 18002586161',
    expect: { type: 'expense', amount: 799, party: 'NETFLIX' },
  },
  // Should be skipped
  {
    address: 'AX-HDFCBK',
    body: '123456 is OTP for txn of INR 999.00 at FLIPKART on HDFC Bank card ending 9921. Valid till 10:22. Do not share OTP for security reasons.',
    expect: null,
  },
  {
    address: 'VM-ICICIB',
    body: 'Your ICICI Bank Credit Card XX123 statement: Total Amount due Rs 4,500.00. Minimum amount due Rs 225. Due date 05-Nov-26.',
    expect: null,
  },
  {
    address: 'JM-PAYTMB',
    body: 'ravi@paytm has requested Rs.300 from you on Paytm UPI. Approve or decline in the app.',
    expect: null,
  },
  {
    address: 'AD-AXISBK',
    body: 'UPI transaction of INR 450.00 from A/c XX9087 failed. Amount if debited will be reversed in 48 hrs.',
    expect: null,
  },
  {
    address: '+919876543210',
    body: 'Bro I sent Rs 200 to your account for the movie ticket',
    expect: null,
  },
];
