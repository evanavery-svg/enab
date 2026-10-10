import { useRef, useState } from 'react'
import { Modal } from './Modal'
import { Field } from './Fields'
import { Icon } from './Icon'
import { toast } from '../state/ui'
import { importBackup } from '../lib/backup'
import { decryptPacket, isSyncFile, mergeImport } from '../lib/sync'
import { updateSettings } from '../db/actions'

/**
 * "I already use ENAB on another device." Takes either file the other device
 * can produce — a backup (.json) or an encrypted sync file (.enab) — and tells
 * them apart by their contents, so nobody has to know which one they have.
 */
export function BringBudgetOver() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [syncFile, setSyncFile] = useState<ArrayBuffer | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onPicked(file: File) {
    const bytes = await file.arrayBuffer()
    if (isSyncFile(bytes)) {
      setSyncFile(bytes)
      return
    }
    setBusy(true)
    try {
      const result = await importBackup(new TextDecoder().decode(bytes))
      toast(`Welcome back — ${result.accounts} accounts and ${result.transactions} transactions brought over`)
    } catch (e) {
      toast(e instanceof Error ? e.message : "That file couldn't be read.", { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  async function unlock() {
    if (!syncFile || !passphrase) return
    setBusy(true)
    setError(null)
    try {
      const packet = await decryptPacket(syncFile, passphrase)
      await mergeImport(packet)
      // Remember it, so syncing back the other way needs no retyping.
      await updateSettings({ syncPassphrase: passphrase })
      setSyncFile(null)
      toast('Your budget is here')
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file couldn't be read.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
        <Icon name="upload" size={16} /> {busy ? 'Bringing it over…' : 'I already use ENAB on another device'}
      </button>
      <input
        ref={fileRef}
        type="file"
        // No `accept`: iOS greys out a custom extension like .enab entirely.
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) await onPicked(file)
        }}
      />

      {syncFile && (
        <Modal
          title="Unlock your sync file"
          onClose={() => setSyncFile(null)}
          footer={
            <>
              <button className="btn" onClick={() => setSyncFile(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={unlock} disabled={busy || !passphrase}>
                {busy ? 'Unlocking…' : 'Bring it over'}
              </button>
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void unlock()
            }}
          >
            <Field label="Sync passphrase" htmlFor="bring-passphrase" hint={error ?? 'The one you set on your other device.'}>
              <input
                id="bring-passphrase"
                className="input"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value)
                  setError(null)
                }}
              />
            </Field>
          </form>
        </Modal>
      )}
    </>
  )
}
