import type {
  Account,
  Category,
  CategoryGroup,
  Cents,
  Id,
  ISODate,
  MonthKey,
  Payee,
  Transaction,
} from '../types'
import { addDays, addMonths, addMonthsToDate, daysBetween, monthDiff, today } from '../lib/dates'
import type { BudgetResult } from './engine'

/* ------------------------------------------------------------------ */
/* Recurring transaction detection                                     */
/* ------------------------------------------------------------------ */

export type Cadence =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'semiannual'
  | 'yearly'
  | 'irregular'

/** Canonical day counts, and how many times a cadence occurs per year. */
const CADENCES: {
  cadence: Exclude<Cadence, 'irregular'>
  min: number
  max: number
  perYear: number
  /** Set for cadences that step in whole months rather than days. */
  months?: number
}[] = [
  { cadence: 'weekly', min: 6, max: 8, perYear: 52 },
  { cadence: 'biweekly', min: 12, max: 16, perYear: 26 },
  { cadence: 'monthly', min: 26, max: 35, perYear: 12, months: 1 },
  { cadence: 'bimonthly', min: 55, max: 68, perYear: 6, months: 2 },
  { cadence: 'quarterly', min: 82, max: 100, perYear: 4, months: 3 },
  { cadence: 'semiannual', min: 165, max: 200, perYear: 2, months: 6 },
  { cadence: 'yearly', min: 340, max: 395, perYear: 1, months: 12 },
]

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  bimonthly: 'Every 2 months',
  quarterly: 'Quarterly',
  semiannual: 'Twice a year',
  yearly: 'Yearly',
  irregular: 'Irregular',
}

export interface RecurringSeries {
  id: string
  payeeId: Id | null
  payeeName: string
  categoryId: Id | null
  categoryName: string | null
  /** Typical amount, as a positive number. */
  amount: Cents
  /** Smallest and largest charge seen, for variable series. */
  minAmount: Cents
  maxAmount: Cents
  /** `fixed` = identical every time; `steady` = within a few percent. */
  amountKind: 'fixed' | 'steady' | 'variable'
  cadence: Cadence
  intervalDays: number
  occurrences: number
  firstDate: ISODate
  lastDate: ISODate
  nextExpected: ISODate
  /** Cost normalised to one month, for budgeting. */
  monthlyCost: Cents
  yearlyCost: Cents
  /** False once it has been quiet for well over one interval. */
  active: boolean
  /** 0..1 — how regular the timing and amounts are. */
  confidence: number
  /**
   * A regular charge for a steady amount: what most people mean by a
   * subscription, as opposed to merely shopping somewhere often.
   */
  isSubscription: boolean
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function classifyCadence(days: number): { cadence: Cadence; perYear: number; months?: number } {
  for (const c of CADENCES) {
    if (days >= c.min && days <= c.max) {
      return { cadence: c.cadence, perYear: c.perYear, months: c.months }
    }
  }
  return { cadence: 'irregular', perYear: 365 / Math.max(1, days) }
}

/** The spending side of a transaction, flattened past any split. */
interface Charge {
  date: ISODate
  amount: Cents
  categoryId: Id | null
}

function chargesOf(t: Transaction): Charge | null {
  if (t.isStartingBalance || t.transferAccountId) return null

  if (t.subtransactions?.length) {
    const total = t.subtransactions.reduce((sum, s) => sum + s.amount, 0)
    if (total >= 0) return null
    // Attribute a split to whichever leg dominates it.
    const biggest = [...t.subtransactions].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0]
    return { date: t.date, amount: -total, categoryId: biggest?.categoryId ?? null }
  }

  if (t.amount >= 0) return null
  return { date: t.date, amount: -t.amount, categoryId: t.categoryId ?? null }
}

export interface DetectInput {
  accounts: Account[]
  categories: Category[]
  payees: Payee[]
  transactions: Transaction[]
  /** Defaults to today; injectable so tests are not time-dependent. */
  asOf?: ISODate
  /** Occurrences needed before a pattern is believed. */
  minOccurrences?: number
}

/**
 * Find charges that repeat on a schedule.
 *
 * Grouped by payee, because that is what a subscription actually is: the same
 * company taking money at the same interval. Three occurrences is the floor —
 * two points make a line through any pair of dates, and would flag every
 * coincidence as a pattern.
 */
