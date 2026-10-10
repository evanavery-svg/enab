import { db, clearAllTables, preservingTimestamps } from '../db/db'
import { toCsv } from './csv'
import { base64ToBlob, blobToBase64, type SerializedAttachment } from './attachments'
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

  // Deleted attachments are carried as bare markers so a restore doesn't
  // resurrect a receipt, without bloating the file with bytes nobody wants.
  const attachments: SerializedAttachment[] = await Promise.all(
    rawAttachments.map(async (a) => ({
      id: a.id,
      transactionId: a.transactionId,
      name: a.name,
      type: a.type,
      size: a.deleted ? 0 : a.size,
      data: a.deleted ? '' : await blobToBase64(a.data),
      createdAt: a.createdAt,
      deleted: a.deleted,
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
    // Secrets stay on the device. A backup file gets mailed to yourself and
    // parked in cloud storage; the sync passphrase and PIN must not ride along.
    settings: settings.map(({ syncPassphrase: _p, pinHash: _h, ...rest }) => rest),
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
  // Restore is a copy, not an edit: records keep the timestamps they were
  // saved with so a later sync doesn't mistake the whole budget for new work.
  await preservingTimestamps(async () => {
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
            size: a.deleted ? 0 : a.size,
            data: a.deleted ? new Blob([]) : base64ToBlob(a.data, a.type),
            createdAt: a.createdAt,
            deleted: a.deleted,
          }))
          await db.attachments.bulkPut(hydrated)
        }
      },
    )
  })

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

/**
 * Hand a file to the person. On a phone that's the share sheet — AirDrop,
 * Files, Mail — because a plain download from an installed web app on iOS
 * often goes nowhere visible. Everywhere else, and whenever sharing isn't
 * available or allowed, it's an ordinary download.
 *
 * Resolves `false` only when the person dismissed the share sheet.
 */
export async function saveFile(filename: string, content: BlobPart, type = 'application/json'): Promise<boolean> {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  if (touch && typeof navigator !== 'undefined' && navigator.canShare) {
    const file = new File([content], filename, { type })
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename })
        return true
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return false
        // NotAllowedError and friends (e.g. the tap's activation lapsed while
        // the export was being built): fall through to a download.
      }
    }
  }
  downloadFile(filename, content, type)
  return true
}

/** Hand the browser a file to save. */
export function downloadFile(filename: string, content: BlobPart, type = 'application/json') {
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
