import { describe, expect, it, beforeEach } from 'vitest'
import { computeBudget } from '../engine'
import { computeAgeOfMoney } from '../ageOfMoney'
import { evaluateGoal } from '../goals'
import { account, category, entry, resetIds, transfer, txn } from './helpers'
import type { Category } from '../../types'

const THROUGH = '2025-04'

beforeEach(resetIds)

function inflowCategory(): Category {
  return category('Inflow: Ready to Assign', { isInflow: true })
}

describe('Ready to Assign', () => {
  it('is income minus what has been assigned', () => {
    const checking = account('Checking')
    const inflow = inflowCategory()
    const groceries = category('Groceries')

    const result = computeBudget({
      accounts: [checking],
      categories: [inflow, groceries],
      transactions: [txn(checking.id, '2025-01-05', 300_000, { categoryId: inflow.id })],
      entries: [entry('2025-01', groceries.id, 100_000)],
      throughMonth: THROUGH,
    })

    expect(result.summaries.get('2025-01')!.readyToAssign).toBe(200_000)
    expect(result.summaries.get('2025-01')!.income).toBe(300_000)
  })

  it('carries leftover money into the next month', () => {
    const checking = account('Checking')
    const inflow = inflowCategory()
    const rent = category('Rent')

    const result = computeBudget({
      accounts: [checking],
      categories: [inflow, rent],
      transactions: [txn(checking.id, '2025-01-05', 300_000, { categoryId: inflow.id })],
      entries: [entry('2025-01', rent.id, 100_000)],
      throughMonth: THROUGH,
    })

    expect(result.summaries.get('2025-02')!.leftOverFromLastMonth).toBe(200_000)
    expect(result.summaries.get('2025-02')!.readyToAssign).toBe(200_000)
  })

  it('goes negative when more is assigned than exists', () => {
    const checking = account('Checking')
    const inflow = inflowCategory()
    const fun = category('Fun')

    const result = computeBudget({
      accounts: [checking],
      categories: [inflow, fun],
      transactions: [txn(checking.id, '2025-01-05', 50_000, { categoryId: inflow.id })],
      entries: [entry('2025-01', fun.id, 80_000)],
      throughMonth: THROUGH,
    })

    expect(result.summaries.get('2025-01')!.readyToAssign).toBe(-30_000)
  })

  it('does not let money assigned to a future month reduce this month', () => {
    const checking = account('Checking')
    const inflow = inflowCategory()
    const fun = category('Fun')

    const result = computeBudget({
      accounts: [checking],
      categories: [inflow, fun],
      transactions: [txn(checking.id, '2025-01-05', 100_000, { categoryId: inflow.id })],
      entries: [entry('2025-02', fun.id, 40_000)],
      throughMonth: THROUGH,
    })

    expect(result.summaries.get('2025-01')!.readyToAssign).toBe(100_000)
    expect(result.assignedAfter.get('2025-01')).toBe(40_000)
    expect(result.summaries.get('2025-02')!.readyToAssign).toBe(60_000)
  })
})

