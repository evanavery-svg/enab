import { describe, expect, it, beforeEach } from 'vitest'
import { buildBudgetPlan, detectRecurring } from '../analyze'
import { computeBudget } from '../engine'
import { account, category, entry, resetIds, txn } from './helpers'
import type { Category, Payee, Transaction } from '../../types'

beforeEach(resetIds)

const inflow = (): Category => category('Inflow: Ready to Assign', { isInflow: true })

let payeeSeq = 0
function payee(name: string): Payee {
  return { id: `payee${++payeeSeq}`, name, deleted: false }
}

/** Charges on the same day-of-month across several months. */
function monthlyCharges(
  accountId: string,
  payeeId: string,
  categoryId: string,
  amount: number,
  months: string[],
  day = '05',
): Transaction[] {
  return months.map((m) => txn(accountId, `${m}-${day}`, -amount, { payeeId, categoryId }))
}

describe('detectRecurring', () => {
  it('finds a fixed monthly subscription', () => {
    const checking = account('Checking')
    const streaming = category('Subscriptions')
    const netflix = payee('Streamly')

    const result = detectRecurring({
      accounts: [checking],
      categories: [inflow(), streaming],
      payees: [netflix],
      transactions: monthlyCharges(checking.id, netflix.id, streaming.id, 1_799, [
        '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
      ]),
      asOf: '2026-06-20',
    })

    expect(result).toHaveLength(1)
    const s = result[0]
    expect(s.payeeName).toBe('Streamly')
    expect(s.cadence).toBe('monthly')
    expect(s.amount).toBe(1_799)
    expect(s.amountKind).toBe('fixed')
    expect(s.isSubscription).toBe(true)
    expect(s.active).toBe(true)
    expect(s.monthlyCost).toBe(1_799)
    expect(s.yearlyCost).toBe(21_588)
    expect(s.nextExpected).toBe('2026-07-05')
    expect(s.confidence).toBeGreaterThan(0.9)
  })

  it('needs at least three occurrences', () => {
    const checking = account('Checking')
    const cat = category('Subscriptions')
    const p = payee('Twice Only')

    const result = detectRecurring({
      accounts: [checking],
      categories: [inflow(), cat],
      payees: [p],
      transactions: monthlyCharges(checking.id, p.id, cat.id, 1_000, ['2026-01', '2026-02']),
      asOf: '2026-03-01',
    })
    expect(result).toHaveLength(0)
  })

  it('recognises weekly and yearly rhythms', () => {
    const checking = account('Checking')
    const cat = category('Fun')
    const weekly = payee('Corner Coffee')
    const yearly = payee('Domain Co')

    const result = detectRecurring({
      accounts: [checking],
      categories: [inflow(), cat],
      payees: [weekly, yearly],
      transactions: [
        ...['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02'].map((d) =>
          txn(checking.id, d, -500, { payeeId: weekly.id, categoryId: cat.id }),
        ),
        ...['2024-03-01', '2025-03-01', '2026-03-01'].map((d) =>
          txn(checking.id, d, -1_200, { payeeId: yearly.id, categoryId: cat.id }),
        ),
      ],
      asOf: '2026-03-05',
    })

    const byName = new Map(result.map((r) => [r.payeeName, r]))
    expect(byName.get('Corner Coffee')!.cadence).toBe('weekly')
    // A $5 weekly habit costs about $21.67 a month.
    expect(byName.get('Corner Coffee')!.monthlyCost).toBe(2_167)
    expect(byName.get('Domain Co')!.cadence).toBe('yearly')
    expect(byName.get('Domain Co')!.monthlyCost).toBe(100)
  })

  it('flags a variable but regular bill as recurring, not a subscription', () => {
    const checking = account('Checking')
    const cat = category('Electric')
    const utility = payee('City Power')

    const result = detectRecurring({
      accounts: [checking],
      categories: [inflow(), cat],
      payees: [utility],
      transactions: [
        txn(checking.id, '2026-01-05', -8_000, { payeeId: utility.id, categoryId: cat.id }),
        txn(checking.id, '2026-02-05', -14_500, { payeeId: utility.id, categoryId: cat.id }),
        txn(checking.id, '2026-03-05', -9_200, { payeeId: utility.id, categoryId: cat.id }),
        txn(checking.id, '2026-04-05', -12_100, { payeeId: utility.id, categoryId: cat.id }),
      ],
      asOf: '2026-04-20',
    })

    expect(result[0].cadence).toBe('monthly')
    expect(result[0].amountKind).toBe('variable')
    expect(result[0].isSubscription).toBe(false)
  })

  it('ignores irregular shopping at the same place', () => {
    const checking = account('Checking')
    const cat = category('Groceries')
    const shop = payee('Green Grocer')

    const result = detectRecurring({
      accounts: [checking],
      categories: [inflow(), cat],
      payees: [shop],
      transactions: [
        txn(checking.id, '2026-01-03', -4_210, { payeeId: shop.id, categoryId: cat.id }),
        txn(checking.id, '2026-01-04', -1_180, { payeeId: shop.id, categoryId: cat.id }),
        txn(checking.id, '2026-02-19', -9_940, { payeeId: shop.id, categoryId: cat.id }),
        txn(checking.id, '2026-02-27', -2_030, { payeeId: shop.id, categoryId: cat.id }),
        txn(checking.id, '2026-05-06', -6_600, { payeeId: shop.id, categoryId: cat.id }),
      ],
      asOf: '2026-05-20',
    })
    expect(result.filter((r) => r.isSubscription)).toHaveLength(0)
  })

  it('marks a cancelled subscription inactive', () => {
    const checking = account('Checking')
    const cat = category('Subscriptions')
    const gone = payee('Old Gym')

    const result = detectRecurring({
      accounts: [checking],
      categories: [inflow(), cat],
      payees: [gone],
      transactions: monthlyCharges(checking.id, gone.id, cat.id, 4_500, ['2025-01', '2025-02', '2025-03']),
      asOf: '2026-06-01',
    })

    expect(result[0].isSubscription).toBe(true)
    expect(result[0].active).toBe(false)
  })

  it('ignores income and transfers', () => {
    const checking = account('Checking')
    const savings = account('Savings', 'savings')
    const inflowCat = inflow()
    const employer = payee('Acme Corp')
    const transferPayee: Payee = { id: 'payeeT', name: 'Transfer : Savings', transferAccountId: savings.id, deleted: false }

    const result = detectRecurring({
      accounts: [checking, savings],
      categories: [inflowCat],
      payees: [employer, transferPayee],
      transactions: [
        ...['2026-01-01', '2026-02-01', '2026-03-01'].map((d) =>
          txn(checking.id, d, 420_000, { payeeId: employer.id, categoryId: inflowCat.id }),
        ),
        ...['2026-01-02', '2026-02-02', '2026-03-02'].map((d) =>
          txn(checking.id, d, -50_000, {
            payeeId: transferPayee.id,
            transferAccountId: savings.id,
            transferTransactionId: 'x',
          }),
        ),
      ],
      asOf: '2026-03-10',
    })
    expect(result).toHaveLength(0)
  })
})

