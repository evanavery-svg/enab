import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { computeBudget, computeAccountBalances, type AccountBalance, type BudgetResult } from '../budget/engine'
import { addMonths, today } from '../lib/dates'
import { DEFAULT_FORMAT, formatMoney, type MoneyFormat } from '../lib/money'
import { defaultSettings } from '../db/seed'
import { useUi } from '../state/ui'
import type {
  Account,
  BudgetEntry,
  Category,
  CategoryGroup,
  Cents,
  Id,
  MonthNote,
  Payee,
  ScheduledTransaction,
  Settings,
  Transaction,
} from '../types'

export interface DataContextValue {
  ready: boolean
  settings: Settings
  accounts: Account[]
  /** Accounts that are neither closed nor deleted, in sort order. */
  openAccounts: Account[]
  accountById: Map<Id, Account>
  groups: CategoryGroup[]
  categories: Category[]
  categoryById: Map<Id, Category>
  /** Visible, non-internal categories grouped for the budget table. */
  payees: Payee[]
  payeeById: Map<Id, Payee>
  transactions: Transaction[]
  scheduled: ScheduledTransaction[]
  entries: BudgetEntry[]
  monthNotes: Map<string, string>
  budget: BudgetResult
  balances: Map<Id, AccountBalance>
  format: MoneyFormat
  money: (cents: Cents, opts?: Parameters<typeof formatMoney>[2]) => string
}

const DataContext = createContext<DataContextValue | null>(null)

const EMPTY: never[] = []

export function DataProvider({ children }: { children: ReactNode }) {
  const month = useUi((s) => s.month)

  const settings = useLiveQuery(() => db.settings.get('settings'), [])
  const accounts = useLiveQuery(() => db.accounts.orderBy('sortOrder').toArray(), [])
  const groups = useLiveQuery(() => db.categoryGroups.orderBy('sortOrder').toArray(), [])
  const categories = useLiveQuery(() => db.categories.orderBy('sortOrder').toArray(), [])
  const payees = useLiveQuery(() => db.payees.toArray(), [])
  const transactions = useLiveQuery(() => db.transactions.toArray(), [])
  const scheduled = useLiveQuery(() => db.scheduled.toArray(), [])
  const entries = useLiveQuery(() => db.budgetEntries.toArray(), [])
  const monthNoteRows = useLiveQuery(() => db.monthNotes.toArray(), [])

  const value = useMemo<DataContextValue>(() => {
    const s = settings ?? defaultSettings()
    const accountList = (accounts ?? EMPTY).filter((a) => !a.deleted)
    const categoryList = (categories ?? EMPTY).filter((c) => !c.deleted)
    const groupList = (groups ?? EMPTY).filter((g) => !g.deleted)
    const payeeList = (payees ?? EMPTY).filter((p) => !p.deleted)
    const txnList = (transactions ?? EMPTY).filter((t) => !t.deleted)
    const scheduledList = (scheduled ?? EMPTY).filter((x) => !x.deleted)
    const entryList = entries ?? EMPTY

    const format: MoneyFormat = {
      currencySymbol: s.currencySymbol ?? DEFAULT_FORMAT.currencySymbol,
      currencyCode: s.currencyCode ?? DEFAULT_FORMAT.currencyCode,
      symbolPosition: s.symbolPosition ?? DEFAULT_FORMAT.symbolPosition,
      decimalSeparator: s.decimalSeparator ?? DEFAULT_FORMAT.decimalSeparator,
      groupSeparator: s.groupSeparator ?? DEFAULT_FORMAT.groupSeparator,
      hideDecimals: s.hideDecimals ?? DEFAULT_FORMAT.hideDecimals,
    }

    const budget = computeBudget({
      accounts: accountList,
      categories: categoryList,
      transactions: txnList,
      entries: entryList,
      // Always reach a month past the one being viewed so "next month" data
      // (and its rollover) is available without a second pass.
      throughMonth: addMonths(month, 1),
    })

    return {
      ready: !!settings && !!accounts && !!categories && !!transactions,
      settings: s,
      accounts: accountList,
      openAccounts: accountList.filter((a) => !a.closed),
      accountById: new Map(accountList.map((a) => [a.id, a])),
      groups: groupList,
      categories: categoryList,
      categoryById: new Map(categoryList.map((c) => [c.id, c])),
      payees: payeeList,
      payeeById: new Map(payeeList.map((p) => [p.id, p])),
      transactions: txnList,
      scheduled: scheduledList,
      entries: entryList,
      monthNotes: new Map((monthNoteRows ?? EMPTY).map((n: MonthNote) => [n.month, n.note])),
      budget,
      balances: computeAccountBalances(accountList, txnList, today()),
      format,
      money: (cents, opts) => formatMoney(cents, format, opts),
    }
  }, [settings, accounts, groups, categories, payees, transactions, scheduled, entries, monthNoteRows, month])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used inside <DataProvider>')
  return ctx
}

/** Just the money formatter, for components that need nothing else. */
export function useMoney() {
  return useData().money
}
