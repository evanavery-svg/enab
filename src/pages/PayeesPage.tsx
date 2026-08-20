import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { NavMenuButton } from '../components/NavMenuButton'
import { ConfirmDialog, Modal } from '../components/Modal'
import { Field } from '../components/Fields'
import { useData } from '../hooks/useData'
import { toast } from '../state/ui'
import { deletePayee, mergePayees, renamePayee } from '../db/actions'
import type { Id } from '../types'

export default function PayeesPage() {
  const { payees, transactions, categoryById, money } = useData()
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<Id | null>(null)
  const [newName, setNewName] = useState('')
  const [merging, setMerging] = useState<Id | null>(null)
  const [mergeTarget, setMergeTarget] = useState<Id>('')
  const [confirmDelete, setConfirmDelete] = useState<Id | null>(null)

  const stats = useMemo(() => {
    const counts = new Map<Id, { count: number; total: number; last: string }>()
    for (const t of transactions) {
      if (!t.payeeId) continue
      const current = counts.get(t.payeeId) ?? { count: 0, total: 0, last: '' }
      current.count += 1
      current.total += t.amount
      if (t.date > current.last) current.last = t.date
      counts.set(t.payeeId, current)
    }
    return counts
  }, [transactions])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return payees
      .filter((p) => !p.transferAccountId)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => (stats.get(b.id)?.count ?? 0) - (stats.get(a.id)?.count ?? 0) || a.name.localeCompare(b.name))
  }, [payees, query, stats])

  const payeeName = (id: Id) => payees.find((p) => p.id === id)?.name ?? ''

  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <h1>Payees</h1>
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 13 }}>
          {visible.length}
        </span>
      </header>

      <div className="content content-pad">
        <div className="content-narrow">
          <input
            className="input"
            style={{ marginBottom: 14 }}
            placeholder="Search payees"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {visible.length === 0 ? (
            <div className="card empty">
              <h3>No payees yet</h3>
              <p>Payees are created automatically as you enter transactions.</p>
            </div>
          ) : (
            <div className="card">
              {visible.map((p) => {
                const s = stats.get(p.id)
                return (
                  <div className="list-row" key={p.id}>
                    <div className="grow">
                      <div className="truncate">{p.name}</div>
                      <div className="sub">
                        {s ? `${s.count} transaction${s.count === 1 ? '' : 's'} · ${money(s.total)}` : 'Unused'}
                        {p.lastCategoryId && ` · usually ${categoryById.get(p.lastCategoryId)?.name ?? '—'}`}
                      </div>
                    </div>
                    <button
                      className="icon-btn"
                      title="Rename"
                      onClick={() => {
                        setRenaming(p.id)
                        setNewName(p.name)
                      }}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Merge into another payee"
                      onClick={() => {
                        setMerging(p.id)
                        setMergeTarget('')
                      }}
                    >
                      <Icon name="transfer" size={16} />
                    </button>
                    <button className="icon-btn" title="Delete" onClick={() => setConfirmDelete(p.id)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {renaming && (
        <Modal
          title="Rename payee"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!newName.trim()}
                onClick={async () => {
                  await renamePayee(renaming, newName)
                  toast('Payee renamed')
                  setRenaming(null)
                }}
              >
                Save
              </button>
            </>
          }
        >
          <input className="input" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} />
        </Modal>
      )}

      {merging && (
        <Modal
          title={`Merge "${payeeName(merging)}" into…`}
          onClose={() => setMerging(null)}
          footer={
            <>
              <button className="btn" onClick={() => setMerging(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!mergeTarget}
                onClick={async () => {
                  await mergePayees([merging], mergeTarget)
                  toast(`Merged into ${payeeName(mergeTarget)}`)
                  setMerging(null)
                }}
              >
                Merge
              </button>
            </>
          }
        >
          <Field
            label="Keep this payee"
            hint="Every transaction on the merged payee moves across, and the old name is removed."
          >
            <select className="select" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
              <option value="">Choose a payee…</option>
              {visible
                .filter((p) => p.id !== merging)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${payeeName(confirmDelete)}"?`}
          message="Its transactions are kept, but they will no longer have a payee."
          onConfirm={async () => {
            await deletePayee(confirmDelete)
            toast('Payee deleted')
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}
