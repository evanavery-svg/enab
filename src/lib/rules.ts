import type { Category, Id, Payee, PayeeRule, Transaction } from '../types'

/** Lowercase words only, so "SQ *BLUE-BOTTLE #12" and "sq blue bottle 12" compare equal. */
export function normalizePayee(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

/** Whether a rule applies to a bank payee name. Matches whole words, so "att" doesn't catch "Matt's". */
export function ruleMatches(rule: Pick<PayeeRule, 'match' | 'matchType'>, payee: string): boolean {
  const m = normalizePayee(rule.match)
  if (!m) return false
  const p = normalizePayee(payee)
  switch (rule.matchType) {
    case 'exact':
      return p === m
    case 'startsWith':
      return `${p} `.startsWith(`${m} `)
    default:
      return ` ${p} `.includes(` ${m} `)
  }
}

/** The rule for a payee: an exact rule first, then the longest (most specific) match. */
export function findRule(rules: PayeeRule[], payee: string): PayeeRule | undefined {
  let best: PayeeRule | undefined
  let bestScore = -1
  for (const r of rules) {
    if (r.deleted || !ruleMatches(r, payee)) continue
    const score = (r.matchType === 'exact' ? 10_000 : 0) + normalizePayee(r.match).length
    if (score > bestScore) {
      best = r
      bestScore = score
    }
  }
  return best
}

/** What a rule does to an imported row. */
export function applyRules(rules: PayeeRule[], payee: string): { payee: string; categoryId: Id | null; rule?: PayeeRule } {
  const rule = findRule(rules, payee)
  if (!rule) return { payee, categoryId: null }
  return { payee: rule.renameTo.trim() || payee, categoryId: rule.categoryId, rule }
}

const STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '),
)
/** Card-processor and bank prefixes: "SQ *", "TST*", "PAYPAL *", "POS DEBIT". */
const PREFIX =
  /^(?:(?:sq|tst|pp|sp|dd|py|bt|fsp|ckcd|paypal|pos|ach|chk|checkcard|debit|purchase|recurring|card|visa|dbt|pmt)\b\s*[*#:-]?\s*)+/i
const SMALL = new Set(['and', 'of', 'the', 'for', 'at', 'on', 'in', 'a', 'to'])

/**
 * A readable name for a messy bank payee: processor prefixes, store numbers,
 * reference codes, dates, phone numbers and a trailing state code go, and
 * SHOUTING becomes Title Case. "SQ *BLUE BOTTLE 0423" → "Blue Bottle".
 */
export function cleanPayeeName(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 2; i++) {
    s = s.replace(PREFIX, '')
    s = s.replace(/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+/, '')
  }
  s = s.replace(/https?:\/\/\S+|www\.\S+/gi, '')
  s = s.replace(/\.(com|net|org)\b.*$/i, '')
  // "UBER *TRIP", "AMZN Mktp US*2K4AB1": what follows a star is a reference.
  s = s.replace(/\s*\*\s*\S.*$/, '')
  s = s.replace(/\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b.*$/, '')
  s = s.replace(/\s+\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b.*$/, '')
  // A store or terminal number ends the name; city and state follow it.
  s = s.replace(/\s+(?:store|str|no\.?)?\s*#\s*\d+.*$/i, '')
  s = s.replace(/\s+(?:store\s+|str\s+)?[a-z]?\d{3,}[a-z]?\b.*$/i, '')
  // ACH descriptors on payroll and bill payments: "PAYROLL PPD ID".
  s = s.replace(/\s+(?:ppd|ccd|web|tel|ach)\b(?:\s+id\b)?.*$/i, '')
  const last = s.match(/\s+([A-Za-z]{2})$/)
  if (last && last[1] === last[1].toUpperCase() && STATES.has(last[1])) s = s.slice(0, last.index)
  s = s.replace(/[*#]+/g, ' ').replace(/\s+/g, ' ').replace(/[\s,.:;-]+$/, '').trim()
  if (!s) return raw.trim()
  // Banks drop apostrophes: "TRADER JOE S", "MACY S".
  s = s.replace(/(\p{L}{2,}) S\b/gu, "$1'S")
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) {
    s = s
      .toLowerCase()
      .split(' ')
      .map((w, i) =>
        i > 0 && SMALL.has(w) ? w : w.replace(/(^|-)(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase()),
      )
      .join(' ')
  }
  return s
}

export interface RuleSuggestion {
  key: string
  renameTo: string
  match: string
  categoryId: Id | null
  payeeIds: Id[]
  /** The bank names it would tidy, for showing. */
  names: string[]
  transactions: number
}

/**
 * Rules worth making, from payees already in the budget: messy bank names
 * that clean up to something readable, and several bank names that are
 * really one store. Payees a rule already covers are left out.
 */
export function suggestRules(
  payees: Payee[],
  transactions: Transaction[],
  rules: PayeeRule[],
  categories: Category[],
): RuleSuggestion[] {
  const live = new Set(categories.filter((c) => !c.deleted).map((c) => c.id))
  const usage = new Map<Id, { count: number; cats: Map<Id, number> }>()
  for (const t of transactions) {
    if (t.deleted || !t.payeeId || t.transferAccountId) continue
    let u = usage.get(t.payeeId)
    if (!u) usage.set(t.payeeId, (u = { count: 0, cats: new Map() }))
    u.count++
    if (t.categoryId && live.has(t.categoryId)) u.cats.set(t.categoryId, (u.cats.get(t.categoryId) ?? 0) + 1)
  }

  const groups = new Map<string, { clean: string; payees: Payee[] }>()
  for (const p of payees) {
    if (p.deleted || p.transferAccountId || !usage.has(p.id)) continue
    if (rules.some((r) => !r.deleted && ruleMatches(r, p.name))) continue
    const clean = cleanPayeeName(p.name)
    const key = normalizePayee(clean)
    if (key.length < 3) continue
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { clean, payees: [] }))
    g.payees.push(p)
  }

  const out: RuleSuggestion[] = []
  for (const [key, g] of groups) {
    const messy = g.payees.some((p) => normalizePayee(p.name) !== key)
    if (!messy && g.payees.length < 2) continue
    const cats = new Map<Id, number>()
    let count = 0
    for (const p of g.payees) {
      const u = usage.get(p.id)!
      count += u.count
      for (const [c, n] of u.cats) cats.set(c, (cats.get(c) ?? 0) + n)
    }
    const top = [...cats].sort((a, b) => b[1] - a[1])[0]
    out.push({
      key,
      renameTo: g.clean,
      match: key,
      categoryId: top && top[1] / count >= 0.6 ? top[0] : null,
      payeeIds: g.payees.map((p) => p.id),
      names: g.payees.map((p) => p.name),
      transactions: count,
    })
  }
  return out.sort((a, b) => b.transactions - a.transactions)
}
