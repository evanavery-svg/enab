import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, clearAllTables } from '../../db/db'
import { applyRuleToExisting, createAccount, deletePayeeRule, ensureInitialized, importTransactions, savePayeeRule } from '../../db/actions'
import { exportSyncPacket, mergeImport } from '../sync'

beforeEach(async () => {
  await clearAllTables()
  await ensureInitialized()
})

const cat = async (name: string) => (await db.categories.toArray()).find((c) => c.name === name)!.id
const row = (payee: string, amount = -550, date = '2026-10-02') => ({ date, amount, payee, memo: '', categoryId: null })
const payeeNames = async () => (await db.payees.toArray()).filter((p) => !p.deleted && !p.transferAccountId && p.name !== 'Starting Balance').map((p) => p.name).sort()

describe('import rules', () => {
  it('rename and categorize rows as they come in, ahead of any guess', async () => {
    const account = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    const coffee = await cat('Coffee')
    const eatingOut = await cat('Eating Out')
    await savePayeeRule({ match: 'blue bottle', matchType: 'contains', renameTo: 'Blue Bottle', categoryId: coffee })

    const result = await importTransactions(account, [
      { ...row('SQ *BLUE BOTTLE 0423'), guessedCategoryId: eatingOut },
      row('BLUE BOTTLE COFFEE #12', -650, '2026-10-03'),
      row('Kroger', -4000, '2026-10-04'),
    ])
    expect(result.tidied).toBe(2)
    const txns = (await db.transactions.toArray()).filter((t) => !t.isStartingBalance)
    const blue = (await db.payees.toArray()).find((p) => p.name === 'Blue Bottle')!
    expect(txns.filter((t) => t.payeeId === blue.id).map((t) => t.categoryId)).toEqual([coffee, coffee])
    expect(await payeeNames()).toEqual(['Blue Bottle', 'Kroger'])
  })

  it('fix past transactions: one payee, one category', async () => {
    const account = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    await importTransactions(account, [row('SQ *BLUE BOTTLE 0423'), row('BLUE BOTTLE #7', -600, '2026-10-05'), row('Kroger', -100, '2026-10-06')])
    const coffee = await cat('Coffee')
    const done = await applyRuleToExisting({ match: 'blue bottle', matchType: 'contains', renameTo: 'Blue Bottle', categoryId: coffee })
    expect(done).toEqual({ payees: 2, transactions: 2 })
    expect(await payeeNames()).toEqual(['Blue Bottle', 'Kroger'])
    const blue = (await db.payees.toArray()).find((p) => p.name === 'Blue Bottle')!
    expect(blue.lastCategoryId).toBe(coffee)
  })

  it('sync between devices, deletions included', async () => {
    const id = await savePayeeRule({ match: 'uber', matchType: 'startsWith', renameTo: 'Uber', categoryId: null })
    const before = await exportSyncPacket()
    await new Promise((r) => setTimeout(r, 2))
    await deletePayeeRule(id)
    const after = await exportSyncPacket()

    await clearAllTables()
    await ensureInitialized()
    await mergeImport(before)
    expect((await db.payeeRules.get(id))?.deleted).toBe(false)
    await mergeImport(after)
    expect((await db.payeeRules.get(id))?.deleted).toBe(true)
  })
})