export function detectRecurring(input: DetectInput): RecurringSeries[] {
  const asOf = input.asOf ?? today()
  const minOccurrences = input.minOccurrences ?? 3

  const onBudget = new Set(input.accounts.filter((a) => a.onBudget && !a.deleted).map((a) => a.id))
  const categoryById = new Map(input.categories.map((c) => [c.id, c]))
  const payeeById = new Map(input.payees.map((p) => [p.id, p]))
  const inflowId = input.categories.find((c) => c.isInflow)?.id ?? null

  const byPayee = new Map<Id, Charge[]>()
  for (const t of input.transactions) {
    if (t.deleted || !onBudget.has(t.accountId) || !t.payeeId) continue
    const payee = payeeById.get(t.payeeId)
    if (!payee || payee.deleted || payee.transferAccountId) continue
    const charge = chargesOf(t)
    if (!charge || charge.categoryId === inflowId) continue
    const list = byPayee.get(t.payeeId)
    if (list) list.push(charge)
    else byPayee.set(t.payeeId, [charge])
  }

  const series: RecurringSeries[] = []

  for (const [payeeId, charges] of byPayee) {
    if (charges.length < minOccurrences) continue
    charges.sort((a, b) => a.date.localeCompare(b.date))

    const gaps: number[] = []
    for (let i = 1; i < charges.length; i++) {
      gaps.push(daysBetween(charges[i - 1].date, charges[i].date))
    }
    // Several charges on one day is a shopping trip, not a schedule.
    const usableGaps = gaps.filter((g) => g > 0)
    if (usableGaps.length < minOccurrences - 1) continue

    const intervalDays = median(usableGaps)
    if (intervalDays < 5) continue

    const { cadence, perYear, months: cadenceMonths } = classifyCadence(intervalDays)

    // Timing regularity: how far each gap strays from the typical one.
    const tolerance = Math.max(4, intervalDays * 0.3)
    const onSchedule = usableGaps.filter((g) => Math.abs(g - intervalDays) <= tolerance).length
    const timingScore = onSchedule / usableGaps.length

    const amounts = charges.map((c) => c.amount)
    const typical = median(amounts)
    const minAmount = Math.min(...amounts)
    const maxAmount = Math.max(...amounts)
    const spread = typical === 0 ? 1 : (maxAmount - minAmount) / typical
    const amountKind: RecurringSeries['amountKind'] =
      minAmount === maxAmount ? 'fixed' : spread <= 0.15 ? 'steady' : 'variable'
    const amountScore = amountKind === 'fixed' ? 1 : amountKind === 'steady' ? 0.8 : 0.4

    // More observations make a pattern more believable, up to a point.
    const volumeScore = Math.min(1, charges.length / 6)
    const confidence = Number((timingScore * 0.5 + amountScore * 0.3 + volumeScore * 0.2).toFixed(3))

    if (timingScore < 0.5) continue

    const lastDate = charges[charges.length - 1].date
    // Month-based cadences step by months so the day of the month holds. Adding
    // a median day count instead would drift a "5th of the month" bill forward
    // a day or two every cycle.
    const nextExpected = cadenceMonths
      ? addMonthsToDate(lastDate, cadenceMonths)
      : addDays(lastDate, intervalDays)
    const active = daysBetween(lastDate, asOf) <= intervalDays * 1.8 + 7

    // Pick the category this payee lands in most often.
    const categoryCounts = new Map<string, number>()
    for (const c of charges) {
      const key = c.categoryId ?? ''
      categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1)
    }
    const categoryId =
      [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null

    const yearlyCost = Math.round(typical * perYear)

    series.push({
      id: payeeId,
      payeeId,
      payeeName: payeeById.get(payeeId)?.name ?? 'Unknown',
      categoryId: categoryId || null,
      categoryName: categoryId ? (categoryById.get(categoryId)?.name ?? null) : null,
      amount: typical,
      minAmount,
      maxAmount,
      amountKind,
      cadence,
      intervalDays,
      occurrences: charges.length,
      firstDate: charges[0].date,
      lastDate,
      nextExpected,
      monthlyCost: Math.round(yearlyCost / 12),
      yearlyCost,
      active,
      confidence,
      isSubscription: cadence !== 'irregular' && amountKind !== 'variable' && timingScore >= 0.6,
    })
  }

  return series.sort((a, b) => b.monthlyCost - a.monthlyCost)
}

/* ------------------------------------------------------------------ */
/* Budget plan                                                         */
/* ------------------------------------------------------------------ */

export interface PlanRow {
  categoryId: Id
  categoryName: string
  groupId: Id
  groupName: string
  /** Typical month's spending, resistant to one-off spikes. */
  medianMonthly: Cents
  averageMonthly: Cents
  /** Highest month seen in the window. */
  peakMonthly: Cents
  /** Steady subscription commitments landing in this category each month. */
  recurringMonthly: Cents
  subscriptions: RecurringSeries[]
  /** How many of the analysed months had any activity here. */
  monthsWithSpending: number
  suggested: Cents
  currentlyAssigned: Cents
  /** Plain-language reason for the suggestion. */
  basis: string
}

export interface BudgetPlan {
  month: MonthKey
  monthsAnalyzed: MonthKey[]
  rows: PlanRow[]
  totalSuggested: Cents
  totalCurrentlyAssigned: Cents
  medianIncome: Cents
  /** Every repeating series found, including variable and lapsed ones. */
  recurring: RecurringSeries[]
  /** The steady, still-active subset — what people call subscriptions. */
  subscriptions: RecurringSeries[]
  subscriptionMonthlyTotal: Cents
  subscriptionYearlyTotal: Cents
}

export interface PlanInput {
  month: MonthKey
  accounts: Account[]
  categories: Category[]
  groups: CategoryGroup[]
  payees: Payee[]
  transactions: Transaction[]
  budget: BudgetResult
  /** How many completed months to learn from. */
  lookbackMonths?: number
  asOf?: ISODate
}

