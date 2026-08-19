import type { BudgetResult } from './engine'
import { addMonths } from '../lib/dates'
import type { Cents, Id, MonthKey } from '../types'

export type QuickBudgetAction =
  | 'underfunded'
  | 'assignedLastMonth'
  | 'spentLastMonth'
  | 'averageAssigned'
  | 'averageSpent'
  | 'resetAssigned'
  | 'resetAvailable'

export const QUICK_BUDGET_LABELS: Record<QuickBudgetAction, string> = {
  underfunded: 'Underfunded',
  assignedLastMonth: 'Assigned last month',
  spentLastMonth: 'Spent last month',
  averageAssigned: 'Average assigned',
  averageSpent: 'Average spent',
  resetAssigned: 'Reset assigned to zero',
  resetAvailable: 'Reset available to zero',
}

const LOOKBACK = 3

/**
 * What a quick-budget action would set a category's assigned amount to.
 * Returns null when the action doesn't apply to this category.
 */
export function quickBudgetAmount(
  action: QuickBudgetAction,
  budget: BudgetResult,
  month: MonthKey,
  categoryId: Id,
): Cents | null {
  const state = budget.categoryStates.get(month)?.get(categoryId)
  if (!state) return null

  const stateIn = (m: MonthKey) => budget.categoryStates.get(m)?.get(categoryId)

  switch (action) {
    case 'underfunded': {
      if (state.goalUnderfunded > 0) return state.assigned + state.goalUnderfunded
      // No target? Then "underfunded" means covering a negative balance.
      if (state.available < 0) return state.assigned - state.available
      return null
    }
    case 'assignedLastMonth': {
      const prev = stateIn(addMonths(month, -1))
      return prev ? prev.assigned : null
    }
    case 'spentLastMonth': {
      const prev = stateIn(addMonths(month, -1))
      if (!prev || prev.activity >= 0) return null
      return -prev.activity
    }
    case 'averageAssigned': {
      const values: Cents[] = []
      for (let i = 1; i <= LOOKBACK; i++) {
        const s = stateIn(addMonths(month, -i))
        if (s) values.push(s.assigned)
      }
      if (!values.length) return null
      return Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    }
    case 'averageSpent': {
      const values: Cents[] = []
      for (let i = 1; i <= LOOKBACK; i++) {
        const s = stateIn(addMonths(month, -i))
        if (s) values.push(Math.max(0, -s.activity))
      }
      if (!values.length) return null
      return Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    }
    case 'resetAssigned':
      return 0
    case 'resetAvailable':
      // Pull the assigned amount to whatever makes available land on zero.
      return state.assigned - state.available
    default:
      return null
  }
}

/** Apply a quick-budget action across many categories at once. */
export function quickBudgetPlan(
  action: QuickBudgetAction,
  budget: BudgetResult,
  month: MonthKey,
  categoryIds: Id[],
): { categoryId: Id; assigned: Cents }[] {
  const plan: { categoryId: Id; assigned: Cents }[] = []
  for (const categoryId of categoryIds) {
    const amount = quickBudgetAmount(action, budget, month, categoryId)
    if (amount === null) continue
    const current = budget.categoryStates.get(month)?.get(categoryId)?.assigned ?? 0
    if (amount === current) continue
    plan.push({ categoryId, assigned: amount })
  }
  return plan
}
