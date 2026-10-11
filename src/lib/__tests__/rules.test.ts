import { describe, expect, it } from 'vitest'
import { account, category, txn } from '../../budget/__tests__/helpers'
import { applyRules, cleanPayeeName, findRule, ruleMatches, suggestRules } from '../rules'
import type { Payee, PayeeRule } from '../../types'

const rule = (over: Partial<PayeeRule>): PayeeRule => ({
  id: over.match ?? 'r', match: '', matchType: 'contains', renameTo: '', categoryId: null,
  createdAt: '2026-01-01T00:00:00Z', deleted: false, ...over,
})

describe('cleanPayeeName', () => {
  it.each([
    ['SQ *BLUE BOTTLE 0423', 'Blue Bottle'],
    ['TST* SWEETGREEN NOMAD', 'Sweetgreen Nomad'],
    ['AMAZON.COM*2K4AB1 AMZN.COM/BILL WA', 'Amazon'],
    ['AMZN Mktp US*2K4AB1', 'AMZN Mktp US'],
    ['STARBUCKS STORE 12345 SEATTLE WA', 'Starbucks'],
    ['THE HOME DEPOT #1234 AUSTIN TX', 'The Home Depot'],
    ['PAYPAL *SPOTIFY 4029357733 CA', 'Spotify'],
    ['UBER *TRIP HELP.UBER.COM', 'Uber'],
    ['POS PURCHASE 10/03 KROGER #432', 'Kroger'],
    ['APPLE.COM/BILL 866-712-7753 CA', 'Apple'],
    ['SHELL OIL 57444123 HOUSTON TX', 'Shell Oil'],
    ['7-ELEVEN 34521', '7-Eleven'],
    ["Trader Joe's", "Trader Joe's"],
    ['PIER 39 PARKING', 'Pier 39 Parking'],
    ['BANK OF AMERICA', 'Bank of America'],
    ['TRADER JOE S #552 QPS', "Trader Joe's"],
    ['ACME CORP PAYROLL PPD ID 1234', 'Acme Corp Payroll'],
    ['CITY OF AUSTIN WEB PMTS', 'City of Austin'],
  ])('%s → %s', (raw, clean) => {
    expect(cleanPayeeName(raw)).toBe(clean)
  })
})

describe('matching', () => {
  it('compares whole words, ignoring case and punctuation', () => {
    expect(ruleMatches(rule({ match: 'blue bottle' }), 'SQ *BLUE-BOTTLE #0423')).toBe(true)
    expect(ruleMatches(rule({ match: 'att' }), "MATT'S DINER")).toBe(false)
    expect(ruleMatches(rule({ match: 'sq', matchType: 'startsWith' }), 'SQ *COFFEE')).toBe(true)
    expect(ruleMatches(rule({ match: 'shell', matchType: 'exact' }), 'SHELL OIL')).toBe(false)
  })

  it('prefers an exact rule, then the most specific one', () => {
    const rules = [rule({ match: 'amazon' }), rule({ match: 'amazon prime' }), rule({ match: 'amazon prime video', matchType: 'exact' })]
    expect(findRule(rules, 'AMAZON PRIME*AB12')?.match).toBe('amazon prime')
    expect(findRule(rules, 'Amazon Prime Video')?.match).toBe('amazon prime video')
    expect(findRule([rule({ match: 'x', deleted: true })], 'x')).toBeUndefined()
  })

  it('renames and categorizes, or leaves the row alone', () => {
    const rules = [rule({ match: 'blue bottle', renameTo: 'Blue Bottle', categoryId: 'coffee' })]
    expect(applyRules(rules, 'SQ *BLUE BOTTLE 0423')).toMatchObject({ payee: 'Blue Bottle', categoryId: 'coffee' })
    expect(applyRules(rules, 'Kroger')).toEqual({ payee: 'Kroger', categoryId: null })
  })
})

describe('suggestRules', () => {
  const checking = account('Checking')
  const coffee = category('Coffee')
  const payees: Payee[] = [
    { id: 'a', name: 'SQ *BLUE BOTTLE 0423', deleted: false },
    { id: 'b', name: 'BLUE BOTTLE COFFEE #12', deleted: false },
    { id: 'c', name: 'Blue Bottle', deleted: false },
    { id: 'd', name: 'Kroger', deleted: false },
    { id: 'e', name: 'STARBUCKS STORE 12345 SEATTLE WA', deleted: false },
  ]
  const transactions = [
    txn(checking.id, '2026-10-01', -500, { payeeId: 'a', categoryId: coffee.id }),
    txn(checking.id, '2026-10-02', -500, { payeeId: 'c', categoryId: coffee.id }),
    txn(checking.id, '2026-10-03', -5000, { payeeId: 'd' }),
    txn(checking.id, '2026-10-04', -600, { payeeId: 'e', categoryId: coffee.id }),
    txn(checking.id, '2026-10-05', -650, { payeeId: 'b' }),
  ]

  it('groups bank names that are one store, and tidies messy ones', () => {
    const s = suggestRules(payees, transactions, [], [coffee])
    const blue = s.find((x) => x.renameTo === 'Blue Bottle')!
    expect(blue.payeeIds.sort()).toEqual(['a', 'c'])
    expect(blue.categoryId).toBe(coffee.id)
    expect(s.find((x) => x.renameTo === 'Starbucks')?.names).toEqual(['STARBUCKS STORE 12345 SEATTLE WA'])
    expect(s.find((x) => x.renameTo === 'Kroger')).toBeUndefined()
  })

  it('leaves out payees a rule already covers', () => {
    const s = suggestRules(payees, transactions, [rule({ match: 'starbucks' })], [coffee])
    expect(s.find((x) => x.renameTo === 'Starbucks')).toBeUndefined()
  })
})
