import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { computeBudget, computeAccountBalances, type AccountBalance, type BudgetResult } from '../budget/engine'
import { addMonths, currentMonth, today } from '../lib/dates'
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
/** One stable object, so the context doesn't churn while settings load. */
const DEFAULT_SETTINGS = defaultSettings()

/** Soft-deleted rows stay in the tables for sync; the UI never sees them. */
function live<T extends { deleted?: boolean }>(rows: T[] | undefined): T[] {
  return rows ? rows.filter((r) => !r.deleted) : EMPTY
}

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

  // Each derived value is memoised on exactly the tables it reads. Dexie only
  // re-emits a query whose table changed, so renaming a payee or switching the
  // theme no longer reruns the budget engine over every transaction.
  const s = settings ?? DEFAULT_SETTINGS
  const accountList = useMemo(() => live(accounts), [accounts])
  const categoryList = useMemo(() => live(categories), [categories])
  const groupList = useMemo(() => live(groups), [groups])
  const payeeList = useMemo(() => live(payees), [payees])
  const txnList = useMemo(() => live(transactions), [transactions])
  const scheduledList = useMemo(() => live(scheduled), [scheduled])
  const entryList = entries ?? EMPTY

  const accountMaps = useMemo(
    () => ({
      openAccounts: accountList.filter((a) => !a.closed),
      accountById: new Map(accountList.map((a) => [a.id, a])),
    }),
    [accountList],
  )
  const categoryById = useMemo(() => new Map(categoryList.map((c) => [c.id, c])), [categoryList])
  const payeeById = useMemo(() => new Map(payeeList.map((p) => [p.id, p])), [payeeList])
  const monthNotes = useMemo(
    () => new Map((monthNoteRows ?? EMPTY).map((n: MonthNote) => [n.month, n.note])),
    [monthNoteRows],
  )

  // The engine must reach a month past the one being viewed so next month's
  // rollover exists. It already covers through next month for any month up to
  // now, so only looking into the future needs to widen it — paging back
  // through history reuses the same result instead of recomputing it.
  const nextMonth = addMonths(currentMonth(), 1)
  const viewedNext = addMonths(month, 1)
  const throughMonth = viewedNext > nextMonth ? viewedNext : nextMonth

  const budget = useMemo(
    () =>
      computeBudget({
        accounts: accountList,
        categories: categoryList,
        transactions: txnList,
        entries: entryList,
        throughMonth,
      }),
    [accountList, categoryList, txnList, entryList, throughMonth],
  )
  const balances = useMemo(() => computeAccountBalances(accountList, txnList, today()), [accountList, txnList])

  const { currencySymbol, currencyCode, symbolPosition, decimalSeparator, groupSeparator, hideDecimals } = s
  const format = useMemo<MoneyFormat>(
    () => ({
      currencySymbol: currencySymbol ?? DEFAULT_FORMAT.currencySymbol,
      currencyCode: currencyCode ?? DEFAULT_FORMAT.currencyCode,
      symbolPosition: symbolPosition ?? DEFAULT_FORMAT.symbolPosition,
      decimalSeparator: decimalSeparator ?? DEFAULT_FORMAT.decimalSeparator,
      groupSeparator: groupSeparator ?? DEFAULT_FORMAT.groupSeparator,
      hideDecimals: hideDecimals ?? DEFAULT_FORMAT.hideDecimals,
    }),
    [currencySymbol, currencyCode, symbolPosition, decimalSeparator, groupSeparator, hideDecimals],
  )
  const money = useCallback<DataContextValue['money']>((cents, opts) => formatMoney(cents, format, opts), [format])

  const ready = !!settings && !!accounts && !!categories && !!transactions
  const value = useMemo<DataContextValue>(
    () => ({
      ready,
      settings: s,
      accounts: accountList,
      ...accountMaps,
      groups: groupList,
      categories: categoryList,
      categoryById,
      payees: payeeList,
      payeeById,
      transactions: txnList,
      scheduled: scheduledList,
      entries: entryList,
      monthNotes,
      budget,
      balances,
      format,
      money,
    }),
    [ready, s, accountList, accountMaps, groupList, categoryList, categoryById, payeeList, payeeById, txnList,
      scheduledList, entryList, monthNotes, budget, balances, format, money],
  )

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
