import { describe, expect, it } from 'vitest'
import { account, category, txn } from '../../budget/__tests__/helpers'
import { parseQuery, searchTransactions, topPayees, type SearchOptions } from '../search'
import type { Payee } from '../../types'

const checking = account('Checking')
const visa = account('Visa', 'creditCard')
const groceries = category('Groceries')
const fuel = category('Gas')
const payees: Payee[] = [
  { id: 'kroger', name: 'Kroger', deleted: false },
  { id: 'shell', name: 'Shell', deleted: false },
  { id: '711', name: '7-Eleven', deleted: false },
]
const transactions = [
  txn(checking.id, '2026-10-02', -5_234, { payeeId: 'kroger', categoryId: groceries.id }),
  txn(visa.id, '2026-09-20', -12_050, { payeeId: 'kroger', categoryId: groceries.id, memo: 'birthday cake' }),
  txn(visa.id, '2025-12-30', -4_000, { payeeId: 'shell', categoryId: fuel.id }),
  txn(checking.id, '2026-10-05', -1_299, { payeeId: '711', categoryId: fuel.id }),
  txn(checking.id, '2026-10-06', 250_000, { memo: 'Paycheck' }),
  txn(checking.id, '2026-10-07', -999, {
    memo: 'split',
    subtransactions: [{ id: 's1', amount: -999, categoryId: groceries.id, memo: 'snacks' }],
  }),
]
const lookups = { accounts: [checking, visa], categories: [groceries, fuel], payees }
const base: SearchOptions = { query: '', range: 'all', kind: 'all', accountId: null, today: '2026-10-11' }
const find = (over: Partial<SearchOptions>) => searchTransactions(transactions, { ...base, ...over }, lookups)

describe('searchTransactions', () => {
  it('matches payee, category, account and memo, every word', () => {
    expect(find({ query: 'kroger' }).matches).toHaveLength(2)
    expect(find({ query: 'kroger visa' }).matches).toHaveLength(1)
    expect(find({ query: 'cake' }).matches).toHaveLength(1)
    expect(find({ query: 'snacks' }).matches).toHaveLength(1)
    expect(find({ query: 'groceries' }).matches).toHaveLength(3)
  })

  it('understands amounts', () => {
    expect(find({ query: '52.34' }).matches).toHaveLength(1)
    expect(find({ query: 'kroger >100' }).matches.map((t) => t.amount)).toEqual([-12_050])
    expect(find({ query: '<$15' }).matches).toHaveLength(2)
    expect(find({ query: '>=40' }).matches).toHaveLength(4)
  })

  it('treats a bare number as a word or an amount', () => {
    expect(find({ query: '7' }).matches.map((t) => t.payeeId)).toContain('711')
    expect(find({ query: '40' }).matches.map((t) => t.payeeId)).toEqual(['shell'])
  })

  it('filters by range, account and direction, newest first, with totals', () => {
    const r = find({ range: 'month', kind: 'spending' })
    expect(r.matches.map((t) => t.date)).toEqual(['2026-10-07', '2026-10-05', '2026-10-02'])
    expect(r.spent).toBe(999 + 1_299 + 5_234)
    expect(find({ range: 'lastYear' }).matches).toHaveLength(1)
    expect(find({ accountId: visa.id }).matches).toHaveLength(2)
    expect(find({ kind: 'income' }).received).toBe(250_000)
  })
})

describe('parseQuery', () => {
  it('separates words from amounts', () => {
    expect(parseQuery('Kroger $1,200.5')).toEqual({ words: ['kroger'], amounts: [{ op: '=', cents: 120_050 }], bareNumbers: [] })
  })
})

describe('topPayees', () => {
  it('ranks the payees used most', () => {
    expect(topPayees(transactions, payees, 2)).toEqual(['Kroger', 'Shell'])
  })
})
