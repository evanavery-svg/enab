import type {
  Account,
  BudgetEntry,
  Category,
  CategoryMonthState,
  Cents,
  Id,
  MonthKey,
  MonthSummary,
  Transaction,
} from '../types'
import { addMonths, currentMonth, monthDiff, monthRange } from '../lib/dates'
import { evaluateGoal } from './goals'

export interface BudgetInput {
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  entries: BudgetEntry[]
  /** Compute at least through this month (defaults to the current month + 1). */
  throughMonth?: MonthKey
}

export interface BudgetResult {
  months: MonthKey[]
  /** month -> categoryId -> state */
  categoryStates: Map<MonthKey, Map<Id, CategoryMonthState>>
  summaries: Map<MonthKey, MonthSummary>
  /** Transactions in on-budget accounts still missing a category. */
  uncategorizedCount: number
  /** Money assigned to months after the one being viewed. */
  assignedAfter: Map<MonthKey, Cents>
}

/** One side of a transaction's effect on the budget. */
interface Leg {
  amount: Cents
  categoryId: Id | null
  transferAccountId: Id | null
}

function legsOf(t: Transaction): Leg[] {
  if (t.subtransactions && t.subtransactions.length > 0) {
    return t.subtransactions.map((s) => ({
      amount: s.amount,
      categoryId: s.categoryId ?? null,
      transferAccountId: s.transferAccountId ?? null,
    }))
  }
  return [
    {
      amount: t.amount,
      categoryId: t.categoryId ?? null,
      transferAccountId: t.transferAccountId ?? null,
    },
  ]
}

const emptyState = (categoryId: Id, month: MonthKey): CategoryMonthState => ({
  categoryId,
  month,
  carriedOver: 0,
  assigned: 0,
  activity: 0,
  available: 0,
  creditSpending: 0,
  creditOverspending: 0,
  cashOverspending: 0,
  goalUnderfunded: 0,
  goalTarget: 0,
  goalPercent: 1,
})

/**
 * The whole envelope-budget calculation, month by month.
 *
 * The rules that matter, and why the loop is ordered the way it is:
 *
 *  - A category's available balance is `carried over + assigned + activity`.
 *  - A positive balance rolls into next month untouched.
 *  - A negative balance is split. The part that was spent on a credit card
 *    but never funded ("credit overspending") rolls forward as a negative
 *    category balance, because that debt is real and still unbudgeted. The
 *    rest ("cash overspending") is money that already left a checking
 *    account, so it is taken out of next month's Ready to Assign instead and
 *    the category restarts at zero.
 *  - Spending on a credit card that *was* funded moves out of the spending
 *    category and into that card's payment category, so the money is set
 *    aside to pay the bill. Payments made to the card spend it back out.
 *
 * Payment categories are resolved after ordinary ones each month because
 * they consume the funded amounts the ordinary pass produces.
 */