describe('buildBudgetPlan', () => {
  function scenario() {
    const checking = account('Checking')
    const inflowCat = inflow()
    const groceries = category('Groceries', { groupId: 'g1' })
    const subs = category('Subscriptions', { groupId: 'g1' })
    const gifts = category('Gifts', { groupId: 'g1' })
    const groups = [{ id: 'g1', name: 'Everyday', sortOrder: 0, hidden: false, collapsed: false, deleted: false }]
    const streamly = payee('Streamly')
    const grocer = payee('Green Grocer')

    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
    const transactions: Transaction[] = [
      ...months.map((m) => txn(checking.id, `${m}-01`, 400_000, { categoryId: inflowCat.id })),
      // A steady subscription.
      ...monthlyCharges(checking.id, streamly.id, subs.id, 1_799, months, '12'),
      // Groceries: several irregular trips a month, and one costly month.
      // Deliberately not a tidy schedule, so this is not read as recurring.
      ...[50_000, 52_000, 48_000, 51_000, 200_000, 49_000].flatMap((total, i) => {
        const days = ['03', '11', '19', '27']
        const split = [0.3, 0.25, 0.25, 0.2]
        return days.map((day, k) =>
          txn(checking.id, `${months[i]}-${day}`, -Math.round(total * split[k]), {
            payeeId: grocer.id,
            categoryId: groceries.id,
          }),
        )
      }),
      // Gifts happen twice in six months.
      txn(checking.id, '2026-02-14', -12_000, { categoryId: gifts.id }),
      txn(checking.id, '2026-05-20', -18_000, { categoryId: gifts.id }),
    ]

    const budget = computeBudget({
      accounts: [checking],
      categories: [inflowCat, groceries, subs, gifts],
      transactions,
      entries: [entry('2026-07', groceries.id, 10_000)],
      throughMonth: '2026-07',
    })

    return buildBudgetPlan({
      month: '2026-07',
      accounts: [checking],
      categories: [inflowCat, groceries, subs, gifts],
      groups,
      payees: [streamly, grocer],
      transactions,
      budget,
      asOf: '2026-07-10',
    })
  }

  it('analyses the six completed months before the target month', () => {
    const plan = scenario()
    expect(plan.monthsAnalyzed).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'])
    expect(plan.medianIncome).toBe(400_000)
  })

  it('uses the typical month, not the expensive one', () => {
    const plan = scenario()
    const groceries = plan.rows.find((r) => r.categoryName === 'Groceries')!
    // The $2,000 month must not drag the suggestion up with it.
    expect(groceries.peakMonthly).toBe(200_000)
    expect(groceries.suggested).toBe(50_500)
    expect(groceries.basis).toContain('Typical')
  })

  it('spreads occasional spending across the window', () => {
    const plan = scenario()
    const gifts = plan.rows.find((r) => r.categoryName === 'Gifts')!
    expect(gifts.monthsWithSpending).toBe(2)
    // 30,000 over six months, rounded up to whole units.
    expect(gifts.suggested).toBe(5_000)
    expect(gifts.basis).toContain('2 of 6 months')
  })

  it('reports subscriptions with their real cost', () => {
    const plan = scenario()
    expect(plan.subscriptions.map((s) => s.payeeName)).toEqual(['Streamly'])
    expect(plan.subscriptionMonthlyTotal).toBe(1_799)
    expect(plan.subscriptionYearlyTotal).toBe(21_588)

    const subs = plan.rows.find((r) => r.categoryName === 'Subscriptions')!
    expect(subs.recurringMonthly).toBe(1_799)
    expect(subs.suggested).toBe(1_800)
    expect(subs.basis).toContain('subscription')
  })

  it('reports what is already assigned so the plan can be compared', () => {
    const plan = scenario()
    const groceries = plan.rows.find((r) => r.categoryName === 'Groceries')!
    expect(groceries.currentlyAssigned).toBe(10_000)
    expect(plan.totalCurrentlyAssigned).toBe(10_000)
  })
})
