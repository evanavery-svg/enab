import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { AmountInput, Field } from './Fields'
import { Icon } from './Icon'
import { useData } from '../hooks/useData'
import { moveMoney } from '../db/actions'
import { toast, useUi } from '../state/ui'
import type { Cents, Id } from '../types'

/**
 * Move money between envelopes. `null` on either side means Ready to Assign.
 *
 * Opened with a `toCategoryId` that is overspent, it becomes the "cover"
 * flow: a list of places the money could come from, one tap each. That is
 * the move people make most — a category went over, pull from one that has
 * slack — and it should not need two dropdowns and a typed amount.
 */
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
  const readyToAssign = budget.summaries.get(month)?.readyToAssign ?? 0

  const availableOf = (id: Id | null) => (id === null ? readyToAssign : (states?.get(id)?.available ?? 0))
  const nameOf = (id: Id | null) => (id === null ? 'Ready to Assign' : (categoryById.get(id)?.name ?? '—'))

  // Cover mode: a destination was given and it is short. Decided once, on
  // open — judged live, it would flip off the instant the gap closed and
  // swap this sheet for the plain form instead of finishing.
  const [covering] = useState(
    () => toCategoryId !== undefined && fromCategoryId === undefined && availableOf(toCategoryId ?? null) < 0,
  )
  const [manual, setManual] = useState(!covering)
  const [covered, setCovered] = useState(0)

  const [from, setFrom] = useState<Id | null>(fromCategoryId ?? null)
  const [to, setTo] = useState<Id | null>(toCategoryId ?? null)
  const [amount, setAmount] = useState<Cents>(Math.abs(suggestedAmount))

  const options = useMemo(
    () =>
      groups
        .filter((g) => !g.isInternal && !g.hidden)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((g) => ({
          group: g,
          items: categories.filter((c) => c.groupId === g.id && !c.hidden).sort((a, b) => a.sortOrder - b.sortOrder),
        }))
        .filter((e) => e.items.length > 0),
    [groups, categories],
  )

  /** Where money could come from, most slack first. */
  const sources = useMemo(() => {
    const target = toCategoryId ?? null
    type Source = { id: Id | null; name: string; available: Cents; group?: string }
    const fromCategories: Source[] = []
    for (const { group, items } of options) {
      for (const c of items) {
        const available = states?.get(c.id)?.available ?? 0
        if (c.id !== target && available > 0) fromCategories.push({ id: c.id, name: c.name, available, group: group.name })
      }
    }
    fromCategories.sort((a, b) => b.available - a.available)
    // Ready to Assign goes first: it is money with no job yet, so taking from
    // it costs nothing. The rest by how much they can spare.
    const rta: Source[] = readyToAssign > 0 ? [{ id: null, name: 'Ready to Assign', available: readyToAssign }] : []
    return [...rta, ...fromCategories]
  }, [options, states, readyToAssign, toCategoryId])

  const needed = covering ? -availableOf(toCategoryId ?? null) : 0

  // Once the gap is closed the job is done; don't make anyone find Cancel.
  useEffect(() => {
    if (covering && !manual && covered > 0 && needed <= 0) onClose()
  }, [covering, manual, covered, needed, onClose])

  async function coverFrom(source: Id | null, available: Cents) {
    const take = Math.min(needed, available)
    if (take <= 0) return
    await moveMoney(month, source, toCategoryId ?? null, take)
    setCovered((c) => c + take)
    const left = needed - take
    toast(
      left > 0
        ? `Moved ${money(take)} from ${nameOf(source)} — ${money(left)} still to cover`
        : `Covered with ${money(take)} from ${nameOf(source)}`,
    )
  }

  const fromAvailable = availableOf(from)
  const valid = amount > 0 && from !== to

  async function submit() {
    if (!valid) return
    await moveMoney(month, from, to, amount)
    toast(`Moved ${money(amount)} from ${nameOf(from)} to ${nameOf(to)}`)
    onClose()
  }

  const picker = (value: Id | null, onChange: (id: Id | null) => void, label: string) => (
    <Field label={label}>
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
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

  if (covering && !manual) {
    return (
      <Modal
        title={`Cover ${nameOf(toCategoryId ?? null)}`}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setManual(true)}>
              Choose an amount instead
            </button>
            <span className="spacer" />
            <button className="btn" onClick={onClose}>
              Done
            </button>
          </>
        }
      >
        <div className="cover-need">
          <span className="k">Still needs</span>
          <span className="v">{money(needed)}</span>
        </div>
        {sources.length === 0 ? (
          <p className="dim">Nothing has money to spare this month. Add income, or assign less elsewhere.</p>
        ) : (
          <>
            <p className="dim" style={{ fontSize: 13.5, margin: '0 0 8px' }}>Take it from…</p>
            <ul className="cover-list">
              {sources.map((s) => {
                const take = Math.min(needed, s.available)
                return (
                  <li key={s.id ?? 'rta'}>
                    <button type="button" onClick={() => coverFrom(s.id, s.available)}>
                      <span className="who">
                        <span className="name truncate">{s.name}</span>
                        {s.group && <span className="sub">{s.group}</span>}
                      </span>
                      <span className="has">{money(s.available)}</span>
                      <span className={`take${take < needed ? ' partial' : ''}`}>
                        {take < needed ? `take all` : `take ${money(take)}`}
                        <Icon name="chevronRight" size={14} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Modal>
    )
  }

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
