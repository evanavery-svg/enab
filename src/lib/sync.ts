import { db } from '../db/db'
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
  settings: Settings[]
}

function getDeviceId(): string {
  let id = localStorage.getItem('enab-device-id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('enab-device-id', id)
  }
  return id
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
  const [accounts, categoryGroups, categories, payees, transactions, scheduled, budgetEntries, monthNotes, settings] =
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
    ])

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
    settings,
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

interface MergeResult {
  added: number
  updated: number
  conflicts: number
}

function mergeRecords<T extends { id: string; deleted?: boolean; createdAt?: string }>(
  local: T[],
  remote: T[],
): { merged: T[]; stats: MergeResult } {
  const localMap = new Map(local.map((r) => [r.id, r]))
  const stats: MergeResult = { added: 0, updated: 0, conflicts: 0 }
  const result = new Map(local.map((r) => [r.id, r]))

  for (const r of remote) {
    const existing = localMap.get(r.id)
    if (!existing) {
      result.set(r.id, r)
      stats.added++
    } else {
      const remoteTime = (r as any).createdAt ?? ''
      const localTime = (existing as any).createdAt ?? ''
      if (remoteTime > localTime) {
        result.set(r.id, r)
        stats.updated++
      } else if (remoteTime === localTime) {
        // Same timestamp — keep local (no-op)
      } else {
        stats.conflicts++
      }
    }
  }

  return { merged: [...result.values()], stats }
}

function mergeBudgetEntries(
  local: BudgetEntry[],
  remote: BudgetEntry[],
): { merged: BudgetEntry[]; stats: MergeResult } {
  const localMap = new Map(local.map((e) => [e.id, e]))
  const stats: MergeResult = { added: 0, updated: 0, conflicts: 0 }
  const result = new Map(local.map((e) => [e.id, e]))

  for (const r of remote) {
    if (!localMap.has(r.id)) {
      result.set(r.id, r)
      stats.added++
    } else {
      const existing = localMap.get(r.id)!
      if (existing.assigned !== r.assigned) {
        // Last-write-wins: remote wins since it's newer export
        result.set(r.id, r)
        stats.updated++
      }
    }
  }

  return { merged: [...result.values()], stats }
}

function mergeMonthNotes(
  local: MonthNote[],
  remote: MonthNote[],
): { merged: MonthNote[]; stats: MergeResult } {
  const localMap = new Map(local.map((n) => [n.month, n]))
  const stats: MergeResult = { added: 0, updated: 0, conflicts: 0 }
  const result = new Map(local.map((n) => [n.month, n]))

  for (const r of remote) {
    if (!localMap.has(r.month)) {
      result.set(r.month, r)
      stats.added++
    } else {
      const existing = localMap.get(r.month)!
      if (existing.note !== r.note) {
        result.set(r.month, r)
        stats.updated++
      }
    }
  }

  return { merged: [...result.values()], stats }
}

export async function mergeImport(packet: SyncPacket): Promise<{
  totalAdded: number
  totalUpdated: number
}> {
  const [
    localAccounts,
    localGroups,
    localCategories,
    localPayees,
    localTransactions,
    localScheduled,
    localEntries,
    localMonthNotes,
  ] = await Promise.all([
    db.accounts.toArray(),
    db.categoryGroups.toArray(),
    db.categories.toArray(),
    db.payees.toArray(),
    db.transactions.toArray(),
    db.scheduled.toArray(),
    db.budgetEntries.toArray(),
    db.monthNotes.toArray(),
  ])

  const accts = mergeRecords(localAccounts, packet.accounts)
  const groups = mergeRecords(localGroups, packet.categoryGroups)
  const cats = mergeRecords(localCategories, packet.categories)
  const pays = mergeRecords(localPayees, packet.payees)
  const txns = mergeRecords(localTransactions, packet.transactions)
  const scheds = mergeRecords(localScheduled, packet.scheduled)
  const entries = mergeBudgetEntries(localEntries, packet.budgetEntries)
  const mergedNotes = mergeMonthNotes(localMonthNotes, packet.monthNotes)

  await db.transaction(
    'rw',
    [db.accounts, db.categoryGroups, db.categories, db.payees, db.transactions, db.scheduled, db.budgetEntries, db.monthNotes],
    async () => {
      await db.accounts.bulkPut(accts.merged)
      await db.categoryGroups.bulkPut(groups.merged)
      await db.categories.bulkPut(cats.merged)
      await db.payees.bulkPut(pays.merged)
      await db.transactions.bulkPut(txns.merged)
      await db.scheduled.bulkPut(scheds.merged)
      await db.budgetEntries.bulkPut(entries.merged)
      await db.monthNotes.bulkPut(mergedNotes.merged)
    },
  )

  const totalAdded = [accts, groups, cats, pays, txns, scheds, entries].reduce(
    (s, r) => s + r.stats.added,
    0,
  )
  const totalUpdated = [accts, groups, cats, pays, txns, scheds, entries].reduce(
    (s, r) => s + r.stats.updated,
    0,
  )

  return { totalAdded, totalUpdated }
}
