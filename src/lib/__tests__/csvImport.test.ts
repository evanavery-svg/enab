import { describe, expect, it } from 'vitest'
import { analyzeCsv, decodeCsvBytes, findDuplicates, readAmount, readDate, readRows, type ImportRow } from '../csvImport'
import { EXPECTED } from './bank-csv/expected'
import type { Transaction } from '../../types'

// Loaded through Vite rather than node:fs, so the app's own typecheck (which
// has no Node types) covers this file too.
const files = import.meta.glob('./bank-csv/*.csv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const load = (file: string) => files[`./bank-csv/${file}`]
const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...new TextEncoder().encode(p)] : p))).buffer

describe('real bank exports import with no adjustment', () => {
  it('has a fixture for every expectation', () => {
    expect(Object.keys(EXPECTED).every((f) => load(f))).toBe(true)
  })
  for (const [file, want] of Object.entries(EXPECTED)) {
    it(file, () => {
      const analysis = analyzeCsv(load(file))
      const { rows } = readRows(analysis.body, analysis)
      expect(rows.map((r) => [r.date, r.amount, r.payee])).toEqual(want)
    })
  }
})

describe('readDate', () => {
  it.each([
    ['2026-10-02', '2026-10-02'],
    ['2026-10-02T14:00:00Z', '2026-10-02'],
    ['20261002', '2026-10-02'],
    ['10/02/2026', '2026-10-02'],
    ['10/02/26', '2026-10-02'],
    ['30/09/2026', '2026-09-30'],
    ['Oct 2, 2026', '2026-10-02'],
    ['October 2nd 2026', '2026-10-02'],
    ['02-Oct-2026', '2026-10-02'],
    ['Fri, 02 Oct 2026', '2026-10-02'],
    ['10/02/2026 08:15', '2026-10-02'],
  ])('%s', (raw, want) => expect(readDate(raw, false)).toBe(want))

  it('reads the ambiguous form in the order it is told', () => {
    expect(readDate('02/10/2026', true)).toBe('2026-10-02')
    expect(readDate('02/10/2026', false)).toBe('2026-02-10')
  })

  it.each(['5.75', '12', '1234', 'Total', '31/02/2026', ''])('rejects %j', (raw) => expect(readDate(raw, false)).toBeNull())
})

describe('readAmount', () => {
  it.each([
    ['-5.75', false, -575],
    ['$2,400.00', false, 240000],
    ['-$5.75', false, -575],
    ['$-5.75', false, -575],
    ['(5.75)', false, -575],
    ['($5.75)', false, -575],
    ['5.75-', false, -575],
    ['15.00 CR', false, 1500],
    ['40.00 DR', false, -4000],
    ['USD 5.75', false, 575],
    ['-5.7500', false, -575],
    ['2.400,00', true, 240000],
    ['-23,45', true, -2345],
    ['1 234,56', true, 123456],
    ['+12.00', false, 1200],
  ])('%s', (raw, comma, cents) => expect(readAmount(raw, comma)?.cents).toBe(cents))

  it.each(['', 'abc', '--', 'N/A'])('rejects %j', (raw) => expect(readAmount(raw, false)).toBeNull())
})

describe('the file around the transactions', () => {
  it('decodes a Windows-1252 export rather than mangling accents', () => {
    const analysis = analyzeCsv(decodeCsvBytes(bytes('Date,Payee,Amount\n2026-10-02,Caf', [0xe9], ',-5.75\n')))
    expect(readRows(analysis.body, analysis).rows[0].payee).toBe('Café')
  })

  it('reads a UTF-8 file with a byte-order mark', () => {
    const analysis = analyzeCsv(decodeCsvBytes(bytes([0xef, 0xbb, 0xbf], 'Date,Payee,Amount\n2026-10-02,Café,-5.75\n')))
    expect(analysis.labels[0]).toBe('Date')
    expect(readRows(analysis.body, analysis).rows[0].payee).toBe('Café')
  })

  it('keeps a quote inside an unquoted field as part of the text', () => {
    const analysis = analyzeCsv('Date,Payee,Amount\n2026-10-02,12" Sub Shop,-9.50\n2026-10-03,Grocer,-20.00\n')
    expect(readRows(analysis.body, analysis).rows.map((r) => r.payee)).toEqual(['12" Sub Shop', 'Grocer'])
  })

  it('says when the date order could not be worked out, so the screen can ask', () => {
    const analysis = analyzeCsv('Date,Payee,Amount\n01/02/2026,A,-1.00\n03/04/2026,B,-2.00\n')
    expect(analysis.dateOrderKnown).toBe(false)
    expect(analyzeCsv('Date,Payee,Amount\n01/02/2026,A,-1.00\n03/04/2026,B,-2.00\n', { preferDayFirst: true }).dayFirst).toBe(true)
  })
})

describe('findDuplicates', () => {
  const txn = (date: string, amount: number): Transaction =>
    ({ id: date + amount, accountId: 'a', date, month: date.slice(0, 7), amount, payeeId: null, categoryId: null, memo: '',
      cleared: 'cleared', approved: true, flag: null, createdAt: '', deleted: false }) as Transaction
  const row = (date: string, amount: number): ImportRow => ({ date, amount, payee: '', memo: '', category: '' })

  it('spots a transaction typed in by hand a couple of days before it posted', () => {
    expect(findDuplicates([row('2026-10-03', -575)], [txn('2026-10-01', -575)])).toEqual([true])
  })

  it('does not match beyond three days or on a different amount', () => {
    expect(findDuplicates([row('2026-10-06', -575), row('2026-10-01', -576)], [txn('2026-10-01', -575)])).toEqual([false, false])
  })

  it('lets each existing transaction cover only one row, so two real coffees stay two', () => {
    expect(findDuplicates([row('2026-10-02', -575), row('2026-10-02', -575)], [txn('2026-10-02', -575)])).toEqual([true, false])
  })

  it('treats a whole re-imported file as already there', () => {
    const rows = [row('2026-10-02', -575), row('2026-10-02', -575), row('2026-10-01', 240000)]
    const existing = rows.map((r) => txn(r.date, r.amount))
    expect(findDuplicates(rows, existing)).toEqual([true, true, true])
  })

  it('ignores deleted transactions and the opening balance', () => {
    const gone = { ...txn('2026-10-02', -575), deleted: true }
    const opening = { ...txn('2026-10-02', 240000), isStartingBalance: true }
    expect(findDuplicates([row('2026-10-02', -575), row('2026-10-02', 240000)], [gone, opening])).toEqual([false, false])
  })
})

describe('which sign is spending, in short files', () => {
  it('reads a checking file with more paychecks than purchases the right way round', () => {
    const csv = [
      'Date,Description,Amount',
      '2026-10-03,SQ *BLUE BOTTLE 0423,-6.50',
      '2026-10-04,KROGER #432,-84.10',
      '2026-10-01,ACME CORP PAYROLL PPD ID 1234,2650.00',
      '2026-09-15,ACME CORP PAYROLL PPD ID 1234,2650.00',
      '2026-09-01,ACME CORP PAYROLL PPD ID 1234,2650.00',
      '2026-08-15,ACME CORP PAYROLL PPD ID 1234,2650.00',
    ].join('\n')
    expect(analyzeCsv(csv).spendingPositive).toBe(false)
  })

  it('reads a card file whose only negative row is the payment', () => {
    const csv = ['Date,Description,Amount', '2026-10-03,WHOLE FOODS,84.12', '2026-10-08,AUTOPAY PAYMENT - THANK YOU,-200.00'].join('\n')
    expect(analyzeCsv(csv).spendingPositive).toBe(true)
  })
})
