import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, clearAllTables } from '../../db/db'
import { addGroceryItem, ensureInitialized, removeGroceryItems, restoreGroceryItems, updateGroceryItem } from '../../db/actions'
import { listTotals, parseQuickAdd, usualItems } from '../grocery'
import type { GroceryItem } from '../../types'

describe('parseQuickAdd', () => {
  it.each([
    ['milk', { name: 'Milk', quantity: '', price: null }],
    ['  2 avocados ', { name: 'Avocados', quantity: '2', price: null }],
    ['eggs x2', { name: 'Eggs', quantity: '2', price: null }],
    ['3x yogurt', { name: 'Yogurt', quantity: '3', price: null }],
    ['2 lb chicken $8.99', { name: 'Chicken', quantity: '2 lb', price: 899 }],
    ['bread 3.49', { name: 'Bread', quantity: '', price: 349 }],
    ['coffee $12', { name: 'Coffee', quantity: '', price: 1200 }],
    ['AA batteries 4', { name: 'AA batteries 4', quantity: '', price: null }],
    ['2% milk', { name: '2% milk', quantity: '', price: null }],
    ['1 dozen eggs', { name: 'Eggs', quantity: '1 dozen', price: null }],
  ])('%s', (input, expected) => {
    expect(parseQuickAdd(input)).toEqual(expected)
  })

  it('ignores blank lines', () => {
    expect(parseQuickAdd('   ')).toBeNull()
    expect(parseQuickAdd('$4.00')).toBeNull()
  })
})

const item = (over: Partial<GroceryItem>): GroceryItem => ({
  id: over.name ?? 'x', name: 'x', quantity: '', price: null, checked: false, timesAdded: 1,
  addedAt: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', deleted: false, ...over,
})

describe('listTotals', () => {
  it('adds up the list and the cart', () => {
    const t = listTotals([
      item({ name: 'a', price: 300 }),
      item({ name: 'b', price: 450, checked: true }),
      item({ name: 'c', checked: true }),
      item({ name: 'd' }),
    ])
    expect(t).toEqual({ estimate: 750, cart: 450, unpriced: 2, toBuy: 2, inCart: 2 })
  })
})

describe('usualItems', () => {
  it('ranks things bought often, and leaves out what is already on the list', () => {
    const history = [
      item({ name: 'Milk', timesAdded: 9, deleted: true }),
      item({ name: 'Eggs', timesAdded: 5, deleted: true }),
      item({ name: 'Bread', timesAdded: 3, deleted: true }),
      item({ name: 'Saffron', timesAdded: 1, deleted: true }),
      item({ name: 'Bananas', timesAdded: 7, deleted: false }),
    ]
    expect(usualItems(history).map((i) => i.name)).toEqual(['Milk', 'Eggs', 'Bread'])
  })

  it('falls back to recent one-offs for a new list', () => {
    const history = [
      item({ name: 'Old', deleted: true, addedAt: '2026-09-01T00:00:00Z' }),
      item({ name: 'New', deleted: true, addedAt: '2026-10-05T00:00:00Z' }),
    ]
    expect(usualItems(history).map((i) => i.name)).toEqual(['New', 'Old'])
  })
})

describe('grocery actions', () => {
  beforeEach(async () => {
    await clearAllTables()
    await ensureInitialized()
  })

  it('revives an item bought before, with its quantity and price', async () => {
    const id = await addGroceryItem({ name: 'Milk', quantity: '1 gal', price: 429 })
    await removeGroceryItems([id])
    const again = await addGroceryItem({ name: '  milk ' })
    expect(again).toBe(id)
    const row = await db.groceryItems.get(id)
    expect(row).toMatchObject({ deleted: false, quantity: '1 gal', price: 429, timesAdded: 2 })
    expect(await db.groceryItems.count()).toBe(1)
  })

  it('adding something already in the cart puts it back on the list', async () => {
    const id = await addGroceryItem({ name: 'Eggs' })
    await updateGroceryItem(id, { checked: true })
    await addGroceryItem({ name: 'eggs' })
    expect((await db.groceryItems.get(id))?.checked).toBe(false)
  })

  it('undo restores removed items as they were', async () => {
    const a = await addGroceryItem({ name: 'Apples' })
    await updateGroceryItem(a, { checked: true })
    const before = (await db.groceryItems.toArray()).filter((i) => !i.deleted)
    await removeGroceryItems([a])
    await restoreGroceryItems(before)
    expect(await db.groceryItems.get(a)).toMatchObject({ deleted: false, checked: true })
  })
})
