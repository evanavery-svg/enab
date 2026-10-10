/**
 * What each export in this folder must import as. Amounts are cents with
 * spending negative, whatever convention the bank's file used. Every file is
 * fake data in that bank's real column layout and quirks.
 */
export type Expected = [date: string, cents: number, payee: string][]

const card = (payees: [string, string, string]): Expected => [
  ['2026-10-02', -575, payees[0]],
  ['2026-09-28', 50000, payees[1]],
  ['2026-09-27', -8412, payees[2]],
]

export const EXPECTED: Record<string, Expected> = {
  'chase-checking.csv': [
    ['2026-10-03', -575, 'STARBUCKS STORE 12345 SEATTLE WA 10/02'],
    ['2026-10-01', 240000, 'ACME CORP PAYROLL PPD ID: 1234567890'],
    ['2026-09-30', -6000, 'Zelle payment to Jane Doe 12345'],
  ],
  'chase-credit.csv': card(['STARBUCKS STORE 12345', 'Payment Thank You-Mobile', 'WHOLEFDS MKT 10234']),
  'bofa-checking.csv': [
    ['2026-10-01', 240000, 'ACME CORP DES:PAYROLL ID:XXXXX INDN:DOE,JOHN CO ID:XXXXX PPD'],
    ['2026-10-02', -575, 'STARBUCKS 12345 10/02 PURCHASE SEATTLE WA'],
    ['2026-10-03', -6000, 'Zelle payment to JANE DOE Conf# abc123'],
  ],
  'wells-fargo.csv': [
    ['2026-10-03', -575, 'PURCHASE AUTHORIZED ON 10/02 STARBUCKS SEATTLE WA S000000000 CARD 1234'],
    ['2026-10-01', 240000, 'ACME CORP PAYROLL 100126 XXXXX1234 DOE JOHN'],
    ['2026-09-30', -6000, 'CHECK # 1042'],
  ],
  'amex.csv': card(['STARBUCKS', 'AUTOPAY PAYMENT - THANK YOU', 'WHOLE FOODS']),
  'capital-one.csv': card(['STARBUCKS', 'CAPITAL ONE MOBILE PYMT', 'WHOLE FOODS']),
  'discover.csv': card(['STARBUCKS', 'INTERNET PAYMENT - THANK YOU', 'WHOLE FOODS']),
  'apple-card.csv': card(['Starbucks', 'Payment', 'Whole Foods']),
  'citi.csv': card(['STARBUCKS', 'ONLINE PAYMENT THANK YOU', 'WHOLE FOODS']),
  'ally.csv': [
    ['2026-10-03', -575, 'STARBUCKS'],
    ['2026-10-01', 240000, 'ACME CORP PAYROLL'],
    ['2026-09-30', -6000, 'Zelle Jane Doe'],
  ],
  'us-bank.csv': [
    ['2026-10-03', -575, 'STARBUCKS'],
    ['2026-10-01', 240000, 'ACME CORP PAYROLL'],
    ['2026-09-30', -6000, 'ZELLE JANE DOE'],
  ],
  'mint.csv': [
    ['2026-10-02', -575, 'Starbucks'],
    ['2026-10-01', 240000, 'Acme Corp'],
    ['2026-09-30', -6000, 'Jane Doe'],
  ],
  'ynab.csv': [
    ['2026-10-02', -575, 'Starbucks'],
    ['2026-10-01', 240000, 'Acme Corp'],
    ['2026-09-30', -6000, 'Jane Doe'],
  ],
  'monzo-uk.csv': [
    ['2026-10-02', -450, 'Pret A Manger'],
    ['2026-10-01', 200000, 'Acme Ltd'],
    ['2026-09-30', -2310, 'Tesco'],
  ],
  'german-semicolon.csv': [
    ['2026-10-02', -2345, 'REWE Markt GmbH'],
    ['2026-10-01', 240000, 'ACME GmbH'],
    ['2026-09-30', -85000, 'Hausverwaltung'],
  ],
  'messy-amounts.csv': [
    ['2026-10-02', -575, 'Coffee'],
    ['2026-10-01', 240000, 'Payroll'],
    ['2026-09-30', -120000, 'Rent'],
    ['2026-09-29', 1500, 'Refund'],
    ['2026-09-28', -4000, 'Gym'],
  ],
}
