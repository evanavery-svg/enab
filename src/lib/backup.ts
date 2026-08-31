import { db, clearAllTables } from '../db/db'
import { toCsv } from './csv'
import type {
  Account,
  Attachment,
  BudgetEntry,
  Category,
  CategoryGroup,
  MonthNote,
  Payee,
  ScheduledTransaction,
  Settings,
  Transaction,
} from '../types'

export const BACKUP_VERSION = 2

interface SerializedAttachment {
  id: string
  transactionId: string
  name: string
  type: string
  size: number
  data: string
  createdAt: string
}

export interface Backup {
  app: 'enab'
  version: number
  exportedAt: string
  accounts: Account[]
  categoryGroups: CategoryGroup[]
  categories: Category[]
  payees: Payee[]
  transactions: Transaction[]
  scheduled: ScheduledTransaction[]
  budgetEntries: BudgetEntry[]
  monthNotes: MonthNote[]
  settings: Settings[]
  attachments?: SerializedAttachment[]
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function base64ToBlob(b64: string, type: string): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

export async function exportBackup(): Promise<Backup> {
  const [accounts, categoryGroups, categories, payees, transactions, scheduled, budgetEntries, monthNotes, settings, rawAttachments] =
    await Promise.all([
      db.accounts.toArray(),
      db.categoryGroups.toArray(),
      db.categories.toArray(),
      db.payees.toArray(),
      db.transactions.toArray(),
      db.scheduled.toArray(),
      db.budgetEntries.toArray(),
      db.monthNotes.toArray(),
      db.settings.toArray(),
      db.attachments.toArray(),
    ])

  const attachments: SerializedAttachment[] = await Promise.all(
    rawAttachments.map(async (a) => ({
      id: a.id,
      transactionId: a.transactionId,
      name: a.name,
      type: a.type,
      size: a.size,
      data: await blobToBase64(a.data),
      createdAt: a.createdAt,
    })),
  )

  return {
    app: 'enab',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    accounts,
    categoryGroups,
    categories,
    payees,
    transactions,
    scheduled,
    budgetEntries,
    monthNotes,
    settings,
    attachments,
  }
}

/** Throws with a readable message rather than half-importing a bad file. */
export async function importBackup(raw: string): Promise<{ transactions: number; accounts: number }> {
  let parsed: Backup
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  if (parsed?.app !== 'enab' || !Array.isArray(parsed.accounts)) {
    throw new Error("That doesn't look like an ENAB backup.")
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error('That backup was made by a newer version of ENAB.')
  }

  await clearAllTables()
  await db.transaction(
    'rw',
    [db.accounts, db.categoryGroups, db.categories, db.payees, db.transactions, db.scheduled, db.budgetEntries, db.monthNotes, db.settings, db.attachments],
    async () => {
      await db.accounts.bulkPut(parsed.accounts ?? [])
      await db.categoryGroups.bulkPut(parsed.categoryGroups ?? [])
      await db.categories.bulkPut(parsed.categories ?? [])
      await db.payees.bulkPut(parsed.payees ?? [])
      await db.transactions.bulkPut(parsed.transactions ?? [])
      await db.scheduled.bulkPut(parsed.scheduled ?? [])
      await db.budgetEntries.bulkPut(parsed.budgetEntries ?? [])
      await db.monthNotes.bulkPut(parsed.monthNotes ?? [])
      await db.settings.bulkPut(parsed.settings ?? [])
      if (parsed.attachments?.length) {
        const hydrated: Attachment[] = parsed.attachments.map((a) => ({
          id: a.id,
          transactionId: a.transactionId,
          name: a.name,
          type: a.type,
          size: a.size,
          data: base64ToBlob(a.data, a.type),
          createdAt: a.createdAt,
        }))
        await db.attachments.bulkPut(hydrated)
      }
    },
  )

  return { transactions: parsed.transactions?.length ?? 0, accounts: parsed.accounts?.length ?? 0 }
}

/** Every transaction as CSV, in the shape most tools expect to import. */
export async function exportTransactionsCsv(): Promise<string> {
  const [accounts, categories, payees, transactions] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.payees.toArray(),
    db.transactions.toArray(),
  ])
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const payeeName = new Map(payees.map((p) => [p.id, p.name]))

  const rows: (string | number)[][] = [
    ['Account', 'Date', 'Payee', 'Category', 'Memo', 'Outflow', 'Inflow', 'Cleared'],
  ]

  const decimal = (cents: number) => (Math.abs(cents) / 100).toFixed(2)

  for (const t of transactions.filter((x) => !x.deleted).sort((a, b) => a.date.localeCompare(b.date))) {
    const emit = (amount: number, categoryId: string | null, memo: string) => {
      rows.push([
        accountName.get(t.accountId) ?? '',
        t.date,
        t.payeeId ? (payeeName.get(t.payeeId) ?? '') : '',
        categoryId ? (categoryName.get(categoryId) ?? '') : '',
        memo,
        amount < 0 ? decimal(amount) : '',
        amount > 0 ? decimal(amount) : '',
        t.cleared,
      ])
    }
    if (t.subtransactions?.length) {
      for (const s of t.subtransactions) emit(s.amount, s.categoryId, s.memo || t.memo)
    } else {
      emit(t.amount, t.categoryId, t.memo)
    }
  }

  return toCsv(rows)
}

/** Hand the browser a file to save. */
export function downloadFile(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the download a tick to start before the blob is reclaimed.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
