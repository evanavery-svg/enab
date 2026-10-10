import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, clearAllTables } from '../../db/db'
import {
  addAttachment,
  createAccount,
  deleteAttachment,
  getAttachments,
  createTransaction,
  deleteTransaction,
  ensureInitialized,
  setAssigned,
  setMonthNote,
  updateTransaction,
} from '../../db/actions'
import { INFLOW_CATEGORY_ID } from '../../db/seed'
import { decryptPacket, encryptPacket, exportSyncPacket, mergeImport, WrongPassphraseError } from '../sync'

beforeEach(async () => {
  await clearAllTables()
  await ensureInitialized()
})

async function seedTransaction(memo: string) {
  const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
  const id = await createTransaction({ accountId, date: '2026-03-10', amount: -2_500, memo })
  return { accountId, id }
}

describe('updatedAt stamping', () => {
  it('stamps on create and moves forward on edit', async () => {
    const { id } = await seedTransaction('coffee')
    const created = await db.transactions.get(id)
    expect(created?.updatedAt).toBeTruthy()

    await new Promise((r) => setTimeout(r, 2))
    await updateTransaction(id, { memo: 'espresso' })

    const edited = await db.transactions.get(id)
    expect(edited?.memo).toBe('espresso')
    expect(edited!.updatedAt! > created!.updatedAt!).toBe(true)
  })
})

