import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { NavMenuButton } from '../components/NavMenuButton'
import { AmountInput } from '../components/Fields'
import { CsvImportModal } from '../components/CsvImportModal'
import { useData } from '../hooks/useData'
import { toast, useUi } from '../state/ui'
import { createScheduled, setAssignedBulk, setCategoryGoal } from '../db/actions'
import { buildBudgetPlan, CADENCE_LABELS, type Cadence, type RecurringSeries } from '../budget/analyze'
import { friendlyDate, monthLabel, today } from '../lib/dates'
import type { Cents, Frequency, Id } from '../types'

/** How a detected rhythm maps onto ENAB's schedule frequencies. */
const CADENCE_TO_FREQUENCY: Record<Exclude<Cadence, 'irregular'>, Frequency> = {
  weekly: 'weekly',
  biweekly: 'everyOtherWeek',
  monthly: 'monthly',
  bimonthly: 'everyOtherMonth',
  quarterly: 'every3Months',
  semiannual: 'every6Months',
  yearly: 'yearly',
}

export default function PlanPage() {
  const data = useData()
  const { accounts, categories, groups, payees, transactions, budget, money, settings, scheduled } = data
  const month = useUi((s) => s.month)
  const openDetail = useUi((s) => s.openCategoryDetail)
  const navigate = useNavigate()

  const [importing, setImporting] = useState(false)
  const [overrides, setOverrides] = useState<Map<Id, Cents>>(new Map())
  const [excluded, setExcluded] = useState<Set<Id>>(new Set())
  const [createTargets, setCreateTargets] = useState(false)
  const [applying, setApplying] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const todayIso = today()

  const plan = useMemo(
    () =>
      buildBudgetPlan({
        month,
        accounts,
        categories,
        groups,
        payees,
        transactions,
        budget,
      }),
    [month, accounts, categories, groups, payees, transactions, budget],
  )

  const included = plan.rows.filter((r) => !excluded.has(r.categoryId) && amountFor(r.categoryId, r.suggested) > 0)
  const plannedTotal = included.reduce((sum, r) => sum + amountFor(r.categoryId, r.suggested), 0)

  function amountFor(categoryId: Id, fallback: Cents): Cents {
    return overrides.get(categoryId) ?? fallback
  }

  function setAmount(categoryId: Id, value: Cents) {
    setOverrides((prev) => new Map(prev).set(categoryId, value))
  }

  function toggle(categoryId: Id) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  async function apply() {
    if (included.length === 0) return
    setApplying(true)
    try {
      await setAssignedBulk(
        month,
        included.map((r) => ({ categoryId: r.categoryId, assigned: amountFor(r.categoryId, r.suggested) })),
      )
      if (createTargets) {
        for (const row of included) {
          await setCategoryGoal(row.categoryId, {
            type: 'need',
            amount: amountFor(row.categoryId, row.suggested),
            cadence: 'monthly',
            fundingStyle: 'refill',
            startMonth: month,
          })
        }
      }
      toast(
        `Assigned ${money(plannedTotal)} across ${included.length} categories${createTargets ? ' and created targets' : ''}`,
      )
      // The assigned budget is the thing to look at next.
      navigate('/')
    } finally {
      setApplying(false)
    }
  }

  async function scheduleSubscription(series: RecurringSeries) {
    if (series.cadence === 'irregular') return
    const account = accounts.find((a) => !a.closed && a.onBudget)
    if (!account) return
    await createScheduled({
      accountId: account.id,
      nextDate: series.nextExpected,
      frequency: CADENCE_TO_FREQUENCY[series.cadence],
      amount: -series.amount,
      payeeId: series.payeeId,
      categoryId: series.categoryId,
      memo: '',
      flag: null,
      autoEnter: false,
      paused: false,
    })
    toast(`${series.payeeName} added to Scheduled`)
  }

  const alreadyScheduled = useMemo(
    () => new Set(scheduled.map((s) => s.payeeId).filter(Boolean) as Id[]),
    [scheduled],
  )

  const monthsAnalyzed = plan.monthsAnalyzed.length
  const hasEnoughHistory = monthsAnalyzed >= 1 && plan.rows.some((r) => r.suggested > 0)

  // Lapsed subscriptions are worth surfacing: they are what you stopped paying.
  const inactive = plan.recurring.filter((s) => !s.active && s.isSubscription)

  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>Auto-Budget</h1>
          <div className="subtitle">Planning {monthLabel(month)}</div>
        </div>
        <button className="btn btn-sm" onClick={() => setImporting(true)}>
          <Icon name="upload" size={15} /> Import CSV
        </button>
      </header>

      <div className="content content-pad">
        <div className="content-narrow">
          {!hasEnoughHistory ? (
            <div className="card empty">
              <h3>Nothing to learn from yet</h3>
              <p>
                Import a CSV of your past transactions — a few months is plenty — and ENAB will work out what
                you typically spend, find your subscriptions, and propose a budget for {monthLabel(month)}.
              </p>
              <button className="btn btn-primary btn-lg" style={{ marginTop: 14 }} onClick={() => setImporting(true)}>
                <Icon name="upload" size={17} /> Import a CSV
              </button>
              <p className="hint" style={{ marginTop: 12 }}>
                Most banks export <code>Date, Description, Amount</code>. ENAB matches the columns for you.
              </p>
            </div>
          ) : (
            <>
              <div className="acct-summary">
                <div className="card stat">
                  <div className="k">Learned from</div>
                  <div className="v">
                    {monthsAnalyzed} month{monthsAnalyzed === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="card stat">
                  <div className="k">Typical income</div>
                  <div className="v pos">{money(plan.medianIncome)}</div>
                </div>
                <div className="card stat">
                  <div className="k">Plan total</div>
                  <div className="v">{money(plannedTotal)}</div>
                </div>
                <div className="card stat">
                  <div className="k">Recurring</div>
                  <div className="v">{money(plan.subscriptionMonthlyTotal)}<span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>/mo</span></div>
                </div>
              </div>

              {plan.medianIncome > 0 && (
                <div
                  className="card card-pad"
                  style={{
                    marginBottom: 16,
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    color: plannedTotal > plan.medianIncome ? 'var(--danger)' : 'var(--positive)',
                  }}
                >
                  <Icon name={plannedTotal > plan.medianIncome ? 'alert' : 'check'} size={18} />
                  <div style={{ fontSize: 14 }}>
                    {plannedTotal > plan.medianIncome ? (
                      <>
                        This plan needs <strong>{money(plannedTotal - plan.medianIncome)}</strong> more than you
                        typically earn in a month.{' '}
                        <span className="dim">Trim a category or two before assigning.</span>
                      </>
                    ) : (
                      <>
                        <strong>{money(plan.medianIncome - plannedTotal)}</strong> of a typical month is left over
                        after this plan. <span className="dim">Consider putting it toward savings or debt.</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ---- Subscriptions ---- */}
              <section className="card" style={{ marginBottom: 16 }}>
                <div className="plan-section-head">
                  <div>
                    <h3>Subscriptions &amp; recurring bills</h3>
                    <p className="dim">
                      Charges that arrive on a schedule for about the same amount, found in your history.
                    </p>
                  </div>
                  <div className="plan-total">
                    <span className="v">{money(plan.subscriptionYearlyTotal)}</span>
                    <span className="k">a year</span>
                  </div>
                </div>

                {plan.subscriptions.length === 0 ? (
                  <p className="dim" style={{ padding: '0 16px 16px', fontSize: 14 }}>
                    No repeating charges found yet. ENAB needs to see a payee at least three times before it
                    calls something recurring.
                  </p>
                ) : (
                  <ul className="sub-list">
                    {plan.subscriptions.map((s) => (
                      <li key={s.id}>
                        <div className="grow">
                          <div className="name truncate">{s.payeeName}</div>
                          <div className="meta">
                            {CADENCE_LABELS[s.cadence]}
                            {' · '}
                            {s.categoryName ?? <span className="neg">Needs a category</span>}
                            {' · '}
                            {s.nextExpected < todayIso ? (
                              <span className="warn">due {friendlyDate(s.nextExpected, settings.dateFormat)}</span>
                            ) : (
                              <>due {friendlyDate(s.nextExpected, settings.dateFormat)}</>
                            )}
                            {s.amountKind === 'steady' && ' · amount varies slightly'}
                          </div>
                        </div>
                        <div className="cost">
                          <div className="each">{money(s.amount)}</div>
                          <div className="per">{money(s.monthlyCost)}/mo</div>
                        </div>
                        <button
                          className="btn btn-sm"
                          disabled={s.payeeId ? alreadyScheduled.has(s.payeeId) : false}
                          title={
                            s.payeeId && alreadyScheduled.has(s.payeeId)
                              ? 'Already scheduled'
                              : 'Add to Scheduled'
                          }
                          onClick={() => scheduleSubscription(s)}
                        >
                          <Icon name="repeat" size={14} />
                          {s.payeeId && alreadyScheduled.has(s.payeeId) ? 'Scheduled' : 'Schedule'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {inactive.length > 0 && (
                  <div className="plan-inactive">
                    <button className="btn btn-sm btn-ghost" onClick={() => setShowInactive((v) => !v)}>
                      <Icon name={showInactive ? 'chevronUp' : 'chevronDown'} size={14} />
                      {inactive.length} that stopped charging
                    </button>
                    {showInactive && (
                      <ul className="sub-list">
                        {inactive.map((s) => (
                          <li key={s.id}>
                            <div className="grow">
                              <div className="name truncate">{s.payeeName}</div>
                              <div className="meta">
                                {CADENCE_LABELS[s.cadence]} · last charged{' '}
                                {friendlyDate(s.lastDate, settings.dateFormat)}
                              </div>
                            </div>
                            <div className="cost">
                              <div className="each">{money(s.amount)}</div>
                              <div className="per">was {money(s.monthlyCost)}/mo</div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>

              {/* ---- The plan ---- */}
              <section className="card" style={{ marginBottom: 100 }}>
                <div className="plan-section-head">
                  <div>
                    <h3>Suggested plan</h3>
                    <p className="dim">
                      Built from a typical month, so a one-off splurge doesn't set your budget. Edit anything
                      before applying.
                    </p>
                  </div>
                </div>

                <ul className="plan-list">
                  {plan.rows
                    .filter((r) => r.suggested > 0 || r.currentlyAssigned > 0)
                    .map((row) => {
                      const off = excluded.has(row.categoryId)
                      return (
                        <li key={row.categoryId} className={off ? 'off' : undefined}>
                          <input
                            type="checkbox"
                            className="toggle"
                            checked={!off}
                            onChange={() => toggle(row.categoryId)}
                            aria-label={`Include ${row.categoryName}`}
                          />
                          <div className="grow">
                            <button className="name truncate" onClick={() => openDetail(row.categoryId)}>
                              {row.categoryName}
                            </button>
                            <div className="meta">
                              <span className="dim">{row.groupName}</span> · {row.basis}
                              {row.currentlyAssigned > 0 && ` · now ${money(row.currentlyAssigned)}`}
                            </div>
                          </div>
                          <div className="amount-cell">
                            <AmountInput
                              value={amountFor(row.categoryId, row.suggested)}
                              onChange={(v) => setAmount(row.categoryId, v)}
                              blankZero
                              aria-label={`Amount for ${row.categoryName}`}
                            />
                          </div>
                        </li>
                      )
                    })}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>

      {hasEnoughHistory && (
        <div className="bulk-bar">
          <label className="checkbox" style={{ marginRight: 'auto' }}>
            <input type="checkbox" checked={createTargets} onChange={(e) => setCreateTargets(e.target.checked)} />
            Also create monthly targets
          </label>
          <button className="btn btn-primary" onClick={apply} disabled={applying || included.length === 0}>
            Assign {money(plannedTotal)} to {included.length} categor{included.length === 1 ? 'y' : 'ies'}
          </button>
        </div>
      )}

      {importing && <CsvImportModal onClose={() => setImporting(false)} />}
    </>
  )
}
