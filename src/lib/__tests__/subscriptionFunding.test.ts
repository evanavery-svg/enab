import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, clearAllTables } from '../../db/db'
import {
  createCategory,
  deleteSubscription,
  ensureInitialized,
  fundSubscriptionsFrom,
  saveSubscription,
  setCategoryGoal,
  setSubscriptionStatus,
  stopFundingSubscriptions,
} from '../../db/actions'

const sub = { amountIsEstimate: false, billedThrough: '', status: 'active' as const }

beforeEach(async () => {
  await clearAllTables()
  await ensureInitialized()
})

async function category(name: string) {
  return (await db.categories.toArray()).find((c) => c.name === name)!
}

describe('a category that pays for subscriptions', () => {
  it('follows subscriptions as they are added, cancelled and removed', async () => {
    const claude = await saveSubscription({ ...sub, name: 'Claude', amount: 2299, cadence: 'monthly', billingDay: 30, billingMonth: null })
    const subsCat = await category('Subscriptions')
    await fundSubscriptionsFrom(subsCat.id)
    expect((await category('Subscriptions')).goal?.bills).toHaveLength(1)

    const ps = await saveSubscription({ ...sub, name: 'PlayStation Plus', amount: 7999, cadence: 'yearly', billingDay: 14, billingMonth: 10 })
    let goal = (await category('Subscriptions')).goal!
    expect(goal.bills!.map((b) => b.name)).toEqual(['Claude', 'PlayStation Plus'])
    expect(goal.amount).toBe(Math.round((2299 * 12 + 7999) / 12))

    await setSubscriptionStatus(claude, 'cancelled')
    goal = (await category('Subscriptions')).goal!
    expect(goal.bills!.map((b) => b.name)).toEqual(['PlayStation Plus'])

    await deleteSubscription(ps)
    expect((await category('Subscriptions')).goal?.bills).toEqual([])
  })

  it('moves to another category, leaving the first without a target', async () => {
    await saveSubscription({ ...sub, name: 'Claude', amount: 2299, cadence: 'monthly', billingDay: 30, billingMonth: null })
    const first = await category('Subscriptions')
    await fundSubscriptionsFrom(first.id)
    const other = await createCategory(first.groupId, 'Streaming')
    await fundSubscriptionsFrom(other)
    expect((await category('Subscriptions')).goal).toBeUndefined()
    expect((await db.categories.get(other))?.goal?.source).toBe('subscriptions')

    await stopFundingSubscriptions()
    expect((await db.categories.get(other))?.goal).toBeUndefined()
  })

  it('stops following once the target is edited by hand', async () => {
    await saveSubscription({ ...sub, name: 'Claude', amount: 2299, cadence: 'monthly', billingDay: 30, billingMonth: null })
    const cat = await category('Subscriptions')
    await fundSubscriptionsFrom(cat.id)
    await setCategoryGoal(cat.id, { type: 'need', amount: 5000, cadence: 'monthly', startMonth: '2026-10' })
    await saveSubscription({ ...sub, name: 'Spotify', amount: 1199, cadence: 'monthly', billingDay: 3, billingMonth: null })
    expect((await category('Subscriptions')).goal?.amount).toBe(5000)
  })
})
