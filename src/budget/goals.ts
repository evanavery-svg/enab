import type { Cents, Goal, MonthKey } from '../types'
import { addMonths, monthDiff, weekdayOccurrencesInMonth } from '../lib/dates'

export interface GoalContext {
  month: MonthKey
  /** Balance carried into this month (may be negative). */
  carriedOver: Cents
  assigned: Cents
  /** Signed activity for the month (spending negative). */
  activity: Cents
  /**
   * Current balance of the linked debt account as a positive number.
   * Only used by `debt` goals.
   */
  debtBalance?: Cents
}

export interface GoalResult {
  /** What should be assigned this month to stay on track. */
  target: Cents
  /** Still needed this month (0 once satisfied). */
  underfunded: Cents
  /** 0..1 progress toward this month's target. */
  percent: number
  /** The month the full target amount is due, when the goal has a deadline. */
  dueMonth?: MonthKey
  /** True when the goal's deadline has passed without being met. */
  missed: boolean
}

const EMPTY: GoalResult = { target: 0, underfunded: 0, percent: 1, missed: false }

/** Months in one repetition of the goal's cadence. 0 = not a repeating goal. */
function periodMonths(goal: Goal): number {
  switch (goal.cadence) {
    case 'weekly':
      return 1
    case 'monthly':
      return 1
    case 'yearly':
      return 12
    case 'custom':
      return Math.max(1, (goal.every ?? 1) * (goal.cadenceUnit === 'year' ? 12 : 1))
    default:
      return 1
  }
}

/**
 * The amount due in one period. Weekly goals scale by how many times the
 * chosen weekday actually lands in the month, the way YNAB does it — a
 * $50/week target needs $250 in a five-Friday month.
 */
function periodAmount(goal: Goal, month: MonthKey): Cents {
  if (goal.cadence === 'weekly') {
    return goal.amount * weekdayOccurrencesInMonth(month, goal.dayOfWeek ?? 5)
  }
  return goal.amount
}

/** The next month (>= `month`) in which a repeating goal comes due. */
function nextDueMonth(goal: Goal, month: MonthKey): MonthKey {
  const period = periodMonths(goal)
  const anchor = goal.targetMonth ?? goal.startMonth
  if (period <= 1) return month
  const delta = monthDiff(anchor, month)
  if (delta <= 0) return anchor
  const steps = Math.ceil(delta / period)
  return addMonths(anchor, steps * period)
}

/**
 * Compute what a target asks of a single month.
 *
 * `refill` goals count money already sitting in the category; `setAside`
 * goals ignore it and ask for the full amount again each period.
 */
export function evaluateGoal(goal: Goal | undefined, ctx: GoalContext): GoalResult {
  if (!goal) return EMPTY
  if (monthDiff(goal.startMonth, ctx.month) < 0) return EMPTY

  const carried = Math.max(0, ctx.carriedOver)

  switch (goal.type) {
    case 'need': {
      const period = periodMonths(goal)
      const amount = periodAmount(goal, ctx.month)
      const style = goal.fundingStyle ?? (period > 1 ? 'refill' : 'refill')

      if (period <= 1) {
        const alreadyHave = style === 'refill' ? carried : 0
        const target = Math.max(0, amount - alreadyHave)
        const underfunded = Math.max(0, target - ctx.assigned)
        return {
          target,
          underfunded,
          percent: target === 0 ? 1 : Math.min(1, ctx.assigned / target),
          dueMonth: ctx.month,
          missed: false,
        }
      }

      // Multi-month cadence: spread what's left over the months until it's due.
      const due = nextDueMonth(goal, ctx.month)
      const monthsLeft = Math.max(1, monthDiff(ctx.month, due) + 1)
      const alreadyHave = style === 'refill' ? carried : 0
      const remaining = Math.max(0, amount - alreadyHave)
      const target = Math.ceil(remaining / monthsLeft)
      const underfunded = Math.max(0, target - ctx.assigned)
      return {
        target,
        underfunded,
        percent: target === 0 ? 1 : Math.min(1, ctx.assigned / target),
        dueMonth: due,
        missed: false,
      }
    }

    case 'balance': {
      // Save up to a number and stop. No deadline, so ask for the remainder.
      const have = carried + ctx.assigned
      const target = Math.max(0, goal.amount - carried)
      const underfunded = Math.max(0, goal.amount - have)
      return {
        target,
        underfunded,
        percent: goal.amount === 0 ? 1 : Math.min(1, have / goal.amount),
        missed: false,
      }
    }

    case 'balanceByDate':
    case 'debt': {
      const total = goal.type === 'debt' ? (ctx.debtBalance ?? goal.amount) : goal.amount
      const have = goal.type === 'debt' ? carried + ctx.assigned : carried + ctx.assigned
      const due = goal.targetMonth
      const remainingTotal = Math.max(0, total - carried)

      if (!due) {
        const target = remainingTotal
        return {
          target,
          underfunded: Math.max(0, target - ctx.assigned),
          percent: total === 0 ? 1 : Math.min(1, have / total),
          missed: false,
        }
      }

      const monthsLeft = monthDiff(ctx.month, due) + 1
      if (monthsLeft <= 0) {
        // Past the deadline: still show what it would take to finish.
        const target = remainingTotal
        return {
          target,
          underfunded: Math.max(0, target - ctx.assigned),
          percent: total === 0 ? 1 : Math.min(1, have / total),
          dueMonth: due,
          missed: have < total,
        }
      }

      const target = Math.ceil(remainingTotal / monthsLeft)
      return {
        target,
        underfunded: Math.max(0, target - ctx.assigned),
        percent: total === 0 ? 1 : Math.min(1, have / total),
        dueMonth: due,
        missed: false,
      }
    }

    default:
      return EMPTY
  }
}

/** Human-readable summary of a target, for the category detail panel. */
export function describeGoal(goal: Goal, currency: (c: Cents) => string): string {
  const amt = currency(goal.amount)
  switch (goal.type) {
    case 'need': {
      const style = goal.fundingStyle === 'setAside' ? 'Set aside' : 'Refill up to'
      switch (goal.cadence) {
        case 'weekly':
          return `${style} ${amt} each week`
        case 'yearly':
          return `${style} ${amt} each year`
        case 'custom':
          return `${style} ${amt} every ${goal.every ?? 1} ${goal.cadenceUnit === 'year' ? 'year' : 'month'}${(goal.every ?? 1) > 1 ? 's' : ''}`
        default:
          return `${style} ${amt} each month`
      }
    }
    case 'balance':
      return `Have a balance of ${amt}`
    case 'balanceByDate':
      return `Have ${amt} by ${goal.targetMonth ?? '—'}`
    case 'debt':
      return `Pay off this debt${goal.targetMonth ? ` by ${goal.targetMonth}` : ''}`
    default:
      return ''
  }
}
