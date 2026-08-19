import Dexie, { type Table } from 'dexie'
import type {
  Account,
  BudgetEntry,
  Category,
  CategoryGroup,
  MonthNote,
  Payee,
  ScheduledTransaction,
  Settings,
  Transaction,
} from '../types'

export class EnabDatabase extends Dexie {
  accounts!: Table<Account, string>
  categoryGroups!: Table<CategoryGroup, string>
  categories!: Table<Category, string>
  payees!: Table<Payee, string>
  transactions!: Table<Transaction, string>
  scheduled!: Table<ScheduledTransaction, string>
  budgetEntries!: Table<BudgetEntry, string>
  monthNotes!: Table<MonthNote, string>
  settings!: Table<Settings, string>

  constructor(name = 'enab') {
    super(name)
    this.version(1).stores({
      accounts: 'id, sortOrder, class, closed, deleted',
      categoryGroups: 'id, sortOrder, deleted',
      categories: 'id, groupId, sortOrder, hidden, linkedAccountId, deleted',
      payees: 'id, name, transferAccountId, deleted',
      transactions:
        'id, accountId, date, month, categoryId, payeeId, cleared, transferTransactionId, scheduledId, deleted, [accountId+date], [month+categoryId]',
      scheduled: 'id, accountId, nextDate, deleted',
      budgetEntries: 'id, month, categoryId, [month+categoryId]',
      monthNotes: 'month',
      settings: 'id',
    })
  }
}

export const db = new EnabDatabase()

/** Wipe every table without dropping the database (used by Fresh Start / import). */
export async function clearAllTables(database: EnabDatabase = db) {
  const tables = [
    database.accounts,
    database.categoryGroups,
    database.categories,
    database.payees,
    database.transactions,
    database.scheduled,
    database.budgetEntries,
    database.monthNotes,
    database.settings,
  ]
  await database.transaction('rw', tables, async () => {
    await Promise.all(tables.map((t) => t.clear()))
  })
}
