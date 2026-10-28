// Realistic bank SMS used for demo mode (no SMS permission / emulator) and parser tests.
// `expect` is what the parser should produce (null = should be skipped).

export type SampleSms = {
  address: string;
  body: string;
  expect: { type: 'income' | 'expense'; amount: number; party?: string; refund?: boolean } | null;
  name?: string; // shown in test output
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

// Parser regression cases (test-only, not used for demo data). All numbers and names are made up.
export const REGRESSION_SMS: SampleSms[] = [
  {
    name: 'debit + "Never share your OTP" footer',
    address: 'VM-SBIUPI',
    body: 'Dear UPI user A/C X1111 debited by 200.0 on date 01Oct26 trf to TEA STALL Refno 612345678901. Never share your OTP with anyone. -SBI',
    expect: { type: 'expense', amount: 200, party: 'TEA STALL', refund: false },
  },
  {
    name: 'debit + "If not requested by you" footer',
    address: 'AX-HDFCBK-S',
    body: 'Rs.300.00 debited from A/c XX1111 to VPA shop@okhdfc on 01-10-26. UPI Ref 612345678902. If not requested by you, call 18002586161',
    expect: { type: 'expense', amount: 300, party: 'shop@okhdfc', refund: false },
  },
  {
    name: 'debit + "win rewards" footer',
    address: 'AD-AXISBK-S',
    body: 'INR 120.00 debited\nA/c no. XX1111\n01-10-26, 10:11:12\nUPI/P2M/612345678903/CAFE\nPay bills & win rewards on the Axis app',
    expect: { type: 'expense', amount: 120, party: 'CAFE', refund: false },
  },
  {
    name: 'available balance before the debit amount',
    address: 'JD-ICICIB-S',
    body: 'Avl Bal INR 5,000.00. INR 200.00 debited from Acct XX111 on 01-Oct-26 UPI:612345678904',
    expect: { type: 'expense', amount: 200 },
  },
  {
    name: 'balance after the amount (ATM)',
    address: 'VM-SBIINB',
    body: 'Rs.2,000 withdrawn at ATM from A/c X1111 on 01Oct26. Avl Bal Rs.8,000.00',
    expect: { type: 'expense', amount: 2000 },
  },
  {
    name: 'bare amount, only the balance has a currency sign',
    address: 'VM-SBIUPI',
    body: 'Dear UPI user A/C X1111 debited by 150.0 on date 01Oct26 trf to BAKERY Refno 612345678905. Avl bal Rs 4,850.00 -SBI',
    expect: { type: 'expense', amount: 150, party: 'BAKERY' },
  },
  {
    name: 'credit with available limit mentioned first',
    address: 'AX-HDFCBK',
    body: 'Avl Lmt: Rs 49,000. Rs.1,000.00 credited to HDFC Bank Card XX9999 on 01-10-26 towards payment received',
    expect: { type: 'income', amount: 1000, refund: false },
  },
  {
    name: 'OTP-only message is rejected',
    address: 'AX-HDFCBK-T',
    body: '482913 is your OTP to log in to HDFC Bank NetBanking. Valid for 5 mins. Never share it with anyone.',
    expect: null,
  },
  {
    name: 'promotion without a transaction is rejected',
    address: 'VM-HDFCBK',
    body: 'Pay with HDFC Bank UPI and win rewards up to Rs.500 on every payment! T&C apply.',
    expect: null,
  },
  {
    name: 'declined payment with OTP footer is rejected',
    address: 'VM-ICICIB',
    body: 'Your UPI payment of INR 650.00 to SHOP B from Acct XX111 was declined due to insufficient balance. Never share your OTP.',
    expect: null,
  },
  {
    name: 'failed payment "will be reversed" is rejected (never charged)',
    address: 'VM-KOTAKB',
    body: 'UPI txn of Rs 340.00 from Kotak Bank AC X1111 failed. Amount, if debited, will be reversed within 48 hrs.',
    expect: null,
  },
  {
    name: 'completed reversal is a refund',
    address: 'AD-AXISBK-S',
    body: 'INR 450.00 reversed to your A/c XX1111 on 01-10-26 for UPI txn 612345678906',
    expect: { type: 'income', amount: 450, refund: true, party: 'Refund / reversal' },
  },
  {
    name: 'refund credited from a merchant',
    address: 'AX-HDFCBK-S',
    body: 'Refund of Rs.799.00 credited to your HDFC Bank A/c XX1111 from AMAZON on 02-10-26. Ref 612345678907',
    expect: { type: 'income', amount: 799, refund: true, party: 'AMAZON' },
  },
  {
    name: 'debit that was later reversed counts as a refund',
    address: 'VM-SBIUPI',
    body: 'Rs 999.00 debited from A/C X1111 on 28Sep26 has been reversed to your account on 01Oct26. Ref 612345678908 -SBI',
    expect: { type: 'income', amount: 999, refund: true },
  },
  {
    name: 'salary credit is not a refund',
    address: 'VM-HDFCBK',
    body: 'Update! INR 30,000.00 deposited in HDFC Bank A/c XX1111 on 01-OCT-26 for NEFT Cr-ACME LTD.',
    expect: { type: 'income', amount: 30000, refund: false },
  },
  {
    name: 'Indian format: INR 1,05,000',
    address: 'VM-KOTAKB',
    body: 'INR 1,05,000 credited to Kotak Bank AC X1111 from A KUMAR on 01-10-26 UPI Ref 612345678909',
    expect: { type: 'income', amount: 105000, party: 'A KUMAR', refund: false },
  },
  {
    name: 'Indian format with ₹ and paise: ₹1,05,000.50',
    address: 'AX-HDFCBK-S',
    body: '₹1,05,000.50 debited from A/c XX1111 to VPA landlord@okicici on 01-10-26. UPI Ref 612345678910. Not you? Call 18002586161',
    expect: { type: 'expense', amount: 105000.5, party: 'landlord@okicici' },
  },

  // Refund wording: only a completed refund counts; a bare "refund"/"reversal" never flips a debit.
  {
    name: 'R1 salary + "for reversal queries contact branch"',
    address: 'VM-HDFCBK',
    body: 'INR 30,000.00 credited to HDFC Bank A/c XX1111 on 01-10-26 by NEFT from ACME LTD, for reversal queries contact your branch.',
    expect: { type: 'income', amount: 30000, refund: false },
  },
  {
    name: 'R2 debit + "raise a reversal request" stays expense',
    address: 'AX-HDFCBK',
    body: 'Rs.500.00 debited from A/c XX1111 to VPA shop@okaxis on 01-10-26, if not done by you raise a reversal request at your branch',
    expect: { type: 'expense', amount: 500, refund: false },
  },
  {
    name: 'R3 refund initiated (5-7 days) is not recorded',
    address: 'AX-HDFCBK',
    body: 'Refund of Rs.799.00 has been initiated to your HDFC Bank Card XX1111 by AMAZON. It will reflect in 5-7 working days.',
    expect: null,
  },
  {
    name: 'R4 refund being processed, will be credited: not recorded',
    address: 'JD-ICICIB',
    body: 'Your refund of INR 1,250.00 for order 4471 is being processed and will be credited to ICICI Bank Acct XX111 in 3 days.',
    expect: null,
  },
  {
    name: 'R5 "Reversal will be done in 48 hrs" is not a refund',
    address: 'VM-SBIUPI',
    body: 'Txn of Rs 340 on A/C X1111 could not be completed. Reversal will be done within 48 hrs. -SBI',
    expect: { type: 'expense', amount: 340, refund: false },
  },
  {
    name: 'R6 could not be completed, amount has been reversed',
    address: 'VM-SBIUPI',
    body: 'Txn of Rs 340 from A/C X1111 could not be completed. Amount debited has been reversed to your account. -SBI',
    expect: { type: 'income', amount: 340, refund: true },
  },
  {
    name: 'R7 declined + "Amount reversed" is rejected',
    address: 'VM-ICICIB',
    body: 'Your payment of INR 650.00 from Acct XX111 was declined. Amount reversed to account.',
    expect: null,
  },
  {
    name: 'R8 debit + footer "Not you? Request reversal" stays expense',
    address: 'AX-HDFCBK-S',
    body: 'Rs.500.00 debited from A/c XX1111 to VPA shop@okaxis on 01-10-26. UPI Ref 612345678920. Not you? Request reversal: https://hdfc.bank/x',
    expect: { type: 'expense', amount: 500, party: 'shop@okaxis', refund: false },
  },
  {
    name: 'R9 refund has been credited to the account',
    address: 'JD-ICICIB-S',
    body: 'Refund of INR 1,250.00 has been credited to your ICICI Bank Acct XX111 on 03-10-26 from FLIPKART. Ref 612345678923',
    expect: { type: 'income', amount: 1250, refund: true, party: 'FLIPKART' },
  },
  {
    name: 'R10 cashback credited is ordinary income',
    address: 'AX-HDFCBK-S',
    body: 'Cashback of Rs.50.00 credited to your HDFC Bank A/c XX1111 on 01-10-26 for UPI txn 612345678922',
    expect: { type: 'income', amount: 50, refund: false },
  },
];