/** Round up to a whole currency unit — nobody budgets $47.31 on purpose. */
const roundUp = (cents: Cents): Cents => (cents <= 0 ? 0 : Math.ceil(cents / 100) * 100)

/**
 * Propose an assignment for every category from what actually happened.
 *
 * The median of past months is the starting point rather than the average,
 * because one holiday or one car repair should not permanently inflate a
 * category. Known recurring commitments set a floor: a subscription you have
 * not cancelled will be charged whether or not last month happened to be quiet.
 */
export function buildBudgetPlan(input: PlanInput): BudgetPlan {
  const asOf = input.asOf ?? today()
  const lookback = input.lookbackMonths ?? 6
  const currentMonth = asOf.slice(0, 7)

  // Only completed months teach anything; the current one is still partial.
  const lastComplete = addMonths(currentMonth, -1)
  const monthsAnalyzed = input.budget.months
    .filter((m) => monthDiff(m, lastComplete) >= 0 && monthDiff(addMonths(lastComplete, -(lookback - 1)), m) >= 0)
    .sort()

  const recurring = detectRecurring({
    accounts: input.accounts,
    categories: input.categories,
    payees: input.payees,
    transactions: input.transactions,
    asOf,
  })
  const subscriptions = recurring.filter((r) => r.isSubscription && r.active)

  // Only steady subscriptions set a floor under a category. A variable charge
  // — an electricity bill, or shopping somewhere most weeks — is already
  // reflected in the historical median, and normalising it to a "monthly cost"
  // would double-count it and inflate the plan.
  const recurringByCategory = new Map<Id, RecurringSeries[]>()
  for (const r of subscriptions) {
    if (!r.categoryId) continue
    const list = recurringByCategory.get(r.categoryId)
    if (list) list.push(r)
    else recurringByCategory.set(r.categoryId, [r])
  }

  const groupById = new Map(input.groups.map((g) => [g.id, g]))
  const states = input.budget.categoryStates
  const currentStates = states.get(input.month)

  const rows: PlanRow[] = []

  for (const category of input.categories) {
    if (category.deleted || category.isInflow || category.hidden) continue
    // Credit card payment categories are driven by card spending, not by a plan.
    if (category.linkedAccountId) continue
    const group = groupById.get(category.groupId)
    if (!group || group.isInternal) continue

    const monthlySpend = monthsAnalyzed.map((m) => {
      const activity = states.get(m)?.get(category.id)?.activity ?? 0
      return activity < 0 ? -activity : 0
    })

    const withSpending = monthlySpend.filter((v) => v > 0)
    const medianMonthly = median(monthlySpend)
    const averageMonthly = monthlySpend.length
      ? Math.round(monthlySpend.reduce((a, b) => a + b, 0) / monthlySpend.length)
      : 0
    const peakMonthly = monthlySpend.length ? Math.max(...monthlySpend) : 0

    const categoryRecurring = recurringByCategory.get(category.id) ?? []
    const recurringMonthly = categoryRecurring.reduce((sum, r) => sum + r.monthlyCost, 0)

    // A category that only fired occasionally is better planned from its
    // average than its median, which would otherwise read as zero.
    const sparse = withSpending.length > 0 && withSpending.length <= monthlySpend.length / 2
    const base = sparse ? averageMonthly : medianMonthly
    const suggested = roundUp(Math.max(base, recurringMonthly))

    let basis: string
    if (suggested === 0) {
      basis = 'No spending in this period'
    } else if (recurringMonthly > 0 && recurringMonthly >= base) {
      basis = `${categoryRecurring.length} subscription${categoryRecurring.length === 1 ? '' : 's'}`
    } else if (sparse) {
      basis = `Spread from ${withSpending.length} of ${monthlySpend.length} months`
    } else {
      basis = `Typical of ${monthlySpend.length} months`
    }

    rows.push({
      categoryId: category.id,
      categoryName: category.name,
      groupId: group.id,
      groupName: group.name,
      medianMonthly,
      averageMonthly,
      peakMonthly,
      recurringMonthly,
      subscriptions: categoryRecurring,
      monthsWithSpending: withSpending.length,
      suggested,
      currentlyAssigned: currentStates?.get(category.id)?.assigned ?? 0,
      basis,
    })
  }

  rows.sort((a, b) => b.suggested - a.suggested || a.categoryName.localeCompare(b.categoryName))

  const incomes = monthsAnalyzed.map((m) => input.budget.summaries.get(m)?.income ?? 0)

  return {
    month: input.month,
    monthsAnalyzed,
    rows,
    totalSuggested: rows.reduce((sum, r) => sum + r.suggested, 0),
    totalCurrentlyAssigned: rows.reduce((sum, r) => sum + r.currentlyAssigned, 0),
    medianIncome: median(incomes),
    recurring,
    subscriptions,
    subscriptionMonthlyTotal: subscriptions.reduce((sum, r) => sum + r.monthlyCost, 0),
    subscriptionYearlyTotal: subscriptions.reduce((sum, r) => sum + r.yearlyCost, 0),
  }
}