describe('category rollover', () => {
  it('rolls a positive balance forward untouched', () => {
    const checking = account('Checking')
    const inflow = inflowCategory()
    const gas = category('Gas')

    const result = computeBudget({
      accounts: [checking],
      categories: [inflow, gas],
      transactions: [
        txn(checking.id, '2025-01-05', 500_000, { categoryId: inflow.id }),
        txn(checking.id, '2025-01-10', -3_000, { categoryId: gas.id }),
      ],
      entries: [entry('2025-01', gas.id, 10_000)],
      throughMonth: THROUGH,
    })

    const jan = result.categoryStates.get('2025-01')!.get(gas.id)!
    expect(jan.activity).toBe(-3_000)
    expect(jan.available).toBe(7_000)

    const feb = result.categoryStates.get('2025-02')!.get(gas.id)!
    expect(feb.carriedOver).toBe(7_000)
    expect(feb.available).toBe(7_000)
  })

  it('takes cash overspending out of next month Ready to Assign and resets the category', () => {
    const checking = account('Checking')
    const inflow = inflowCategory()
    const dining = category('Dining')

    const result = computeBudget({
      accounts: [checking],
      categories: [inflow, dining],
      transactions: [
        txn(checking.id, '2025-01-05', 500_000, { categoryId: inflow.id }),
        txn(checking.id, '2025-01-20', -15_000, { categoryId: dining.id }),
      ],
      entries: [entry('2025-01', dining.id, 10_000)],
      throughMonth: THROUGH,
    })

    const jan = result.categoryStates.get('2025-01')!.get(dining.id)!
    expect(jan.available).toBe(-5_000)
    expect(jan.cashOverspending).toBe(5_000)
    expect(jan.creditOverspending).toBe(0)

    const feb = result.categoryStates.get('2025-02')!.get(dining.id)!
    expect(feb.carriedOver).toBe(0)

    const febSummary = result.summaries.get('2025-02')!
    expect(febSummary.cashOverspendingLastMonth).toBe(5_000)
    // 500,000 income - 10,000 assigned = 490,000 left over, minus the overspend.
    expect(febSummary.readyToAssign).toBe(485_000)
  })
})

