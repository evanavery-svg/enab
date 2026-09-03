import { db, preservingTimestamps } from '../db/db'
import { base64ToBlob, blobToBase64, type SerializedAttachment } from './attachments'
import type {
  Account,
  BudgetEntry,
  Category,
  CategoryGroup,
  MonthNote,
  Payee,
  ScheduledTransaction,
  Transaction,
} from '../types'

/**
 * A sync packet deliberately carries no settings. Settings are per-device
 * (theme, PIN, and the sync passphrase itself), and shipping them would put
 * the passphrase inside the very file it protects.
 */
export interface SyncPacket {
  app: 'enab-sync'
  version: 1
  exportedAt: string
  deviceId: string
  accounts: Account[]
  categoryGroups: CategoryGroup[]
  categories: Category[]
  payees: Payee[]
  transactions: Transaction[]
  scheduled: ScheduledTransaction[]
  budgetEntries: BudgetEntry[]
  monthNotes: MonthNote[]
  attachments: SerializedAttachment[]
}

/**
 * Identifies the exporting device. Storage can be unavailable (private windows,
 * hardened privacy settings), and that must not be what stops a sync export —
 * the id is only a label, so an ephemeral one is fine.
 */
function getDeviceId(): string {
  try {
    let id = localStorage.getItem('enab-device-id')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('enab-device-id', id)
    }
    return id
  } catch {
    return 'unknown-device'
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function exportSyncPacket(): Promise<SyncPacket> {
  const [accounts, categoryGroups, categories, payees, transactions, scheduled, budgetEntries, monthNotes, rawAttachments] =
    await Promise.all([
      db.accounts.toArray(),
      db.categoryGroups.toArray(),
      db.categories.toArray(),
      db.payees.toArray(),
      db.transactions.toArray(),
      db.scheduled.toArray(),
      db.budgetEntries.toArray(),
      db.monthNotes.toArray(),
      db.attachments.toArray(),
    ])

  const attachments = await Promise.all(
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
    app: 'enab-sync',
    version: 1,
    exportedAt: new Date().toISOString(),
    deviceId: getDeviceId(),
    accounts,
    categoryGroups,
    categories,
    payees,
    transactions,
    scheduled,
    budgetEntries,
    monthNotes,
    attachments,
  }
}

export async function encryptPacket(packet: SyncPacket, passphrase: string): Promise<ArrayBuffer> {
  const json = JSON.stringify(packet)
  const data = new TextEncoder().encode(json)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)

  const out = new Uint8Array(4 + 16 + 12 + encrypted.byteLength)
  // Header: 'ENAB'
  out[0] = 69; out[1] = 78; out[2] = 65; out[3] = 66
  out.set(salt, 4)
  out.set(iv, 20)
  out.set(new Uint8Array(encrypted), 32)
  return out.buffer
}

export async function decryptPacket(buffer: ArrayBuffer, passphrase: string): Promise<SyncPacket> {
  const data = new Uint8Array(buffer)
  if (data.byteLength < 33) throw new Error('Not an ENAB sync file.')
  if (data[0] !== 69 || data[1] !== 78 || data[2] !== 65 || data[3] !== 66) {
    throw new Error('Not an ENAB sync file.')
  }
  const salt = data.slice(4, 20)
  const iv = data.slice(20, 32)
  const encrypted = data.slice(32)
  const key = await deriveKey(passphrase, salt)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)
  const json = new TextDecoder().decode(decrypted)
  const packet: SyncPacket = JSON.parse(json)
  if (packet.app !== 'enab-sync') throw new Error('Not a valid ENAB sync packet.')
  return packet
}

interface MergeResult<T> {
  /** Only the records that actually changed — the rest are left untouched. */
  changed: T[]
  added: number
  updated: number
}

/** When a record has never been stamped, its creation time is the best guess. */
function stampOf(record: { updatedAt?: string; createdAt?: string }): string {
  return record.updatedAt ?? record.createdAt ?? ''
}