export function computeBudget(input: BudgetInput): BudgetResult {
  const { accounts, categories, transactions, entries } = input

  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const onBudget = new Set(accounts.filter((a) => a.onBudget && !a.deleted).map((a) => a.id))
  const creditAccounts = accounts.filter((a) => a.class === 'credit' && !a.deleted)

  const inflowCategory = categories.find((c) => c.isInflow)
  const inflowId = inflowCategory?.id ?? null

  const paymentCategoryByAccount = new Map<Id, Id>()
  const accountByPaymentCategory = new Map<Id, Id>()
  for (const a of creditAccounts) {
    if (a.paymentCategoryId) {
      paymentCategoryByAccount.set(a.id, a.paymentCategoryId)
      accountByPaymentCategory.set(a.paymentCategoryId, a.id)
    }
  }

  const budgetCategories = categories.filter((c) => !c.deleted && !c.isInflow)
  const ordinaryCategories = budgetCategories.filter((c) => !accountByPaymentCategory.has(c.id))
  const paymentCategories = budgetCategories.filter((c) => accountByPaymentCategory.has(c.id))

  /* ---------------- Pass 1: bucket every transaction ---------------- */

  /** month -> categoryId -> signed activity */
  const activity = new Map<MonthKey, Map<Id, Cents>>()
  /** month -> categoryId -> accountId -> signed activity on that credit card */
  const creditActivity = new Map<MonthKey, Map<Id, Map<Id, Cents>>>()
  /** month -> creditAccountId -> net money paid toward the card */
  const cardPayments = new Map<MonthKey, Map<Id, Cents>>()
  /** month -> income destined for Ready to Assign */
  const income = new Map<MonthKey, Cents>()

  let uncategorizedCount = 0
  let earliest: MonthKey | null = null
  let latest: MonthKey | null = null

  const bump = <K>(map: Map<MonthKey, Map<K, Cents>>, month: MonthKey, key: K, delta: Cents) => {
    let inner = map.get(month)
    if (!inner) map.set(month, (inner = new Map()))
    inner.set(key, (inner.get(key) ?? 0) + delta)
  }

  for (const t of transactions) {
    if (t.deleted) continue
    const account = accountById.get(t.accountId)
    if (!account || account.deleted) continue

    const month = t.month || t.date.slice(0, 7)
    if (!earliest || month < earliest) earliest = month
    if (!latest || month > latest) latest = month

    if (!onBudget.has(t.accountId)) continue

    for (const leg of legsOf(t)) {
      const counterpart = leg.transferAccountId ? accountById.get(leg.transferAccountId) : undefined
      const isInternalTransfer = !!counterpart && counterpart.onBudget && !counterpart.deleted

      if (isInternalTransfer) {
        // Money moving between on-budget accounts isn't income or spending.
        // It only matters when a credit card is involved: that's a payment.
        if (account.class === 'credit') {
          bump(cardPayments, month, account.id, leg.amount)
        }
        continue
      }

      if (!leg.categoryId) {
        // Starting balances intentionally carry no category on debt accounts.
        if (!t.isStartingBalance) uncategorizedCount++
        continue
      }

      if (leg.categoryId === inflowId) {
        income.set(month, (income.get(month) ?? 0) + leg.amount)
        continue
      }

      bump(activity, month, leg.categoryId, leg.amount)

      if (account.class === 'credit') {
        let byCat = creditActivity.get(month)
        if (!byCat) creditActivity.set(month, (byCat = new Map()))
        let byAcct = byCat.get(leg.categoryId)
        if (!byAcct) byCat.set(leg.categoryId, (byAcct = new Map()))
        byAcct.set(account.id, (byAcct.get(account.id) ?? 0) + leg.amount)
      }
    }
  }

  /* ---------------- Determine the month span ---------------- */

  const entriesByMonth = new Map<MonthKey, Map<Id, Cents>>()
  for (const e of entries) {
    if (!earliest || e.month < earliest) earliest = e.month
    if (!latest || e.month > latest) latest = e.month
    let inner = entriesByMonth.get(e.month)
    if (!inner) entriesByMonth.set(e.month, (inner = new Map()))
    inner.set(e.categoryId, e.assigned)
  }

  const now = currentMonth()
  const through = input.throughMonth ?? addMonths(now, 1)
  const first = earliest && earliest < now ? earliest : now
  const last = [latest ?? now, through, now].reduce((a, b) => (a > b ? a : b))
  const months = monthRange(first, last)

  /* ---------------- Pass 2: roll the months forward ---------------- */

  const categoryStates = new Map<MonthKey, Map<Id, CategoryMonthState>>()
  const summaries = new Map<MonthKey, MonthSummary>()

  let prevStates = new Map<Id, CategoryMonthState>()
  let runningReadyToAssign = 0

  for (const month of months) {
    const states = new Map<Id, CategoryMonthState>()
    const assignedThisMonth = entriesByMonth.get(month) ?? new Map<Id, Cents>()
    const monthActivity = activity.get(month) ?? new Map<Id, Cents>()
    const monthCredit = creditActivity.get(month) ?? new Map<Id, Map<Id, Cents>>()

    /** creditAccountId -> money that should land in its payment category. */
    const paymentInflow = new Map<Id, Cents>()

    // --- ordinary categories -------------------------------------------
    for (const cat of ordinaryCategories) {
      const state = emptyState(cat.id, month)
      const prev = prevStates.get(cat.id)
      state.carriedOver = prev ? carryFrom(prev) : 0
      state.assigned = assignedThisMonth.get(cat.id) ?? 0
      state.activity = monthActivity.get(cat.id) ?? 0
      state.available = state.carriedOver + state.assigned + state.activity

      const perCard = monthCredit.get(cat.id)
      if (perCard && perCard.size > 0) {
        let totalSpend = 0
        const spends: [Id, Cents][] = []
        for (const [acctId, net] of perCard) {
          const spend = net < 0 ? -net : 0
          const refund = net > 0 ? net : 0
          if (refund > 0) paymentInflow.set(acctId, (paymentInflow.get(acctId) ?? 0) - refund)
          if (spend > 0) {
            spends.push([acctId, spend])
            totalSpend += spend
          }
        }
        state.creditSpending = totalSpend

        if (totalSpend > 0) {
          const funded = clamp(state.available + totalSpend, 0, totalSpend)
          state.creditOverspending = totalSpend - funded

          // Attribute the funded money to each card by its share of the spend,
          // giving the last card the rounding remainder so nothing is lost.
          let distributed = 0
          spends.forEach(([acctId, spend], idx) => {
            const share =
              idx === spends.length - 1
                ? funded - distributed
                : Math.round((funded * spend) / totalSpend)
            distributed += share
            if (share !== 0) paymentInflow.set(acctId, (paymentInflow.get(acctId) ?? 0) + share)
          })
        }
      }

      if (state.available < 0) {
        state.cashOverspending = -state.available - state.creditOverspending
      }

      states.set(cat.id, state)
    }

    // --- credit card payment categories --------------------------------
    for (const cat of paymentCategories) {
      const acctId = accountByPaymentCategory.get(cat.id)!
      const state = emptyState(cat.id, month)
      const prev = prevStates.get(cat.id)
      state.carriedOver = prev ? carryFrom(prev) : 0
      state.assigned = assignedThisMonth.get(cat.id) ?? 0

      const funded = paymentInflow.get(acctId) ?? 0
      const paid = cardPayments.get(month)?.get(acctId) ?? 0
      // Direct spending categorised straight to the payment category (rare,
      // but possible via interest charges) still counts.
      const direct = monthActivity.get(cat.id) ?? 0

      state.activity = funded - paid + direct
      state.available = state.carriedOver + state.assigned + state.activity
      // A payment always comes out of cash, so payment categories can only
      // ever be overspent with cash.
      if (state.available < 0) state.cashOverspending = -state.available

      states.set(cat.id, state)
    }

    // --- goals ----------------------------------------------------------
    for (const cat of budgetCategories) {
      const state = states.get(cat.id)
      if (!state || !cat.goal) continue
      const debtBalance =
        cat.goal.type === 'debt' && cat.linkedAccountId
          ? Math.abs(Math.min(0, accountBalanceThrough(transactions, cat.linkedAccountId, month)))
          : undefined
      const result = evaluateGoal(cat.goal, {
        month,
        carriedOver: state.carriedOver,
        assigned: state.assigned,
        activity: state.activity,
        debtBalance,
      })
      state.goalTarget = result.target
      state.goalUnderfunded = result.underfunded
      state.goalPercent = result.percent
    }

    /* ---------------- month summary ---------------- */

    let assignedTotal = 0
    for (const s of states.values()) assignedTotal += s.assigned

    let cashOverspendingLastMonth = 0
    for (const s of prevStates.values()) cashOverspendingLastMonth += s.cashOverspending

    let activityTotal = 0
    let totalAvailable = 0
    for (const s of states.values()) {
      activityTotal += s.activity
      if (s.available > 0) totalAvailable += s.available
    }

    const leftOver = runningReadyToAssign
    const monthIncome = income.get(month) ?? 0
    const readyToAssign = leftOver + monthIncome - assignedTotal - cashOverspendingLastMonth
    runningReadyToAssign = readyToAssign

    summaries.set(month, {
      month,
      income: monthIncome,
      assigned: assignedTotal,
      activity: activityTotal,
      leftOverFromLastMonth: leftOver,
      cashOverspendingLastMonth,
      readyToAssign,
      totalAvailable,
    })

    categoryStates.set(month, states)
    prevStates = states
  }

  /* ---------------- money parked in future months ---------------- */

  const assignedAfter = new Map<MonthKey, Cents>()
  {
    const totals = months.map((m) => {
      let sum = 0
      for (const s of categoryStates.get(m)!.values()) sum += s.assigned
      return sum
    })
    let suffix = 0
    for (let i = months.length - 1; i >= 0; i--) {
      assignedAfter.set(months[i], suffix)
      suffix += totals[i]
    }
  }

  return { months, categoryStates, summaries, uncategorizedCount, assignedAfter }
}