describe('credit cards', () => {
  it('moves funded credit spending into the card payment category', () => {
    const checking = account('Checking')
    const card = account('Visa', 'creditCard')
    const payment = category('Visa Payment', { linkedAccountId: card.id })
    card.paymentCategoryId = payment.id
    const inflow = inflowCategory()
    const groceries = category('Groceries')

    const result = computeBudget({
      accounts: [checking, card],
      categories: [inflow, groceries, payment],
      transactions: [
        txn(checking.id, '2025-01-01', 500_000, { categoryId: inflow.id }),
        txn(card.id, '2025-01-10', -8_000, { categoryId: groceries.id }),
      ],
      entries: [entry('2025-01', groceries.id, 10_000)],
      throughMonth: THROUGH,
    })

    const g = result.categoryStates.get('2025-01')!.get(groceries.id)!
    expect(g.activity).toBe(-8_000)
    expect(g.available).toBe(2_000)
    expect(g.creditSpending).toBe(8_000)
    expect(g.creditOverspending).toBe(0)

    const p = result.categoryStates.get('2025-01')!.get(payment.id)!
    expect(p.activity).toBe(8_000)
    expect(p.available).toBe(8_000)
  })

  it('rolls unfunded credit spending forward as a negative balance', () => {
    const checking = account('Checking')
    const card = account('Visa', 'creditCard')
    const payment = category('Visa Payment', { linkedAccountId: card.id })
    card.paymentCategoryId = payment.id
    const inflow = inflowCategory()
    const shopping = category('Shopping')

    const result = computeBudget({
      accounts: [checking, card],
      categories: [inflow, shopping, payment],
      transactions: [
        txn(checking.id, '2025-01-01', 500_000, { categoryId: inflow.id }),
        txn(card.id, '2025-01-10', -30_000, { categoryId: shopping.id }),
      ],
      entries: [entry('2025-01', shopping.id, 10_000)],
      throughMonth: THROUGH,
    })

    const jan = result.categoryStates.get('2025-01')!.get(shopping.id)!
    expect(jan.available).toBe(-20_000)
    expect(jan.creditOverspending).toBe(20_000)
    expect(jan.cashOverspending).toBe(0)

    // Only the funded $100 makes it to the payment category.
    expect(result.categoryStates.get('2025-01')!.get(payment.id)!.available).toBe(10_000)

    // Credit overspending stays with the category rather than hitting RTA.
    const feb = result.categoryStates.get('2025-02')!.get(shopping.id)!
    expect(feb.carriedOver).toBe(-20_000)
    expect(result.summaries.get('2025-02')!.cashOverspendingLastMonth).toBe(0)
  })

  it('splits mixed cash and credit overspending correctly', () => {
    const checking = account('Checking')
    const card = account('Visa', 'creditCard')
    const payment = category('Visa Payment', { linkedAccountId: card.id })
    card.paymentCategoryId = payment.id
    const inflow = inflowCategory()
    const fun = category('Fun')

    const result = computeBudget({
      accounts: [checking, card],
      categories: [inflow, fun, payment],
      transactions: [
        txn(checking.id, '2025-01-01', 500_000, { categoryId: inflow.id }),
        txn(checking.id, '2025-01-05', -12_000, { categoryId: fun.id }),
        txn(card.id, '2025-01-10', -5_000, { categoryId: fun.id }),
      ],
      entries: [entry('2025-01', fun.id, 10_000)],
      throughMonth: THROUGH,
    })

    const jan = result.categoryStates.get('2025-01')!.get(fun.id)!
    // 10,000 assigned - 12,000 cash - 5,000 credit = -7,000
    expect(jan.available).toBe(-7_000)
    // The whole card charge is unfunded, the remaining 2,000 came out of cash.
    expect(jan.creditOverspending).toBe(5_000)
    expect(jan.cashOverspending).toBe(2_000)
    expect(result.categoryStates.get('2025-01')!.get(payment.id)!.available).toBe(0)
    expect(result.categoryStates.get('2025-02')!.get(fun.id)!.carriedOver).toBe(-5_000)
    expect(result.summaries.get('2025-02')!.cashOverspendingLastMonth).toBe(2_000)
  })

  it('spends the payment category when the card is paid', () => {
    const checking = account('Checking')
    const card = account('Visa', 'creditCard')
    const payment = category('Visa Payment', { linkedAccountId: card.id })
    card.paymentCategoryId = payment.id
    const inflow = inflowCategory()
    const groceries = category('Groceries')

    const result = computeBudget({
      accounts: [checking, card],
      categories: [inflow, groceries, payment],
      transactions: [
        txn(checking.id, '2025-01-01', 500_000, { categoryId: inflow.id }),
        txn(card.id, '2025-01-10', -8_000, { categoryId: groceries.id }),
        ...transfer(checking.id, card.id, '2025-01-28', 8_000),
      ],
      entries: [entry('2025-01', groceries.id, 10_000)],
      throughMonth: THROUGH,
    })

    const p = result.categoryStates.get('2025-01')!.get(payment.id)!
    expect(p.activity).toBe(0)
    expect(p.available).toBe(0)
    // The transfer is not spending, so it never touches Ready to Assign.
    expect(result.summaries.get('2025-01')!.readyToAssign).toBe(490_000)
  })

  it('treats a credit card refund as money leaving the payment category', () => {
    const checking = account('Checking')
    const card = account('Visa', 'creditCard')
    const payment = category('Visa Payment', { linkedAccountId: card.id })
    card.paymentCategoryId = payment.id
    const inflow = inflowCategory()
    const shopping = category('Shopping')

    const result = computeBudget({
      accounts: [checking, card],
      categories: [inflow, shopping, payment],
      transactions: [
        txn(checking.id, '2025-01-01', 500_000, { categoryId: inflow.id }),
        txn(card.id, '2025-01-10', -8_000, { categoryId: shopping.id }),
        txn(card.id, '2025-01-20', 3_000, { categoryId: shopping.id }),
      ],
      entries: [entry('2025-01', shopping.id, 10_000)],
      throughMonth: THROUGH,
    })

    const s = result.categoryStates.get('2025-01')!.get(shopping.id)!
    expect(s.available).toBe(5_000)
    // 8,000 funded in, 3,000 refunded back out.
    expect(result.categoryStates.get('2025-01')!.get(payment.id)!.available).toBe(5_000)
  })
})

describe('off-budget accounts', () => {
  it('ignores tracking account activity in the budget', () => {
    const checking = account('Checking')
    const brokerage = account('Brokerage', 'investment')
    const inflow = inflowCategory()

    const result = computeBudget({
      accounts: [checking, brokerage],
      categories: [inflow],
      transactions: [
        txn(checking.id, '2025-01-01', 100_000, { categoryId: inflow.id }),
        txn(brokerage.id, '2025-01-15', 250_000, { categoryId: inflow.id }),
      ],
      entries: [],
      throughMonth: THROUGH,
    })

    expect(result.summaries.get('2025-01')!.income).toBe(100_000)
  })
})