/**
 * Last-write-wins on `updatedAt`. Ties keep the local copy, so re-importing the
 * same packet is a no-op rather than a churn of rewrites.
 */
function mergeRecords<T extends { updatedAt?: string; createdAt?: string }>(
  local: T[],
  remote: T[],
  keyOf: (record: T) => string,
): MergeResult<T> {
  const localMap = new Map(local.map((r) => [keyOf(r), r]))
  const changed: T[] = []
  let added = 0
  let updated = 0

  for (const r of remote) {
    const existing = localMap.get(keyOf(r))
    if (!existing) {
      changed.push(r)
      added++
    } else if (stampOf(r) > stampOf(existing)) {
      changed.push(r)
      updated++
    }
  }

  return { changed, added, updated }
}

export interface SyncSummary {
  totalAdded: number
  totalUpdated: number
}

export async function mergeImport(packet: SyncPacket): Promise<SyncSummary> {
  const [
    localAccounts,
    localGroups,
    localCategories,
    localPayees,
    localTransactions,
    localScheduled,
    localEntries,
    localMonthNotes,
    localAttachments,
  ] = await Promise.all([
    db.accounts.toArray(),
    db.categoryGroups.toArray(),
    db.categories.toArray(),
    db.payees.toArray(),
    db.transactions.toArray(),
    db.scheduled.toArray(),
    db.budgetEntries.toArray(),
    db.monthNotes.toArray(),
    db.attachments.toArray(),
  ])

  const byId = <T extends { id: string }>(r: T) => r.id
  const accts = mergeRecords(localAccounts, packet.accounts ?? [], byId)
  const groups = mergeRecords(localGroups, packet.categoryGroups ?? [], byId)
  const cats = mergeRecords(localCategories, packet.categories ?? [], byId)
  const pays = mergeRecords(localPayees, packet.payees ?? [], byId)
  const txns = mergeRecords(localTransactions, packet.transactions ?? [], byId)
  const scheds = mergeRecords(localScheduled, packet.scheduled ?? [], byId)
  const entries = mergeRecords(localEntries, packet.budgetEntries ?? [], byId)
  const notes = mergeRecords(localMonthNotes, packet.monthNotes ?? [], (n) => n.month)

  // Attachment blobs are immutable once written, so only genuinely new ones
  // need decoding — that keeps a repeat sync from re-inflating every receipt.
  const haveAttachment = new Set(localAttachments.map((a) => a.id))
  const newAttachments = (packet.attachments ?? []).filter((a) => !haveAttachment.has(a.id))

  await preservingTimestamps(async () => {
    await db.transaction(
      'rw',
      [db.accounts, db.categoryGroups, db.categories, db.payees, db.transactions, db.scheduled, db.budgetEntries, db.monthNotes, db.attachments],
      async () => {
        if (accts.changed.length) await db.accounts.bulkPut(accts.changed)
        if (groups.changed.length) await db.categoryGroups.bulkPut(groups.changed)
        if (cats.changed.length) await db.categories.bulkPut(cats.changed)
        if (pays.changed.length) await db.payees.bulkPut(pays.changed)
        if (txns.changed.length) await db.transactions.bulkPut(txns.changed)
        if (scheds.changed.length) await db.scheduled.bulkPut(scheds.changed)
        if (entries.changed.length) await db.budgetEntries.bulkPut(entries.changed)
        if (notes.changed.length) await db.monthNotes.bulkPut(notes.changed)
        if (newAttachments.length) {
          await db.attachments.bulkPut(
            newAttachments.map((a) => ({
              id: a.id,
              transactionId: a.transactionId,
              name: a.name,
              type: a.type,
              size: a.size,
              data: base64ToBlob(a.data, a.type),
              createdAt: a.createdAt,
            })),
          )
        }
      },
    )
  })

  const parts = [accts, groups, cats, pays, txns, scheds, entries, notes]
  return {
    totalAdded: parts.reduce((s, r) => s + r.added, 0) + newAttachments.length,
    totalUpdated: parts.reduce((s, r) => s + r.updated, 0),
  }
}
