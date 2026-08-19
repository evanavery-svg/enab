import type { Category, CategoryGroup, Settings } from '../types'
import { uid } from '../lib/id'

/** Fixed ids for the rows the app itself depends on. */
export const INTERNAL_GROUP_ID = 'group-internal'
export const CREDIT_GROUP_ID = 'group-credit-payments'
export const INFLOW_CATEGORY_ID = 'category-inflow'

/**
 * The starting category set. Deliberately opinionated but small — a fresh
 * budget you can actually finish assigning on day one, rather than fifty
 * empty envelopes.
 */
const STARTER_GROUPS: { name: string; categories: string[] }[] = [
  { name: 'Bills', categories: ['Rent/Mortgage', 'Electric', 'Water', 'Internet', 'Phone', 'Insurance'] },
  { name: 'Frequent', categories: ['Groceries', 'Eating Out', 'Transportation'] },
  {
    name: 'Non-Monthly',
    categories: ['Home Maintenance', 'Auto Maintenance', 'Gifts', 'Medical', 'Clothing'],
  },
  { name: 'Goals', categories: ['Emergency Fund', 'Vacation', 'Investments'] },
  { name: 'Quality of Life', categories: ['Hobbies', 'Entertainment', 'Fitness', 'Subscriptions'] },
  { name: 'Just for Fun', categories: ['Fun Money', 'Coffee'] },
]

export function buildSeed(): { groups: CategoryGroup[]; categories: Category[] } {
  const groups: CategoryGroup[] = [
    {
      id: INTERNAL_GROUP_ID,
      name: 'Internal Master Category',
      sortOrder: -1000,
      hidden: true,
      collapsed: false,
      isInternal: true,
      deleted: false,
    },
    {
      id: CREDIT_GROUP_ID,
      name: 'Credit Card Payments',
      sortOrder: -1,
      hidden: false,
      collapsed: false,
      isSystem: true,
      deleted: false,
    },
  ]

  const categories: Category[] = [
    {
      id: INFLOW_CATEGORY_ID,
      groupId: INTERNAL_GROUP_ID,
      name: 'Inflow: Ready to Assign',
      sortOrder: 0,
      hidden: false,
      note: '',
      isInflow: true,
      deleted: false,
    },
  ]

  STARTER_GROUPS.forEach((g, gi) => {
    const groupId = uid('grp')
    groups.push({
      id: groupId,
      name: g.name,
      sortOrder: gi,
      hidden: false,
      collapsed: false,
      deleted: false,
    })
    g.categories.forEach((name, ci) => {
      categories.push({
        id: uid('cat'),
        groupId,
        name,
        sortOrder: ci,
        hidden: false,
        note: '',
        deleted: false,
      })
    })
  })

  return { groups, categories }
}

export function defaultSettings(): Settings {
  return {
    id: 'settings',
    budgetName: 'My Budget',
    currencySymbol: '$',
    currencyCode: 'USD',
    symbolPosition: 'before',
    decimalSeparator: '.',
    groupSeparator: ',',
    hideDecimals: false,
    dateFormat: 'MM/dd/yyyy',
    firstDayOfWeek: 0,
    theme: 'system',
    showRunningBalance: true,
    lockReconciled: true,
    createdAt: new Date().toISOString(),
  }
}
