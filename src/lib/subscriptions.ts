/**
 * The arithmetic behind the Subscriptions page: what each one costs per month
 * and per year, when it next bills, what cancelling saved — and the brand
 * colour its avatar wears.
 */
import { addMonths, fromISODate, toISODate } from './dates'
import type { RecurringSeries } from '../budget/analyze'
import type { Cents, Goal, GoalBill, ISODate, Subscription, SubscriptionCadence } from '../types'

export const CADENCE_SUFFIX: Record<SubscriptionCadence, string> = { monthly: '/mo', yearly: '/yr', weekly: '/wk' }
const PER_YEAR: Record<SubscriptionCadence, number> = { monthly: 12, yearly: 1, weekly: 52 }

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Cost over a year, or null when the price is unknown. */
export function yearlyCost(s: Pick<Subscription, 'amount' | 'cadence'>): Cents | null {
  return s.amount === null ? null : s.amount * PER_YEAR[s.cadence]
}

/** Cost spread over a month — a yearly plan counts as a twelfth of its price. */
export function monthlyCost(s: Pick<Subscription, 'amount' | 'cadence'>): Cents | null {
  const y = yearlyCost(s)
  return y === null ? null : Math.round(y / 12)
}

export interface SubscriptionTotals {
  /** Summed over a year first and divided once, so twelfths don't round twelve times. */
  monthly: Cents
  yearly: Cents
  /** Every subscription with a known price counted in the totals. */
  priced: number
  /** Ones without a price, named beside the total rather than counted as $0. */
  unpriced: Subscription[]
  /** Any priced one is an estimate, so the total is too. */
  approximate: boolean
}

export function totals(subs: Subscription[]): SubscriptionTotals {
  let yearly = 0
  let priced = 0
  let approximate = false
  const unpriced: Subscription[] = []
  for (const s of subs) {
    const y = yearlyCost(s)
    if (y === null) {
      unpriced.push(s)
      continue
    }
    yearly += y
    priced++
    if (s.amountIsEstimate) approximate = true
  }
  return { monthly: Math.round(yearly / 12), yearly, priced, unpriced, approximate }
}

function lastDayOf(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate()
}

/** The next date it bills, on or after `today`. Null when the day isn't known. */
export function nextCharge(s: Subscription, today: ISODate): ISODate | null {
  if (s.billingDay === null) return null
  const t = fromISODate(today)
  if (s.cadence === 'yearly') {
    if (s.billingMonth === null) return null
    const m0 = s.billingMonth - 1
    for (const y of [t.getFullYear(), t.getFullYear() + 1]) {
      const d = new Date(y, m0, Math.min(s.billingDay, lastDayOf(y, m0)))
      if (toISODate(d) >= today) return toISODate(d)
    }
    return null
  }
  if (s.cadence === 'monthly') {
    for (let i = 0; i < 2; i++) {
      const base = new Date(t.getFullYear(), t.getMonth() + i, 1)
      const d = new Date(base.getFullYear(), base.getMonth(), Math.min(s.billingDay, lastDayOf(base.getFullYear(), base.getMonth())))
      if (toISODate(d) >= today) return toISODate(d)
    }
  }
  return null
}

function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

/** "~28th", "End of month", "Oct 14" — how people actually describe a billing date. */
export function billingLabel(s: Pick<Subscription, 'cadence' | 'billingDay' | 'billingMonth'>): string | null {
  if (s.billingDay === null) return null
  if (s.cadence === 'yearly') {
    return s.billingMonth === null ? null : `${MONTH_SHORT[s.billingMonth - 1]} ${s.billingDay}`
  }
  if (s.cadence === 'monthly') {
    // Monthly charges drift a day or two with weekends and processors.
    return s.billingDay >= 31 ? 'End of month' : `~${ordinal(s.billingDay)}`
  }
  return null
}

