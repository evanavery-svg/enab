import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, clearAllTables } from '../../db/db'
import { createAccount, createTransaction, ensureInitialized, updateTransaction } from '../../db/actions'
import { decryptPacket, encryptPacket, exportSyncPacket, mergeImport } from '../sync'

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
    await expect(decryptPacket(blob, 'wrong')).rejects.toThrow()
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
