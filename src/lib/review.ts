import { addMonths } from './dates'
import type { BudgetResult } from '../budget/engine'
import type { Category, CategoryGroup, Cents, Goal, Id, MonthKey } from '../types'

export interface ReviewCategory {
  id: Id
  name: string
  group: string
  assigned: Cents
  /** Spending as a positive number (refunds net against it). */
  spent: Cents
  /** What was left at the end of the month; negative when overspent. */
  available: Cents
  /** Months in a row, ending this one, that spending beat what was assigned. */
  overStreak: number
  /** Average spending over the last three months. */
  average: Cents
}

export interface MonthReview {
  month: MonthKey
  income: Cents
  spent: Cents
  planned: Cents
  categories: ReviewCategory[]
  /** Spent more than was assigned this month, biggest gap first. */
  overPlan: ReviewCategory[]
  /** A monthly target that would have covered a category that keeps going over. */
  suggestions: { category: ReviewCategory; amount: Cents; current: Cents | null }[]
  /** Biggest moves in spending since the month before. */
  changes: { category: ReviewCategory; before: Cents; delta: Cents }[]
  /** Money that rolls forward, and where it sits. */
  carried: Cents
  carriedTop: ReviewCategory[]
}

/** Round up to the next $5, so a suggested target reads like one a person would pick. */
const roundUp5 = (c: Cents) => Math.ceil(c / 500) * 500

export function buildReview(input: {
  month: MonthKey
  budget: BudgetResult
  categories: Category[]
  groups: CategoryGroup[]
}): MonthReview {
  const { month, budget } = input
  const groupName = new Map(input.groups.map((g) => [g.id, g.name]))
  const states = (m: MonthKey) => budget.categoryStates.get(m)
  const spentIn = (m: MonthKey, id: Id) => Math.max(0, -(states(m)?.get(id)?.activity ?? 0))
  const assignedIn = (m: MonthKey, id: Id) => states(m)?.get(id)?.assigned ?? 0

  const categories: ReviewCategory[] = []
  for (const c of input.categories) {
    if (c.deleted || c.isInflow || c.linkedAccountId) continue
    const s = states(month)?.get(c.id)
    if (!s) continue
    if (c.hidden && s.activity === 0 && s.assigned === 0) continue
    let overStreak = 0
    for (let m = month, i = 0; i < 12; m = addMonths(m, -1), i++) {
      const sp = spentIn(m, c.id)
      if (sp > 0 && sp > assignedIn(m, c.id)) overStreak++
      else break
    }
    const last3 = [0, -1, -2].map((d) => spentIn(addMonths(month, d), c.id))
    categories.push({
      id: c.id,
      name: c.name,
      group: groupName.get(c.groupId) ?? '',
      assigned: s.assigned,
      spent: spentIn(month, c.id),
      available: s.available,
      overStreak,
      average: Math.round(last3.reduce((a, b) => a + b, 0) / 3),
    })
  }

  const spent = categories.reduce((s, c) => s + c.spent, 0)
  const planned = categories.reduce((s, c) => s + c.assigned, 0)
  const overPlan = categories.filter((c) => c.spent > c.assigned).sort((a, b) => b.spent - b.assigned - (a.spent - a.assigned))

  const goalOf = new Map(input.categories.map((c) => [c.id, c.goal]))
  const suggestions: MonthReview['suggestions'] = []
  for (const c of overPlan) {
    if (c.overStreak < 2) continue
    const goal: Goal | undefined = goalOf.get(c.id)
    // Leave alone targets that aren't a plain monthly amount (savings goals, debts, subscriptions).
    if (goal && !(goal.type === 'need' && (goal.cadence ?? 'monthly') === 'monthly' && !goal.bills)) continue
    const amount = roundUp5(Math.max(c.average, c.spent * 0.9))
    if (goal && goal.amount >= amount) continue
    suggestions.push({ category: c, amount, current: goal?.amount ?? null })
  }

  const prev = addMonths(month, -1)
  const changes = categories
    .map((c) => ({ category: c, before: spentIn(prev, c.id), delta: c.spent - spentIn(prev, c.id) }))
    .filter((x) => Math.abs(x.delta) >= 2_000)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5)

  const withMoney = categories.filter((c) => c.available > 0)
  return {
    month,
    income: budget.summaries.get(month)?.income ?? 0,
    spent,
    planned,
    categories,
    overPlan,
    suggestions,
    changes,
    carried: withMoney.reduce((s, c) => s + c.available, 0),
    carriedTop: withMoney.sort((a, b) => b.available - a.available).slice(0, 4),
  }
}

/** A target that covers the suggestion, keeping anything already set on it. */
export function raisedGoal(current: Goal | undefined, amount: Cents, startMonth: MonthKey): Goal {
  if (current && current.type === 'need') return { ...current, amount }
  return { type: 'need', amount, cadence: 'monthly', fundingStyle: 'refill', startMonth }
}
