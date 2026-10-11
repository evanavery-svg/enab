import type { Cents, GroceryItem } from '../types'

export interface QuickAdd {
  name: string
  quantity: string
  price: Cents | null
}

const UNITS =
  'lbs?|oz|kg|g|gal|gallons?|l|ml|dozen|doz|packs?|bags?|box(?:es)?|cans?|bottles?|jars?|bunch(?:es)?|cartons?|loaf|loaves'

/**
 * Read one line typed into the quick-add box the way people write a shopping
 * list: "milk", "2 avocados", "eggs x2", "2 lb chicken $8.99", "bread 3.49".
 * A trailing number is a price only with a currency sign or decimals, so
 * "AA batteries 4" stays a name rather than becoming $4.
 */
export function parseQuickAdd(raw: string): QuickAdd | null {
  let text = raw.trim().replace(/\s+/g, ' ')
  if (!text) return null

  let price: Cents | null = null
  const priceMatch =
    text.match(/\s+[$€£]\s?(\d{1,6}(?:[.,]\d{1,2})?)$/) ?? text.match(/\s+(\d{1,6}[.,]\d{2})$/)
  if (priceMatch) {
    price = Math.round(Number(priceMatch[1].replace(',', '.')) * 100)
    text = text.slice(0, priceMatch.index).trim()
  }

  let quantity = ''
  const trailingTimes = text.match(/\s+[x×]\s?(\d{1,3})$/i)
  const leadingTimes = text.match(/^(\d{1,3})\s?[x×]\s+/i)
  const leadingUnit = text.match(new RegExp(`^(\\d+(?:[.,]\\d+)?|½|¼)\\s?(${UNITS})\\.?\\s+`, 'i'))
  const leadingCount = text.match(/^(\d{1,3})\s+(?=\p{L})/u)
  if (trailingTimes) {
    quantity = trailingTimes[1]
    text = text.slice(0, trailingTimes.index).trim()
  } else if (leadingTimes) {
    quantity = leadingTimes[1]
    text = text.slice(leadingTimes[0].length)
  } else if (leadingUnit) {
    quantity = `${leadingUnit[1]} ${leadingUnit[2].toLowerCase()}`
    text = text.slice(leadingUnit[0].length)
  } else if (leadingCount) {
    quantity = leadingCount[1]
    text = text.slice(leadingCount[0].length)
  }

  const name = text.trim()
  // A bare price or number isn't something to buy.
  if (!/\p{L}/u.test(name)) return null
  return { name: name[0].toUpperCase() + name.slice(1), quantity, price }
}

/** Case- and spacing-insensitive key, so "Milk" and " milk" are one item. */
export const itemKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

export interface ListTotals {
  /** Estimated cost of everything still on the list, in the cart or not. */
  estimate: Cents
  /** Estimated cost of what's in the cart. */
  cart: Cents
  /** Items on the list without a price. */
  unpriced: number
  toBuy: number
  inCart: number
}

export function listTotals(items: GroceryItem[]): ListTotals {
  let estimate = 0
  let cart = 0
  let unpriced = 0
  let inCart = 0
  for (const i of items) {
    if (i.price === null) unpriced++
    else estimate += i.price
    if (i.checked) {
      inCart++
      cart += i.price ?? 0
    }
  }
  return { estimate, cart, unpriced, toBuy: items.length - inCart, inCart }
}

/**
 * Things bought before that aren't on the list now, most often bought first.
 * One-offs only appear once there are few regulars to show.
 */
export function usualItems(history: GroceryItem[], limit = 8): GroceryItem[] {
  const off = history.filter((i) => i.deleted)
  const ranked = off.sort((a, b) => b.timesAdded - a.timesAdded || (a.addedAt < b.addedAt ? 1 : -1))
  const regulars = ranked.filter((i) => i.timesAdded >= 2)
  return (regulars.length >= 3 ? regulars : ranked).slice(0, limit)
}
