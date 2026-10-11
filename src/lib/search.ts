import { addMonths, compareIso, monthOf } from './dates'
import type { Account, Category, Cents, Id, Payee, Transaction } from '../types'

export type SearchRange = 'all' | 'month' | '3m' | 'year' | 'lastYear'
export type SearchKind = 'all' | 'spending' | 'income'

export interface SearchOptions {
  query: string
  range: SearchRange
  kind: SearchKind
  accountId: Id | null
  today: string
}

export interface SearchLookups {
  accounts: Account[]
  categories: Category[]
  payees: Payee[]
}

export interface SearchResult {
  matches: Transaction[]
  /** Positive sum of outflows among the matches. */
  spent: Cents
  received: Cents
}

interface AmountTest {
  op: '=' | '>' | '<' | '>=' | '<='
  cents: Cents
  /** The text as typed, for a bare number that may also be a word. */
  raw?: string
}

/**
 * Split a query into words to find and amount tests. "kroger >50" finds
 * Kroger charges over $50; "12.99" finds that exact amount either way;
 * "$5" is an amount, a bare "5" is both a word and an amount.
 */
export function parseQuery(query: string): { words: string[]; amounts: AmountTest[]; bareNumbers: AmountTest[] } {
  const words: string[] = []
  const amounts: AmountTest[] = []
  const bareNumbers: AmountTest[] = []
  for (const raw of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const m = raw.match(/^([<>]=?|=)?\s*\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/)
    if (m) {
      const cents = Number(m[2].replace(/,/g, '')) * 100 + Number((m[3] ?? '').padEnd(2, '0') || 0)
      const op = (m[1] ?? '=') as AmountTest['op']
      const explicit = !!m[1] || raw.includes('$') || raw.includes('.')
      if (explicit) amounts.push({ op, cents })
      else bareNumbers.push({ op, cents, raw })
      if (!explicit) words.push(raw)
      continue
    }
    words.push(raw)
  }
  return { words, amounts, bareNumbers }
}

function rangeStart(range: SearchRange, today: string): string | null {
  const month = monthOf(today)
  switch (range) {
    case 'month':
      return `${month}-01`
    case '3m':
      return `${addMonths(month, -2)}-01`
    case 'year':
      return `${today.slice(0, 4)}-01-01`
    case 'lastYear':
      return `${Number(today.slice(0, 4)) - 1}-01-01`
    default:
      return null
  }
}

function rangeEnd(range: SearchRange, today: string): string | null {
  return range === 'lastYear' ? `${Number(today.slice(0, 4)) - 1}-12-31` : null
}

function passes(cents: Cents, t: AmountTest): boolean {
  switch (t.op) {
    case '>':
      return cents > t.cents
    case '>=':
      return cents >= t.cents
    case '<':
      return cents < t.cents
    case '<=':
      return cents <= t.cents
    default:
      return cents === t.cents
  }
}

export function searchTransactions(transactions: Transaction[], opts: SearchOptions, lookups: SearchLookups): SearchResult {
  const accountById = new Map(lookups.accounts.map((a) => [a.id, a]))
  const categoryName = new Map(lookups.categories.map((c) => [c.id, c.name.toLowerCase()]))
  const payeeName = new Map(lookups.payees.map((p) => [p.id, p.name.toLowerCase()]))
  const { words, amounts, bareNumbers } = parseQuery(opts.query)
  const from = rangeStart(opts.range, opts.today)
  const to = rangeEnd(opts.range, opts.today)

  const matches: Transaction[] = []
  let spent = 0
  let received = 0

  for (const t of transactions) {
    if (t.deleted) continue
    const account = accountById.get(t.accountId)
    if (!account || account.deleted) continue
    if (opts.accountId && t.accountId !== opts.accountId) continue
    if (from && t.date < from) continue
    if (to && t.date > to) continue
    if (opts.kind === 'spending' && t.amount >= 0) continue
    if (opts.kind === 'income' && t.amount <= 0) continue

    const size = Math.abs(t.amount)
    if (!amounts.every((a) => passes(size, a))) continue

    if (words.length) {
      const parts = [
        t.payeeId ? (payeeName.get(t.payeeId) ?? '') : '',
        t.categoryId ? (categoryName.get(t.categoryId) ?? '') : '',
        account.name.toLowerCase(),
        t.memo.toLowerCase(),
        t.transferAccountId ? (accountById.get(t.transferAccountId)?.name.toLowerCase() ?? '') : '',
      ]
      for (const leg of t.subtransactions ?? []) {
        if (leg.categoryId) parts.push(categoryName.get(leg.categoryId) ?? '')
        if (leg.memo) parts.push(leg.memo.toLowerCase())
      }
      const haystack = parts.join(' \u0001 ')
      // A bare number may be a word ("7-eleven", "route 66") or an amount.
      const ok = words.every((w) => {
        if (haystack.includes(w)) return true
        const n = bareNumbers.find((b) => b.raw === w)
        return !!n && passes(size, n)
      })
      if (!ok) continue
    }

    matches.push(t)
    if (t.amount < 0) spent -= t.amount
    else received += t.amount
  }

  matches.sort((a, b) => compareIso(b.date, a.date) || compareIso(b.createdAt, a.createdAt))
  return { matches, spent, received }
}

/** The payees used most, as one-tap starting points for a search. */
export function topPayees(transactions: Transaction[], payees: Payee[], limit = 8): string[] {
  const counts = new Map<Id, number>()
  for (const t of transactions) {
    if (t.deleted || !t.payeeId || t.transferAccountId) continue
    counts.set(t.payeeId, (counts.get(t.payeeId) ?? 0) + 1)
  }
  const byId = new Map(payees.map((p) => [p.id, p]))
  return [...counts]
    .filter(([id]) => byId.get(id) && !byId.get(id)!.deleted && !byId.get(id)!.transferAccountId)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => byId.get(id)!.name)
}
