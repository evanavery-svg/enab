import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { NavMenuButton } from '../components/NavMenuButton'
import { ConfirmDialog, Modal } from '../components/Modal'
import { Field } from '../components/Fields'
import { useData } from '../hooks/useData'
import { toast } from '../state/ui'
import { deletePayee, mergePayees, renamePayee } from '../db/actions'
import { RuleSheet } from '../components/RuleSheet'
import { applyRuleToExisting, savePayeeRule } from '../db/actions'
import { cleanPayeeName, normalizePayee, suggestRules, type RuleSuggestion } from '../lib/rules'
import type { Id, Payee, PayeeRule } from '../types'

export default function PayeesPage() {
  const { payees, transactions, categoryById, money, payeeRules } = useData()
  const [tab, setTab] = useState<'payees' | 'rules'>('payees')
  const [ruleFor, setRuleFor] = useState<Payee | null>(null)
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
      </header>

      <div className="content content-pad">
        <div className="content-narrow">
          <div className="segmented" role="tablist" style={{ marginBottom: 14 }}>
            <button role="tab" aria-pressed={tab === 'payees'} onClick={() => setTab('payees')}>
              Payees <span className="tab-count">{visible.length}</span>
            </button>
            <button role="tab" aria-pressed={tab === 'rules'} onClick={() => setTab('rules')}>
              Import rules <span className="tab-count">{payeeRules.length}</span>
            </button>
          </div>
          {tab === 'rules' ? (
            <RulesPanel />
          ) : (
          <>
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
                    <button className="icon-btn" title="Make an import rule" aria-label={`Make a rule for ${p.name}`} onClick={() => setRuleFor(p)}>
                      <Icon name="filter" size={16} />
                    </button>
                    <button className="icon-btn" title="Delete" onClick={() => setConfirmDelete(p.id)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {ruleFor && (
        <RuleSheet
          initial={{
            match: normalizePayee(cleanPayeeName(ruleFor.name)),
            renameTo: cleanPayeeName(ruleFor.name),
            categoryId: ruleFor.lastCategoryId ?? null,
          }}
          onClose={() => setRuleFor(null)}
        />
      )}

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

const TYPE_WORD: Record<PayeeRule['matchType'], string> = { contains: 'contains', startsWith: 'starts with', exact: 'is' }

/** The rules themselves, and rules worth making from messy names already in the budget. */
function RulesPanel() {
  const { payees, transactions, payeeRules, categories, categoryById } = useData()
  const [editing, setEditing] = useState<PayeeRule | 'new' | null>(null)
  const [fromSuggestion, setFromSuggestion] = useState<RuleSuggestion | null>(null)
  const [showAll, setShowAll] = useState(false)
  const suggestions = useMemo(
    () => suggestRules(payees, transactions, payeeRules, categories),
    [payees, transactions, payeeRules, categories],
  )
  const sorted = [...payeeRules].sort((a, b) => (a.renameTo || a.match).localeCompare(b.renameTo || b.match))

  async function accept(s: RuleSuggestion) {
    const input = { match: s.match, matchType: 'contains' as const, renameTo: s.renameTo, categoryId: s.categoryId }
    await savePayeeRule(input)
    const done = await applyRuleToExisting(input)
    toast(`Rule added · ${done.transactions} transaction${done.transactions === 1 ? '' : 's'} tidied`)
  }

  return (
    <>
      <p className="rules-lead">
        Rules tidy your bank's payee names as you import, like turning <code>SQ *BLUE BOTTLE 0423</code> into Blue Bottle,
        and can file them in a category every time.
      </p>

      {suggestions.length > 0 && (
        <section className="card rules-suggest">
          <header>
            <Icon name="star" size={16} />
            <div>
              <h3>Tidy up {suggestions.length} bank name{suggestions.length === 1 ? '' : 's'}</h3>
              <p>Found in what you've imported. Add one and its past transactions are fixed too.</p>
            </div>
          </header>
          {(showAll ? suggestions : suggestions.slice(0, 5)).map((s) => (
            <div className="rule-sug" key={s.key}>
              <div className="what">
                <div className="to">
                  {s.renameTo}
                  {s.categoryId && <span className="cat">{categoryById.get(s.categoryId)?.name}</span>}
                </div>
                <div className="from truncate">{s.names.join(' · ')}</div>
              </div>
              <button className="btn btn-sm" onClick={() => setFromSuggestion(s)} aria-label={`Edit suggestion for ${s.renameTo}`}>
                <Icon name="edit" size={14} />
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => void accept(s)}>
                Add
              </button>
            </div>
          ))}
          {suggestions.length > 5 && (
            <button className="linkish more" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${suggestions.length}`}
            </button>
          )}
        </section>
      )}

      <div className="rules-head">
        <h3>Your rules</h3>
        <button className="btn btn-sm" onClick={() => setEditing('new')}>
          <Icon name="plus" size={14} /> New rule
        </button>
      </div>
      {sorted.length === 0 ? (
        <div className="card empty" style={{ padding: 22 }}>
          <p style={{ margin: 0 }}>No rules yet. Add one above, or from any payee on the Payees tab.</p>
        </div>
      ) : (
        <div className="card">
          {sorted.map((r) => (
            <button className="rule-row" key={r.id} onClick={() => setEditing(r)}>
              <span className="when">
                Payee {TYPE_WORD[r.matchType]} <q>{r.match}</q>
              </span>
              <span className="then">
                <Icon name="chevronRight" size={14} />
                {r.renameTo || 'same name'}
                {r.categoryId && <span className="cat">{categoryById.get(r.categoryId)?.name ?? 'deleted category'}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {editing && <RuleSheet rule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {fromSuggestion && (
        <RuleSheet
          initial={{ match: fromSuggestion.match, renameTo: fromSuggestion.renameTo, categoryId: fromSuggestion.categoryId }}
          onClose={() => setFromSuggestion(null)}
        />
      )}
    </>
  )
}
