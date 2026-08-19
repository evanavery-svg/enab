import { useEffect, useMemo, useState } from 'react'
import { Modal, ConfirmDialog } from './Modal'
import { AmountInput, ComboBox, Field } from './Fields'
import { CategorySelect } from './CategorySelect'
import { Icon } from './Icon'
import { useData } from '../hooks/useData'
import { useUi, toast } from '../state/ui'
import {
  createScheduled,
  createTransaction,
  deleteTransaction,
  findOrCreatePayeeId,
  updateTransaction,
} from '../db/actions'
import { FREQUENCIES, FREQUENCY_LABELS } from '../budget/recurrence'
import { today } from '../lib/dates'
import { splitEvenly } from '../lib/money'
import { uid } from '../lib/id'
import type { Cents, FlagColor, Frequency, Id, SubTransaction } from '../types'

const FLAGS: { color: Exclude<FlagColor, null>; label: string }[] = [
  { color: 'red', label: 'Red' },
  { color: 'orange', label: 'Orange' },
  { color: 'yellow', label: 'Yellow' },
  { color: 'green', label: 'Green' },
  { color: 'blue', label: 'Blue' },
  { color: 'purple', label: 'Purple' },
]

type Leg = SubTransaction

export function TransactionModal() {
  const { accounts, openAccounts, payees, transactions, accountById, money } = useData()
  const modal = useUi((s) => s.txnModal)
  const close = useUi((s) => s.closeTxnModal)

  const existing = modal?.transactionId
    ? transactions.find((t) => t.id === modal.transactionId)
    : undefined

  const [accountId, setAccountId] = useState<Id>(
    existing?.accountId ?? modal?.accountId ?? openAccounts[0]?.id ?? '',
  )
  const [date, setDate] = useState(existing?.date ?? today())
  const [payeeName, setPayeeName] = useState('')
  const [payeeId, setPayeeId] = useState<Id | null>(existing?.payeeId ?? null)
  const [transferAccountId, setTransferAccountId] = useState<Id | null>(
    existing?.transferAccountId ?? null,
  )
  const [categoryId, setCategoryId] = useState<Id | null>(
    existing?.categoryId ?? modal?.categoryId ?? null,
  )
  const [isInflow, setIsInflow] = useState((existing?.amount ?? -1) > 0)
  const [magnitude, setMagnitude] = useState<Cents>(Math.abs(existing?.amount ?? 0))
  const [memo, setMemo] = useState(existing?.memo ?? '')
  const [cleared, setCleared] = useState(existing ? existing.cleared !== 'uncleared' : false)
  const [flag, setFlag] = useState<FlagColor>(existing?.flag ?? null)
  const [legs, setLegs] = useState<Leg[]>(existing?.subtransactions ?? [])
  const [repeat, setRepeat] = useState<Frequency>('once')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)

  const isSplit = legs.length > 0
  const locked = existing?.cleared === 'reconciled'

  useEffect(() => {
    if (!existing) return
    const p = payees.find((x) => x.id === existing.payeeId)
    setPayeeName(p?.name ?? '')
  }, [existing, payees])

  const payeeOptions = useMemo(() => {
    const regular = payees
      .filter((p) => !p.transferAccountId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, label: p.name }))
    const transfers = accounts
      .filter((a) => a.id !== accountId && !a.closed)
      .map((a) => ({ id: `transfer:${a.id}`, label: `Transfer : ${a.name}`, group: 'Transfer' }))
    return [...transfers, ...regular]
  }, [payees, accounts, accountId])

  const signed = (v: Cents) => (isInflow ? Math.abs(v) : -Math.abs(v))
  const amount = signed(magnitude)

  const legTotal = legs.reduce((sum, l) => sum + l.amount, 0)
  const remaining = amount - legTotal

  const account = accountById.get(accountId)
  const transferTarget = transferAccountId ? accountById.get(transferAccountId) : undefined
  // A transfer between two on-budget accounts is not spending, so it has no
  // category. When one side is off budget, the money really does enter or
  // leave the budget and needs one.
  const transferNeedsCategory =
    !!transferTarget && !!account && account.onBudget !== transferTarget.onBudget
  const showCategory = !transferAccountId || transferNeedsCategory

  function onPickPayee(label: string, id?: string) {
    setPayeeName(label)
    if (id?.startsWith('transfer:')) {
      setTransferAccountId(id.slice('transfer:'.length))
      setPayeeId(null)
      setLegs([])
    } else {
      setTransferAccountId(null)
      setPayeeId(id ?? null)
      // Reuse the category this payee usually gets, unless one is already set.
      const p = payees.find((x) => x.id === id)
      if (p?.lastCategoryId && !categoryId && !existing) setCategoryId(p.lastCategoryId)
    }
  }

  function addLeg() {
    setLegs((current) => {
      const next: Leg[] = [
        ...current,
        { id: uid('sub'), amount: current.length === 0 ? amount : remaining, categoryId, memo: '' },
      ]
      return next
    })
    setCategoryId(null)
  }

  function distributeEvenly() {
    if (legs.length === 0) return
    const parts = splitEvenly(amount, legs.length)
    setLegs(legs.map((l, i) => ({ ...l, amount: parts[i] })))
  }

  async function save() {
    if (!accountId) return
    if (isSplit && remaining !== 0) {
      toast('Split amounts must add up to the total', { tone: 'danger' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        accountId,
        date,
        amount,
        payeeId: transferAccountId ? null : payeeId,
        payeeName: transferAccountId ? undefined : payeeName,
        categoryId: showCategory && !isSplit ? categoryId : null,
        memo,
        cleared: (cleared ? 'cleared' : 'uncleared') as 'cleared' | 'uncleared',
        flag,
        transferAccountId,
        subtransactions: isSplit ? legs : undefined,
      }

      if (existing) {
        await updateTransaction(existing.id, {
          ...payload,
          cleared: existing.cleared === 'reconciled' ? 'reconciled' : payload.cleared,
        })
        toast('Transaction saved')
      } else {
        await createTransaction({
          ...payload,
          subtransactions: isSplit ? legs.map(({ id: _drop, ...rest }) => rest) : undefined,
        })
        if (repeat !== 'once') {
          // The payee may have just been typed for the first time, in which
          // case createTransaction minted it — look it up so the schedule
          // carries the payee too rather than showing "No payee" forever.
          const schedulePayeeId =
            transferAccountId ? null : (payeeId ?? (payeeName.trim() ? await findOrCreatePayeeId(payeeName) : null))
          await createScheduled({
            accountId,
            nextDate: date,
            frequency: repeat,
            amount,
            payeeId: schedulePayeeId,
            categoryId: showCategory && !isSplit ? categoryId : null,
            memo,
            flag,
            transferAccountId,
            subtransactions: isSplit ? legs : undefined,
            autoEnter: true,
            paused: false,
          })
          toast('Transaction added and scheduled to repeat')
        } else {
          toast('Transaction added')
        }
      }
      close()
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!existing) return
    await deleteTransaction(existing.id)
    toast('Transaction deleted')
    setConfirmDelete(false)
    close()
  }

  if (!modal) return null

  return (
    <>
      <Modal
        title={existing ? 'Edit Transaction' : 'Add Transaction'}
        onClose={close}
        footer={
          <>
            {existing && (
              <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={16} />
                Delete
              </button>
            )}
            <span className="spacer" />
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !accountId}>
              Save
            </button>
          </>
        }
      >
        {locked && (
          <div className="pill pill-info" style={{ marginBottom: 12 }}>
            <Icon name="lock" size={13} /> Reconciled — edits will change a locked balance
          </div>
        )}

        <div className="segmented" style={{ marginBottom: 14 }}>
          <button aria-pressed={!isInflow} onClick={() => setIsInflow(false)}>
            Outflow
          </button>
          <button aria-pressed={isInflow} onClick={() => setIsInflow(true)}>
            Inflow
          </button>
        </div>

        <Field label="Amount">
          <AmountInput
            value={magnitude}
            onChange={(v) => setMagnitude(Math.abs(v))}
            blankZero
            placeholder="0.00"
            autoFocus={!existing}
          />
        </Field>

        <div className="row">
          <Field label="Account">
            <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.closed ? ' (closed)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Payee">
          <ComboBox
            value={payeeName}
            onChange={onPickPayee}
            options={payeeOptions}
            placeholder="Who did the money go to?"
            emptyLabel="Press Enter to create this payee"
          />
        </Field>

        {showCategory && !isSplit && (
          <Field
            label="Category"
            hint={
              transferNeedsCategory
                ? 'One side of this transfer is off budget, so it needs a category.'
                : undefined
            }
          >
            <CategorySelect value={categoryId} onChange={setCategoryId} />
          </Field>
        )}

        {!transferAccountId && (
          <div style={{ marginBottom: 14 }}>
            {!isSplit ? (
              <button className="btn btn-sm btn-ghost" onClick={addLeg}>
                <Icon name="split" size={15} /> Split into multiple categories
              </button>
            ) : (
              <>
                <span className="label" style={{ display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-dim)' }}>
                  Splits
                </span>
                {legs.map((leg, i) => (
                  <div className="split-row" key={leg.id}>
                    <CategorySelect
                      value={leg.categoryId}
                      onChange={(id) =>
                        setLegs(legs.map((l, j) => (i === j ? { ...l, categoryId: id } : l)))
                      }
                    />
                    <AmountInput
                      value={leg.amount}
                      onChange={(v) => setLegs(legs.map((l, j) => (i === j ? { ...l, amount: v } : l)))}
                      blankZero
                    />
                    <button
                      className="icon-btn"
                      aria-label="Remove split"
                      onClick={() => setLegs(legs.filter((_, j) => j !== i))}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                ))}
                <div className={`split-remaining${remaining !== 0 ? ' off' : ''}`}>
                  <span>{remaining === 0 ? 'Fully split' : 'Left to assign'}</span>
                  <span className="num">{money(remaining)}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={addLeg}>
                    <Icon name="plus" size={14} /> Add split
                  </button>
                  <button className="btn btn-sm" onClick={distributeEvenly}>
                    Split evenly
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setLegs([])}>
                    Remove splits
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <Field label="Memo">
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>

        {!existing && (
          <Field label="Repeat" hint={repeat === 'once' ? undefined : 'ENAB will enter this for you automatically.'}>
            <select className="select" value={repeat} onChange={(e) => setRepeat(e.target.value as Frequency)}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <label className="checkbox">
            <input type="checkbox" checked={cleared} onChange={(e) => setCleared(e.target.checked)} />
            Cleared
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="dim" style={{ fontSize: 13 }}>
              Flag
            </span>
            <button
              className="icon-btn"
              style={{ width: 26, height: 26 }}
              aria-label="No flag"
              aria-pressed={flag === null}
              onClick={() => setFlag(null)}
            >
              <span className="flag-dot flag-none" />
            </button>
            {FLAGS.map((f) => (
              <button
                key={f.color}
                className="icon-btn"
                style={{
                  width: 26,
                  height: 26,
                  background: flag === f.color ? 'var(--surface-3)' : undefined,
                }}
                aria-label={f.label}
                aria-pressed={flag === f.color}
                onClick={() => setFlag(f.color)}
              >
                <span className={`flag-dot flag-${f.color}`} />
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete transaction?"
          message={
            existing?.transferTransactionId
              ? 'This is a transfer, so both sides will be deleted.'
              : 'This cannot be undone.'
          }
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