describe('encryptPacket / decryptPacket', () => {
  it('round-trips a packet with the right passphrase', async () => {
    await seedTransaction('coffee')
    const packet = await exportSyncPacket()
    const blob = await encryptPacket(packet, 'correct horse')
    const back = await decryptPacket(blob, 'correct horse')
    expect(back.transactions).toHaveLength(packet.transactions.length)
    expect(back.transactions.map((t) => t.memo)).toContain('coffee')
  })

  it('rejects the wrong passphrase', async () => {
    const packet = await exportSyncPacket()
    const blob = await encryptPacket(packet, 'right')
    // A readable message, not the browser's bare "operation failed".
    await expect(decryptPacket(blob, 'wrong')).rejects.toBeInstanceOf(WrongPassphraseError)
    await expect(decryptPacket(blob, 'wrong')).rejects.toThrow(/passphrase doesn't open this file/)
  })

  it('rejects a file that is not a sync packet', async () => {
    await expect(decryptPacket(new Uint8Array([1, 2, 3]).buffer, 'x')).rejects.toThrow(/not an enab sync file/i)
  })

  it('never carries settings, so the passphrase stays on the device', async () => {
    const packet = await exportSyncPacket()
    expect(packet).not.toHaveProperty('settings')
    expect(JSON.stringify(packet)).not.toContain('syncPassphrase')
  })
})

describe('mergeImport', () => {
  it('brings across records this device has never seen', async () => {
    const { id } = await seedTransaction('coffee')
    const packet = await exportSyncPacket()

    await clearAllTables()
    await ensureInitialized()

    const result = await mergeImport(packet)
    expect(result.totalAdded).toBeGreaterThan(0)
    expect((await db.transactions.get(id))?.memo).toBe('coffee')
  })

  it('applies an edit made on the other device', async () => {
    // The bug this guards: `createdAt` never changes on edit, so a merge that
    // compared creation times saw the two copies as identical and kept the
    // stale one — edits silently never crossed between devices.
    const { id } = await seedTransaction('coffee')
    const packet = await exportSyncPacket()

    await new Promise((r) => setTimeout(r, 2))
    const remote = structuredClone(packet)
    const target = remote.transactions.find((t) => t.id === id)!
    target.memo = 'edited elsewhere'
    target.updatedAt = new Date().toISOString()

    const result = await mergeImport(remote)
    expect(result.totalUpdated).toBe(1)
    expect((await db.transactions.get(id))?.memo).toBe('edited elsewhere')
  })

  it('keeps the local copy when this device edited more recently', async () => {
    const { id } = await seedTransaction('coffee')
    const stale = structuredClone(await exportSyncPacket())
    const target = stale.transactions.find((t) => t.id === id)!
    target.memo = 'older remote edit'
    target.updatedAt = '2000-01-01T00:00:00.000Z'

    await updateTransaction(id, { memo: 'newer local edit' })
    const result = await mergeImport(stale)

    expect(result.totalUpdated).toBe(0)
    expect((await db.transactions.get(id))?.memo).toBe('newer local edit')
  })

  it('is a no-op when the same packet is imported twice', async () => {
    await seedTransaction('coffee')
    const packet = await exportSyncPacket()

    const second = await mergeImport(packet)
    expect(second.totalAdded).toBe(0)
    expect(second.totalUpdated).toBe(0)
  })

  it('propagates a deleted transaction', async () => {
    const { id } = await seedTransaction('coffee')
    await deleteTransaction(id)
    const packet = await exportSyncPacket()

    await clearAllTables()
    await ensureInitialized()
    await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    await mergeImport(packet)

    expect((await db.transactions.get(id))?.deleted).toBe(true)
  })

  it('propagates un-assigning a category back to zero', async () => {
    // Assignments are money. If the other device cleared one and the merge
    // cannot see that, the old amount silently reappears and the budget is wrong.
    await setAssigned('2026-03', INFLOW_CATEGORY_ID, 50_000)
    const withMoney = await exportSyncPacket()

    await setAssigned('2026-03', INFLOW_CATEGORY_ID, 0)
    const cleared = await exportSyncPacket()

    // Start from the state that still has the money, then sync the clearing.
    await clearAllTables()
    await ensureInitialized()
    await mergeImport(withMoney)
    expect((await db.budgetEntries.toArray()).find((e) => e.assigned === 50_000)).toBeTruthy()

    await mergeImport(cleared)
    const entry = await db.budgetEntries.get(`2026-03:${INFLOW_CATEGORY_ID}`)
    expect(entry?.assigned ?? 0).toBe(0)
  })

  it('propagates a cleared month note', async () => {
    await setMonthNote('2026-03', 'save for tires')
    const withNote = await exportSyncPacket()

    await setMonthNote('2026-03', '')
    const cleared = await exportSyncPacket()

    await clearAllTables()
    await ensureInitialized()
    await mergeImport(withNote)
    expect((await db.monthNotes.get('2026-03'))?.note).toBe('save for tires')

    await mergeImport(cleared)
    expect((await db.monthNotes.get('2026-03'))?.note ?? '').toBe('')
  })

  it('carries a receipt across, then carries its deletion across too', async () => {
    const { id } = await seedTransaction('coffee')
    const attId = await addAttachment(id, new File(['receipt'], 'r.txt', { type: 'text/plain' }))
    const withReceipt = await exportSyncPacket()

    await deleteAttachment(attId)
    const afterDelete = await exportSyncPacket()

    await clearAllTables()
    await ensureInitialized()
    await mergeImport(withReceipt)
    expect(await getAttachments(id)).toHaveLength(1)

    await mergeImport(afterDelete)
    expect(await getAttachments(id)).toHaveLength(0)
  })

  it('does not restamp merged records as locally edited', async () => {
    const { id } = await seedTransaction('coffee')
    const packet = await exportSyncPacket()
    const before = (await db.transactions.get(id))!.updatedAt

    await clearAllTables()
    await ensureInitialized()
    await mergeImport(packet)

    expect((await db.transactions.get(id))?.updatedAt).toBe(before)
  })
})

describe('syncing onto a brand-new device', () => {
  it("replaces the new device's starter categories instead of duplicating them", async () => {
    // The laptop: set up, with one category renamed.
    await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    const rent = (await db.categories.toArray()).find((c) => c.name === 'Rent/Mortgage')!
    await db.categories.update(rent.id, { name: 'Rent' })
    const laptop = await exportSyncPacket()
    const laptopNames = (await db.categories.toArray()).filter((c) => !c.deleted).map((c) => c.name).sort()

    // The phone: freshly opened, so it seeded its own starter categories.
    await clearAllTables()
    await ensureInitialized()
    await mergeImport(laptop)

    const phoneNames = (await db.categories.toArray()).filter((c) => !c.deleted).map((c) => c.name).sort()
    expect(phoneNames).toEqual(laptopNames)
    const groups = (await db.categoryGroups.toArray()).filter((g) => !g.deleted).map((g) => g.name)
    expect(new Set(groups).size).toBe(groups.length)
  })

  it('still merges normally once the device has data of its own', async () => {
    await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    const before = await db.categories.count()
    const other = structuredClone(await exportSyncPacket())
    other.categories.push({ ...other.categories[3], id: 'cat-from-elsewhere', name: 'Hobbies' })

    await mergeImport(other)

    expect(await db.categories.count()).toBe(before + 1)
  })
})
