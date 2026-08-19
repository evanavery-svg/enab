import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { AmountInput, Field } from './Fields'
import { useData } from '../hooks/useData'
import { moveMoney } from '../db/actions'
import { toast, useUi } from '../state/ui'
import type { Cents, Id } from '../types'

/** `null` on either side means Ready to Assign. */
export function MoveMoneyModal({
  fromCategoryId,
  toCategoryId,
  suggestedAmount = 0,
  onClose,
}: {
  fromCategoryId?: Id | null
  toCategoryId?: Id | null
  suggestedAmount?: Cents
  onClose: () => void
}) {
  const { categories, groups, budget, money, categoryById } = useData()
  const month = useUi((s) => s.month)
  const states = budget.categoryStates.get(month)

  const [from, setFrom] = useState<Id | null>(fromCategoryId ?? null)
  const [to, setTo] = useState<Id | null>(toCategoryId ?? null)
  const [amount, setAmount] = useState<Cents>(Math.abs(suggestedAmount))

  const readyToAssign = budget.summaries.get(month)?.readyToAssign ?? 0

  const options = useMemo(() => {
    const visible = groups
      .filter((g) => !g.isInternal && !g.hidden)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({
        group: g,
        items: categories
          .filter((c) => c.groupId === g.id && !c.hidden)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .filter((e) => e.items.length > 0)
    return visible
  }, [groups, categories])

  const availableOf = (id: Id | null) =>
    id === null ? readyToAssign : (states?.get(id)?.available ?? 0)

  const fromAvailable = availableOf(from)
  const nameOf = (id: Id | null) => (id === null ? 'Ready to Assign' : (categoryById.get(id)?.name ?? '—'))

  const valid = amount > 0 && from !== to

  async function submit() {
    if (!valid) return
    await moveMoney(month, from, to, amount)
    toast(`Moved ${money(amount)} from ${nameOf(from)} to ${nameOf(to)}`)
    onClose()
  }

  const picker = (value: Id | null, onChange: (id: Id | null) => void, label: string) => (
    <Field label={label}>
      <select
        className="select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Ready to Assign ({money(readyToAssign)})</option>
        {options.map(({ group, items }) => (
          <optgroup key={group.id} label={group.name}>
            {items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({money(states?.get(c.id)?.available ?? 0)})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Field>
  )

  return (
    <Modal
      title="Move Money"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!valid}>
            Move {money(amount)}
          </button>
        </>
      }
    >
      {picker(from, setFrom, 'From')}
      {picker(to, setTo, 'To')}
      <Field
        label="Amount"
        hint={
          amount > fromAvailable && fromAvailable >= 0
            ? `${nameOf(from)} only has ${money(fromAvailable)} — moving more will leave it overspent.`
            : undefined
        }
      >
        <AmountInput value={amount} onChange={(v) => setAmount(Math.abs(v))} blankZero placeholder="0.00" />
      </Field>
      {fromAvailable > 0 && (
        <button className="btn btn-sm" onClick={() => setAmount(fromAvailable)}>
          Move all {money(fromAvailable)}
        </button>
      )}
    </Modal>
  )
}