/**
 * What a category hands to the next month. Positive balances roll over in
 * full; unfunded credit spending rolls over as debt; cash overspending does
 * not roll over here — it is taken out of Ready to Assign instead.
 */
function carryFrom(prev: CategoryMonthState): Cents {
  if (prev.available >= 0) return prev.available
  // `|| 0` keeps a fully cash-overspent category from carrying -0 forward.
  return -prev.creditOverspending || 0
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n)

/** Account balance including every transaction up to the end of `month`. */
function accountBalanceThrough(transactions: Transaction[], accountId: Id, month: MonthKey): Cents {
  let sum = 0
  for (const t of transactions) {
    if (t.deleted || t.accountId !== accountId) continue
    if (monthDiff(t.month || t.date.slice(0, 7), month) < 0) continue
    sum += t.amount
  }
  return sum
}

/* ------------------------------------------------------------------ */
/* Account balances                                                    */
/* ------------------------------------------------------------------ */

export interface AccountBalance {
  accountId: Id
  cleared: Cents
  uncleared: Cents
  working: Cents
  /** Balance counting only transactions dated today or earlier. */
  todayBalance: Cents
}

export function computeAccountBalances(
  accounts: Account[],
  transactions: Transaction[],
  asOf: string,
): Map<Id, AccountBalance> {
  const out = new Map<Id, AccountBalance>()
  for (const a of accounts) {
    out.set(a.id, { accountId: a.id, cleared: 0, uncleared: 0, working: 0, todayBalance: 0 })
  }
  for (const t of transactions) {
    if (t.deleted) continue
    const b = out.get(t.accountId)
    if (!b) continue
    if (t.cleared === 'uncleared') b.uncleared += t.amount
    else b.cleared += t.amount
    b.working += t.amount
    if (t.date <= asOf) b.todayBalance += t.amount
  }
  return out
}

/** Net worth split into what you own and what you owe, as of a date. */
export function computeNetWorth(
  accounts: Account[],
  transactions: Transaction[],
  asOf: string,
): { assets: Cents; debts: Cents; net: Cents } {
  const live = new Set(accounts.filter((a) => !a.deleted).map((a) => a.id))
  const totals = new Map<Id, Cents>()
  for (const t of transactions) {
    if (t.deleted || !live.has(t.accountId) || t.date > asOf) continue
    totals.set(t.accountId, (totals.get(t.accountId) ?? 0) + t.amount)
  }
  let assets = 0
  let debts = 0
  for (const [, balance] of totals) {
    if (balance >= 0) assets += balance
    else debts += balance
  }
  return { assets, debts, net: assets + debts }
}
