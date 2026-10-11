import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { Field } from './Fields'
import { CategorySelect } from './CategorySelect'
import { useData } from '../hooks/useData'
import { toast } from '../state/ui'
import { applyRuleToExisting, deletePayeeRule, savePayeeRule, type PayeeRuleInput } from '../db/actions'
import { ruleMatches } from '../lib/rules'
import type { PayeeRule } from '../types'

const TYPES: { key: PayeeRule['matchType']; label: string }[] = [
  { key: 'contains', label: 'Contains' },
  { key: 'startsWith', label: 'Starts with' },
  { key: 'exact', label: 'Is exactly' },
]

/** Create or edit an import rule, with a live preview of what it would change. */
export function RuleSheet({
  rule,
  initial,
  onClose,
}: {
  rule?: PayeeRule
  initial?: Partial<PayeeRuleInput>
  onClose: () => void
}) {
  const { payees, transactions } = useData()
  const [match, setMatch] = useState(rule?.match ?? initial?.match ?? '')
  const [matchType, setMatchType] = useState<PayeeRule['matchType']>(rule?.matchType ?? initial?.matchType ?? 'contains')
  const [renameTo, setRenameTo] = useState(rule?.renameTo ?? initial?.renameTo ?? '')
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? initial?.categoryId ?? null)
  const [fixPast, setFixPast] = useState(true)
  const [busy, setBusy] = useState(false)

  const input: PayeeRuleInput = { match, matchType, renameTo, categoryId }
  const preview = useMemo(() => {
    if (!match.trim()) return { names: [] as string[], count: 0 }
    const ids = new Set(payees.filter((p) => !p.transferAccountId && ruleMatches({ match, matchType }, p.name)).map((p) => p.id))
    const count = transactions.filter((t) => t.payeeId && ids.has(t.payeeId)).length
    return { names: payees.filter((p) => ids.has(p.id)).map((p) => p.name), count }
  }, [match, matchType, payees, transactions])

  const valid = match.trim().length >= 2 && (renameTo.trim() !== '' || categoryId !== null)

  async function save() {
    if (!valid) return
    setBusy(true)
    try {
      await savePayeeRule(input, rule?.id)
      let note = ''
      if (fixPast && preview.count) {
        const done = await applyRuleToExisting(input)
        if (done.transactions) note = ` · ${done.transactions} past transaction${done.transactions === 1 ? '' : 's'} updated`
      }
      toast(`Rule saved${note}`)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!rule) return
    await deletePayeeRule(rule.id)
    toast('Rule deleted', { action: { label: 'Undo', run: () => void savePayeeRule(rule, rule.id) } })
    onClose()
  }

  return (
    <Modal
      title={rule ? 'Edit rule' : 'New import rule'}
      onClose={onClose}
      footer={
        <>
          {rule && (
            <button className="btn btn-ghost" onClick={remove} aria-label="Delete rule">
              <Icon name="trash" size={16} />
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!valid || busy}>
            Save rule
          </button>
        </>
      }
    >
      <Field label="When the bank's payee">
        <div className="segmented" style={{ marginBottom: 8 }}>
          {TYPES.map((t) => (
            <button key={t.key} aria-pressed={matchType === t.key} onClick={() => setMatchType(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <input className="input" value={match} onChange={(e) => setMatch(e.target.value)} placeholder="blue bottle" aria-label="Payee text" />
      </Field>
      <Field label="Rename it to">
        <input className="input" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} placeholder="Keep the bank's name" aria-label="Rename to" />
      </Field>
      <Field label="Put it in">
        <CategorySelect value={categoryId} onChange={setCategoryId} noneLabel="Don't change the category" />
      </Field>

      <div className="rule-preview">
        {preview.names.length === 0 ? (
          <span className="dim">{match.trim() ? 'Nothing so far matches. It will apply to future imports.' : 'Type part of the name your bank uses.'}</span>
        ) : (
          <>
            <div className="dim">
              Matches {preview.names.length} payee{preview.names.length === 1 ? '' : 's'} · {preview.count} transaction{preview.count === 1 ? '' : 's'}
            </div>
            <div className="names">
              {preview.names.slice(0, 6).map((n) => (
                <span key={n}>{n}</span>
              ))}
              {preview.names.length > 6 && <span>+{preview.names.length - 6} more</span>}
            </div>
            {preview.count > 0 && (
              <label className="checkbox" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={fixPast} onChange={(e) => setFixPast(e.target.checked)} />
                Also fix {preview.count === 1 ? 'that transaction' : `those ${preview.count} transactions`}
              </label>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
