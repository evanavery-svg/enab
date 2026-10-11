import { useMemo, useState } from 'react'
import { Drawer, ConfirmDialog } from './Modal'
import { Icon } from './Icon'
import { TargetEditor } from './TargetEditor'
import { MoveMoneyModal } from './MoveMoneyModal'
import { AmountInput } from './Fields'
import { useData } from '../hooks/useData'
import { toast, useUi } from '../state/ui'
import { deleteCategory, setAssigned, updateCategory } from '../db/actions'
import { QUICK_BUDGET_LABELS, quickBudgetAmount, type QuickBudgetAction } from '../budget/quickBudget'
import { describeGoal } from '../budget/goals'
import { friendlyDate, monthLabel } from '../lib/dates'
import type { Id } from '../types'

const QUICK_ACTIONS: QuickBudgetAction[] = [
  'underfunded',
  'assignedLastMonth',
  'spentLastMonth',
  'averageAssigned',
  'averageSpent',
  'resetAvailable',
  'resetAssigned',
]

export function CategoryDetail({ categoryId }: { categoryId: Id }) {
  const { categoryById, budget, money, transactions, payeeById, settings, accountById, categories } = useData()
  const month = useUi((s) => s.month)
  const close = useUi((s) => s.openCategoryDetail)
  const openTxn = useUi((s) => s.openTxnModal)

  const [editingTarget, setEditingTarget] = useState(false)
  const [moving, setMoving] = useState<{ from?: Id | null; to?: Id | null; amount?: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const category = categoryById.get(categoryId)
  const state = budget.categoryStates.get(month)?.get(categoryId)

  const monthTransactions = useMemo(() => {
    if (!category) return []
    const rows: { id: string; date: string; payee: string; amount: number; account: string }[] = []
    for (const t of transactions) {
      if (t.month !== month) continue
      const account = accountById.get(t.accountId)
      if (!account?.onBudget) continue
      const payee = t.payeeId ? (payeeById.get(t.payeeId)?.name ?? '') : ''
      if (t.subtransactions?.length) {
        for (const s of t.subtransactions) {
          if (s.categoryId === categoryId) {
            rows.push({ id: s.id, date: t.date, payee: payee || 'Split', amount: s.amount, account: account.name })
          }
        }
      } else if (t.categoryId === categoryId) {
        rows.push({ id: t.id, date: t.date, payee, amount: t.amount, account: account.name })
      }
    }
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [transactions, month, categoryId, category, accountById, payeeById])

  if (!category || !state) return null

  const isPaymentCategory = !!category.linkedAccountId
  const linkedAccount = category.linkedAccountId ? accountById.get(category.linkedAccountId) : undefined

  async function applyQuick(action: QuickBudgetAction) {
    const amount = quickBudgetAmount(action, budget, month, categoryId)
    if (amount === null) {
      toast('Nothing to apply for that option')
      return
    }
    await setAssigned(month, categoryId, amount)
    toast(`${QUICK_BUDGET_LABELS[action]} applied`)
  }

  async function saveName() {
    if (name.trim()) await updateCategory(categoryId, { name: name.trim() })
    setRenaming(false)
  }

  async function saveNote() {
    if (note === null) return
    await updateCategory(categoryId, { note })
    setNote(null)
    toast('Note saved')
  }

  async function remove() {
    // Everything that pointed here gets moved to whatever the user is most
    // likely to want: nothing, so the transactions surface as uncategorised.
    await deleteCategory(categoryId, null)
    toast('Category deleted — its transactions now need a category')
    setConfirmDelete(false)
    close(null)
  }

  const availableClass =
    state.available > 0
      ? 'pos'
      : state.available < 0
        ? state.creditOverspending > 0 && state.cashOverspending === 0
          ? 'warn'
          : 'neg'
        : 'dim'

  return (
    <>
      <Drawer
        title={
          renaming ? (
            <input
              className="input"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === 'Enter' && saveName()}
            />
          ) : (
            <button
              className="btn btn-ghost"
              style={{ padding: 0, fontSize: 16, fontWeight: 650 }}
              onClick={() => {
                setName(category.name)
                setRenaming(true)
              }}
            >
              {category.name}
            </button>
          )
        }
        onClose={() => close(null)}
        footer={
          <>
            {state && state.available < 0 ? (
              <button className="btn btn-block" onClick={() => setMoving({ to: categoryId, amount: -state.available })}>
                <Icon name="alert" size={16} /> Cover overspending
              </button>
            ) : (
              <button className="btn btn-block" onClick={() => setMoving({ from: categoryId })}>
                <Icon name="transfer" size={16} /> Move money
              </button>
            )}
            <button
              className="btn btn-primary btn-block"
              onClick={() => openTxn({ categoryId })}
            >
              <Icon name="plus" size={16} /> Transaction
            </button>
          </>
        }
      >
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>
          {monthLabel(month)}
          {isPaymentCategory && linkedAccount && ` · pays ${linkedAccount.name}`}
        </div>

        <div className="detail-amounts">
          <div>
            <div className="k">Assigned</div>
            <div className="v">{money(state.assigned)}</div>
          </div>
          <div>
            <div className="k">Activity</div>
            <div className="v">{money(state.activity)}</div>
          </div>
          <div>
            <div className="k">Available</div>
            <div className={`v ${availableClass}`}>{money(state.available)}</div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <span className="label" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
            Assign
          </span>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <AmountInput
              value={state.assigned}
              onChange={(v) => setAssigned(month, categoryId, v)}
              commitOnBlur
              blankZero
              placeholder="0.00"
            />
          </div>
          {state.carriedOver !== 0 && (
            <div className="hint" style={{ marginTop: 5 }}>
              {state.carriedOver > 0
                ? `${money(state.carriedOver)} rolled over from last month.`
                : `${money(-state.carriedOver)} of unfunded credit spending rolled over.`}
            </div>
          )}
        </div>

        {state.available < 0 && (
          <button
            className="btn btn-block"
            style={{ marginBottom: 16, borderColor: 'var(--danger)', color: 'var(--danger)' }}
            onClick={() => setMoving({ to: categoryId, amount: -state.available })}
          >
            <Icon name="alert" size={16} /> Cover {money(-state.available)} of overspending
          </button>
        )}

        <div className="goal-card">
          {category.goal ? (
            <>
              <div className="goal-head">
                <strong>{describeGoal(category.goal, money)}</strong>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditingTarget(true)}>
                  Edit
                </button>
              </div>
              <div className={`progress${state.goalUnderfunded === 0 ? ' done' : state.goalPercent > 0 ? ' behind' : ''}`}>
                <span style={{ width: `${Math.round(state.goalPercent * 100)}%` }} />
              </div>
              <div className="dim" style={{ fontSize: 12.5, marginTop: 7 }}>
                {state.goalUnderfunded > 0
                  ? `${money(state.goalUnderfunded)} still needed this month`
                  : 'Fully funded this month'}
                {state.goalTarget > 0 && ` · target ${money(state.goalTarget)}`}
              </div>
            </>
          ) : (
            <button className="btn btn-sm btn-block" onClick={() => setEditingTarget(true)}>
              <Icon name="target" size={15} /> Create a target
            </button>
          )}
        </div>

        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 650, fontSize: 14, marginBottom: 8 }}>
            Auto-assign
          </summary>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {QUICK_ACTIONS.map((action) => {
              const amount = quickBudgetAmount(action, budget, month, categoryId)
              return (
                <button
                  key={action}
                  className="btn btn-sm"
                  disabled={amount === null}
                  onClick={() => applyQuick(action)}
                >
                  {QUICK_BUDGET_LABELS[action]}
                  {amount !== null && amount !== state.assigned && (
                    <span className="dim" style={{ fontFamily: 'var(--font-num)' }}>
                      {money(amount)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </details>

        <div style={{ marginBottom: 16 }}>
          <span className="label" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
            Notes
          </span>
          <textarea
            className="textarea"
            style={{ marginTop: 6 }}
            placeholder="What is this category for?"
            value={note ?? category.note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
          />
        </div>

        <div>
          <span className="label" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
            {monthLabel(month, { withYear: false })} activity
          </span>
          {monthTransactions.length === 0 ? (
            <p className="dim" style={{ fontSize: 13.5, marginTop: 8 }}>
              No transactions in this category yet.
            </p>
          ) : (
            <div style={{ marginTop: 4 }}>
              {monthTransactions.map((t) => (
                <div className="mini-txn" key={t.id}>
                  <div className="who">
                    <div className="truncate">{t.payee || 'No payee'}</div>
                    <div className="when">
                      {friendlyDate(t.date, settings.dateFormat)} · {t.account}
                    </div>
                  </div>
                  <div className={`amt ${t.amount < 0 ? '' : 'pos'}`}>{money(t.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!isPaymentCategory && (
          <>
            <hr className="divider" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  await updateCategory(categoryId, { hidden: !category.hidden })
                  toast(category.hidden ? 'Category shown' : 'Category hidden')
                }}
              >
                <Icon name={category.hidden ? 'eye' : 'eyeOff'} size={15} />
                {category.hidden ? 'Unhide' : 'Hide'} category
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={15} /> Delete
              </button>
            </div>
          </>
        )}
      </Drawer>

      {editingTarget && <TargetEditor category={category} onClose={() => setEditingTarget(false)} />}
      {moving && (
        <MoveMoneyModal
          fromCategoryId={moving.from}
          toCategoryId={moving.to}
          suggestedAmount={moving.amount ?? 0}
          onClose={() => setMoving(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${category.name}"?`}
          message={
            <>
              Any transactions in this category will be left without one, and its budget history will be
              removed. {categories.length <= 1 && 'This is your last category.'}
            </>
          }
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
