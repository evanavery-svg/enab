import { useState } from 'react'
import { Modal } from './Modal'
import { AmountInput, Field } from './Fields'
import { setCategoryGoal } from '../db/actions'
import { toast, useUi } from '../state/ui'
import { DAY_NAMES, addMonths, monthLabel } from '../lib/dates'
import type { Category, Cents, Goal, GoalCadence, GoalType } from '../types'

const TYPE_OPTIONS: { value: GoalType; label: string; blurb: string }[] = [
  {
    value: 'need',
    label: 'Needed for spending',
    blurb: 'A recurring amount you spend — groceries, a subscription, an annual premium.',
  },
  {
    value: 'balance',
    label: 'Savings balance',
    blurb: 'Build up to an amount and keep it there. No deadline.',
  },
  {
    value: 'balanceByDate',
    label: 'Savings by date',
    blurb: 'Have a set amount saved by a specific month.',
  },
  { value: 'debt', label: 'Debt payoff', blurb: 'Clear a linked debt account by a target month.' },
]

const CADENCES: { value: GoalCadence; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom' },
]

/** Twelve months of choices either side of the current month. */
function monthOptions(from: string, count = 72): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(from, i))
}

export function TargetEditor({ category, onClose }: { category: Category; onClose: () => void }) {
  const month = useUi((s) => s.month)
  const existing = category.goal

  const [type, setType] = useState<GoalType>(existing?.type ?? 'need')
  const [amount, setAmount] = useState<Cents>(existing?.amount ?? 0)
  const [cadence, setCadence] = useState<GoalCadence>(existing?.cadence ?? 'monthly')
  const [every, setEvery] = useState(existing?.every ?? 3)
  const [cadenceUnit, setCadenceUnit] = useState<'month' | 'year'>(existing?.cadenceUnit ?? 'month')
  const [dayOfWeek, setDayOfWeek] = useState(existing?.dayOfWeek ?? 5)
  const [fundingStyle, setFundingStyle] = useState<'refill' | 'setAside'>(
    existing?.fundingStyle ?? 'refill',
  )
  const [targetMonth, setTargetMonth] = useState(existing?.targetMonth ?? addMonths(month, 6))
  const [startMonth, setStartMonth] = useState(existing?.startMonth ?? month)

  const needsTargetMonth =
    type === 'balanceByDate' || type === 'debt' || (type === 'need' && cadence !== 'monthly' && cadence !== 'weekly')

  async function save() {
    const goal: Goal = {
      type,
      amount,
      startMonth,
      ...(type === 'need'
        ? {
            cadence,
            fundingStyle,
            ...(cadence === 'weekly' ? { dayOfWeek } : {}),
            ...(cadence === 'custom' ? { every, cadenceUnit } : {}),
          }
        : {}),
      ...(needsTargetMonth ? { targetMonth } : {}),
    }
    await setCategoryGoal(category.id, goal)
    toast('Target saved')
    onClose()
  }

  async function clear() {
    await setCategoryGoal(category.id, undefined)
    toast('Target removed')
    onClose()
  }

  return (
    <Modal
      title={existing ? 'Edit Target' : 'Create Target'}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <button className="btn btn-danger" onClick={clear}>
              Remove target
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={amount <= 0}>
            Save target
          </button>
        </>
      }
    >
      <Field label="I want to…" hint={TYPE_OPTIONS.find((t) => t.value === type)?.blurb}>
        <select className="select" value={type} onChange={(e) => setType(e.target.value as GoalType)}>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label={type === 'need' ? 'Amount each period' : 'Target amount'}>
        <AmountInput value={amount} onChange={setAmount} blankZero placeholder="0.00" autoFocus />
      </Field>

      {type === 'need' && (
        <>
          <Field label="How often">
            <select
              className="select"
              value={cadence}
              onChange={(e) => setCadence(e.target.value as GoalCadence)}
            >
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          {cadence === 'weekly' && (
            <Field label="Day of week" hint="A five-week month automatically asks for five payments.">
              <select
                className="select"
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
              >
                {DAY_NAMES.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {cadence === 'custom' && (
            <div className="row">
              <Field label="Repeat every">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={60}
                  value={every}
                  onChange={(e) => setEvery(Math.max(1, Number(e.target.value)))}
                />
              </Field>
              <Field label="Unit">
                <select
                  className="select"
                  value={cadenceUnit}
                  onChange={(e) => setCadenceUnit(e.target.value as 'month' | 'year')}
                >
                  <option value="month">Months</option>
                  <option value="year">Years</option>
                </select>
              </Field>
            </div>
          )}

          <Field
            label="Funding style"
            hint={
              fundingStyle === 'refill'
                ? 'Tops the category back up to the amount, counting what is already there.'
                : 'Asks for the full amount again every period, no matter the balance.'
            }
          >
            <div className="segmented">
              <button aria-pressed={fundingStyle === 'refill'} onClick={() => setFundingStyle('refill')}>
                Refill up to
              </button>
              <button aria-pressed={fundingStyle === 'setAside'} onClick={() => setFundingStyle('setAside')}>
                Set aside another
              </button>
            </div>
          </Field>
        </>
      )}

      {needsTargetMonth && (
        <Field label="Target month" hint="ENAB spreads the remaining amount evenly until then.">
          <select className="select" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)}>
            {monthOptions(addMonths(month, -12)).map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Start month">
        <select className="select" value={startMonth} onChange={(e) => setStartMonth(e.target.value)}>
          {monthOptions(addMonths(month, -24), 60).map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  )
}