describe('splits', () => {
  it('applies each leg of a split to its own category', () => {
    const checking = account('Checking')
    const inflow = inflowCategory()
    const groceries = category('Groceries')
    const household = category('Household')

    const split = txn(checking.id, '2025-01-12', -10_000, {
      subtransactions: [
        { id: 's1', amount: -6_000, categoryId: groceries.id, memo: '' },
        { id: 's2', amount: -4_000, categoryId: household.id, memo: '' },
      ],
    })

    const result = computeBudget({
      accounts: [checking],
      categories: [inflow, groceries, household],
      transactions: [txn(checking.id, '2025-01-01', 500_000, { categoryId: inflow.id }), split],
      entries: [entry('2025-01', groceries.id, 10_000), entry('2025-01', household.id, 10_000)],
      throughMonth: THROUGH,
    })

    expect(result.categoryStates.get('2025-01')!.get(groceries.id)!.activity).toBe(-6_000)
    expect(result.categoryStates.get('2025-01')!.get(household.id)!.activity).toBe(-4_000)
  })
})

describe('age of money', () => {
  it('reports how long spent dollars sat around', () => {
    const checking = account('Checking')
    const inflow = inflowCategory()
    const food = category('Food')

    const result = computeAgeOfMoney(
      [checking],
      [
        txn(checking.id, '2025-01-01', 100_000, { categoryId: inflow.id }),
        txn(checking.id, '2025-02-01', -50_000, { categoryId: food.id }),
      ],
    )

    expect(result.days).toBe(31)
  })

  it('ignores transfers between your own accounts', () => {
    const checking = account('Checking')
    const savings = account('Savings', 'savings')
    const inflow = inflowCategory()
    const food = category('Food')

    const result = computeAgeOfMoney(
      [checking, savings],
      [
        txn(checking.id, '2025-01-01', 100_000, { categoryId: inflow.id }),
        ...transfer(checking.id, savings.id, '2025-01-15', 40_000),
        txn(checking.id, '2025-01-31', -20_000, { categoryId: food.id }),
      ],
    )

    expect(result.days).toBe(30)
  })
})

describe('debt goals', () => {
  it("size the goal from the card's balance at the end of each month", () => {
    const card = account('Visa', 'creditCard')
    const payment = category('Visa', { linkedAccountId: card.id })
    card.paymentCategoryId = payment.id
    payment.goal = { type: 'debt', amount: 0, startMonth: '2025-01', targetMonth: '2025-12' }
    const inflow = inflowCategory()
    const dining = category('Dining')

    // Charges and a payment in different months, plus a deleted charge that
    // must not count, so each month's balance is different.
    const transactions = [
      txn(card.id, '2025-01-10', -40_000, { categoryId: dining.id }),
      txn(card.id, '2025-02-15', -25_000, { categoryId: dining.id }),
      txn(card.id, '2025-03-01', 30_000, { transferAccountId: null }),
      { ...txn(card.id, '2025-03-20', -99_999, { categoryId: dining.id }), deleted: true },
    ]
    const result = computeBudget({ accounts: [card], categories: [inflow, dining, payment], transactions, entries: [], throughMonth: '2025-04' })

    const owedThrough = (month: string) =>
      Math.abs(Math.min(0, transactions.filter((t) => !t.deleted && t.date.slice(0, 7) <= month).reduce((s, t) => s + t.amount, 0)))
    const expected = { '2025-01': 40_000, '2025-02': 65_000, '2025-03': 35_000, '2025-04': 35_000 }

    for (const [month, owed] of Object.entries(expected)) {
      expect(owedThrough(month)).toBe(owed)
      const state = result.categoryStates.get(month)!.get(payment.id)!
      const want = evaluateGoal(payment.goal!, {
        month,
        carriedOver: state.carriedOver,
        assigned: state.assigned,
        activity: state.activity,
        debtBalance: owed,
      })
      expect(state.goalTarget).toBe(want.target)
      expect(state.goalUnderfunded).toBe(want.underfunded)
    }
  })
})