/** "today", "tomorrow", "in 5 days", "Oct 14". */
export function whenLabel(date: ISODate, today: ISODate): string {
  const days = Math.round((fromISODate(date).getTime() - fromISODate(today).getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 14) return `in ${days} days`
  const d = fromISODate(date)
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
}

/** What cancelling has kept in your pocket so far: whole months since, at the monthly rate. */
export function savedSoFar(s: Subscription, today: ISODate): Cents | null {
  const perMonth = monthlyCost(s)
  if (perMonth === null || !s.cancelledOn || s.cancelledOn > today) return null
  const from = s.cancelledOn.slice(0, 7)
  let months = 0
  while (addMonths(from, months + 1) <= today.slice(0, 7)) months++
  // A cancellation on the 20th hasn't saved a month by the 5th of the next.
  if (Number(today.slice(8, 10)) < Number(s.cancelledOn.slice(8, 10))) months = Math.max(0, months - 1)
  return months * perMonth
}

/* ------------------------------------------------------------------ */
/* Avatars                                                             */
/* ------------------------------------------------------------------ */

/** Well-known services and the colour people recognise them by. */
const BRANDS: [RegExp, string, string][] = [
  [/\bclaude\b|anthropic/, '#d97757', 'Claude'],
  [/chatgpt|openai/, '#10a37f', 'ChatGPT'],
  [/playstation|\bps ?plus\b|\bpsn\b/, '#0070d1', 'PlayStation Plus'],
  [/nintendo/, '#e60012', 'Nintendo Switch Online'],
  [/xbox|game ?pass/, '#107c10', 'Xbox Game Pass'],
  [/youtube/, '#ff0033', 'YouTube Premium'],
  [/icloud|apple (storage|one|music|tv|arcade)|^apple$/, '#1d1d1f', 'Apple storage (iCloud+)'],
  [/google|gmail/, '#4285f4', 'Google One'],
  [/\bring\b/, '#1c9ad6', 'Ring'],
  [/disney/, '#113ccf', 'Disney+'],
  [/audible/, '#f39200', 'Audible'],
  [/fortnite|epic games/, '#7b3fe4', 'Fortnite Crew'],
  [/amazon|prime video|kindle/, '#ff9900', 'Amazon Prime'],
  [/\bign\b/, '#bf1313', 'IGN'],
  [/netflix/, '#e50914', 'Netflix'],
  [/spotify/, '#1db954', 'Spotify'],
  [/hulu/, '#1ce783', 'Hulu'],
  [/\bmax\b|hbo/, '#002be7', 'Max'],
  [/paramount/, '#0064ff', 'Paramount+'],
  [/peacock/, '#111111', 'Peacock'],
  [/crunchyroll/, '#f47521', 'Crunchyroll'],
  [/twitch/, '#9146ff', 'Twitch'],
  [/discord|nitro/, '#5865f2', 'Discord Nitro'],
  [/adobe/, '#fa0f00', 'Adobe'],
  [/microsoft|office|365/, '#0078d4', 'Microsoft 365'],
  [/dropbox/, '#0061ff', 'Dropbox'],
  [/github/, '#24292f', 'GitHub'],
  [/notion/, '#191919', 'Notion'],
  [/duolingo/, '#58cc02', 'Duolingo'],
  [/peloton/, '#181a1d', 'Peloton'],
  [/strava/, '#fc4c02', 'Strava'],
  [/patreon/, '#ff424d', 'Patreon'],
  [/new york times|nytimes|\bnyt\b/, '#121212', 'New York Times'],
  [/sirius/, '#0000eb', 'SiriusXM'],
  [/dashpass|doordash/, '#ff3008', 'DashPass'],
  [/instacart/, '#43b02a', 'Instacart+'],
  [/walmart/, '#0071ce', 'Walmart+'],
  [/costco/, '#e31837', 'Costco'],
  [/uber/, '#000000', 'Uber One'],
]

/** Names to offer while typing — the services the avatars know. */
export const KNOWN_SERVICES = BRANDS.map(([, , name]) => name)
export const BILLED_THROUGH = ['Apple', 'Google', 'PayPal', 'Amazon', 'Credit card', 'Debit card', 'Bank account']

/** Unknown names still get a steady colour of their own, picked from the name. */
const FALLBACK = ['#5b6cd6', '#2f9e7a', '#b5568a', '#c27c2c', '#4b8fc4', '#8a5bd0', '#3d9a4a', '#c0504d']

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function brandOf(name: string): { bg: string; fg: string; initial: string; onDark: string } {
  const n = name.trim().toLowerCase()
  let bg = BRANDS.find(([re]) => re.test(n))?.[1]
  if (!bg) {
    let h = 0
    for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    bg = FALLBACK[h % FALLBACK.length]
  }
  // White letters unless the colour is too light to carry them (Amazon's yellow).
  const fg = luminance(bg) > 0.4 ? '#16161a' : '#ffffff'
  const initial = (name.trim().match(/[A-Za-z0-9]/)?.[0] ?? '•').toUpperCase()
  // Near-black brands (Apple) vanish against a dark card; lift them to a grey there.
  const onDark = luminance(bg) < 0.03 ? '#8a8991' : bg
  return { bg, fg, initial, onDark }
}

/* ------------------------------------------------------------------ */
/* From transactions                                                   */
/* ------------------------------------------------------------------ */

export type SubscriptionDraft = Omit<Subscription, 'id' | 'createdAt' | 'deleted' | 'updatedAt'>

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Whether a detected series is already tracked — by payee, or by a name that contains the other. */
export function isTracked(series: RecurringSeries, subs: Subscription[]): boolean {
  const name = normal(series.payeeName)
  return subs.some((s) => {
    if (s.deleted) return false
    if (series.payeeId && s.payeeId === series.payeeId) return true
    const n = normal(s.name)
    return n.length >= 3 && name.length >= 3 && (name.includes(n) || n.includes(name))
  })
}

/** Turn a repeating charge found in the bank history into a subscription to track. */
export function draftFromSeries(series: RecurringSeries): SubscriptionDraft {
  const next = fromISODate(series.nextExpected)
  const native = series.cadence === 'monthly' || series.cadence === 'yearly' || series.cadence === 'weekly'
  const cadence: SubscriptionCadence = native ? (series.cadence as SubscriptionCadence) : 'monthly'
  return {
    name: series.payeeName,
    // An odd rhythm (quarterly, every two weeks) is tracked at its monthly equivalent.
    amount: native ? series.amount : series.monthlyCost,
    amountIsEstimate: !native || series.amountKind !== 'fixed',
    cadence,
    billingDay: cadence === 'weekly' ? null : next.getDate(),
    billingMonth: cadence === 'yearly' ? next.getMonth() + 1 : null,
    billedThrough: '',
    status: series.active ? 'active' : 'cancelled',
    cancelledOn: series.active ? undefined : series.lastDate,
    payeeId: series.payeeId,
  }
}

/* ------------------------------------------------------------------ */
/* Funding from the budget                                             */
/* ------------------------------------------------------------------ */

/**
 * The bills a funding target saves for: every active subscription with a
 * price. Weekly plans count as their monthly average. A yearly plan without a
 * known renewal month is assumed to renew a year after it was added, so it is
 * still saved for a twelfth at a time.
 */
export function goalBills(subs: Subscription[]): GoalBill[] {
  return subs
    .filter((s) => s.status === 'active' && !s.deleted && s.amount !== null && s.amount > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s): GoalBill => {
      const amount = s.amount as Cents
      if (s.cadence === 'weekly') return { name: s.name, amount: Math.round((amount * 52) / 12), everyMonths: 1 }
      if (s.cadence === 'monthly') return { name: s.name, amount, everyMonths: 1 }
      const added = (s.createdAt || '2000-01').slice(0, 7)
      const dueMonth = s.billingMonth
        ? `${added.slice(0, 4)}-${String(s.billingMonth).padStart(2, '0')}`
        : addMonths(added, 11)
      return { name: s.name, amount, everyMonths: 12, dueMonth }
    })
}

/** The target that pays for every tracked subscription out of one category. */
export function subscriptionGoal(subs: Subscription[], startMonth: string): Goal {
  return {
    type: 'need',
    amount: totals(subs.filter((s) => s.status === 'active' && !s.deleted)).monthly,
    cadence: 'monthly',
    fundingStyle: 'refill',
    startMonth,
    bills: goalBills(subs),
    source: 'subscriptions',
  }
}
