import Dexie, { type Table } from 'dexie'
import type {
  Account,
  Attachment,
  BudgetEntry,
  Category,
  CategoryGroup,
  GroceryItem,
  MonthNote,
  Payee,
  PayeeRule,
  ScheduledTransaction,
  Settings,
  Subscription,
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
  attachments!: Table<Attachment, string>
  subscriptions!: Table<Subscription, string>
  groceryItems!: Table<GroceryItem, string>
  payeeRules!: Table<PayeeRule, string>

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
    this.version(2).stores({
      attachments: 'id, transactionId',
    })
    this.version(3).stores({
      subscriptions: 'id, status, deleted',
    })
    this.version(4).stores({
      groceryItems: 'id, deleted',
    })
    this.version(5).stores({
      payeeRules: 'id, deleted',
    })

    // Every synced record carries an `updatedAt`. Stamping it here rather than
    // at each of the ~60 call sites means no write can forget to, which matters:
    // sync compares these timestamps to decide which device's copy is newer.
    for (const name of SYNCED_TABLES) {
      const table = this.table(name)
      table.hook('creating', (_pk, obj: { updatedAt?: string }) => {
        if (stampTimestamps) obj.updatedAt = new Date().toISOString()
      })
      table.hook('updating', (mods: object) => {
        // An empty diff is a no-op write; bumping it would invent a change.
        if (!stampTimestamps || Object.keys(mods).length === 0) return
        return { updatedAt: new Date().toISOString() }
      })
    }
  }
}

/** Tables that participate in device sync, and so need `updatedAt`. */
const SYNCED_TABLES = [
  'accounts',
  'categoryGroups',
  'categories',
  'payees',
  'transactions',
  'scheduled',
  'budgetEntries',
  'monthNotes',
  'subscriptions',
  'groceryItems',
  'payeeRules',
] as const

let stampTimestamps = true

/**
 * Run writes with auto-stamping off, so records keep the `updatedAt` they
 * arrived with. Merge and restore need this — re-stamping every incoming
 * record with "now" would make the next sync think this device edited them.
 *
 * Not reentrant, and deliberately so: it wraps whole-database operations that
 * the UI already serialises behind a modal.
 */
export async function preservingTimestamps<T>(fn: () => Promise<T>): Promise<T> {
  stampTimestamps = false
  try {
    return await fn()
  } finally {
    stampTimestamps = true
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
    database.attachments,
    database.subscriptions,
    database.groceryItems,
    database.payeeRules,
  ]
  await database.transaction('rw', tables, async () => {
    await Promise.all(tables.map((t) => t.clear()))
  })
}
