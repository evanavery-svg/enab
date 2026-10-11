import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { NavMenuButton } from '../components/NavMenuButton'
import { CategorySelect } from '../components/CategorySelect'
import { MoveMoneyModal } from '../components/MoveMoneyModal'
import { useData } from '../hooks/useData'
import { useCheckIn } from '../hooks/useCheckIn'
import { toast, useUi } from '../state/ui'
import { setApproved, updateTransaction } from '../db/actions'
import { currentMonth, DAY_NAMES, fromISODate, MONTH_NAMES, today } from '../lib/dates'
import { dayLabel, UPCOMING_DAYS } from '../lib/today'
import type { Id, Transaction } from '../types'

const SHOW = 5

/**
 * A short daily check-in: the handful of things that want a decision today,
 * each with the button that settles it. Empty when there's nothing to do.
 */
export default function TodayPage() {
  const { money } = useData()
  const c = useCheckIn()
  const navigate = useNavigate()
  const setMonth = useUi((s) => s.setMonth)
  const [covering, setCovering] = useState<{ id: Id; amount: number } | null>(null)
  const todayIso = today()
  const d = fromISODate(todayIso)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const billsTotal = c.upcoming.reduce((s, b) => s + b.amount, 0)

  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>Today</h1>
          <div className="subtitle">
            {DAY_NAMES[d.getDay()]}, {MONTH_NAMES[d.getMonth()]} {d.getDate()}
          </div>
        </div>
      </header>

      <div className="content content-pad">
        <div className="content-narrow today">
          <section className={`today-hero${c.attention === 0 ? ' clear' : ''}`}>
            <div className="greet">{greeting}</div>
            <div className="status">
              {c.attention === 0 ? (
                <>
                  <Icon name="check" size={22} strokeWidth={2.6} /> You're all caught up
                </>
              ) : (
                <>
                  {c.attention} thing{c.attention === 1 ? '' : 's'} need{c.attention === 1 ? 's' : ''} you
                </>
              )}
            </div>
            <div className="stats">
              <div>
                <span className="k">Spent this week</span>
                <span className="v">{money(c.spentThisWeek)}</span>
              </div>
              <div>
                <span className="k">Due in {UPCOMING_DAYS} days</span>
                <span className="v">{money(billsTotal)}</span>
              </div>
            </div>
          </section>

          {c.readyToAssign !== 0 && (
            <section className={`card today-card rta-card${c.readyToAssign < 0 ? ' bad' : ''}`}>
              <Icon name={c.readyToAssign < 0 ? 'alert' : 'layers'} size={18} />
              <div className="txt">
                {c.readyToAssign > 0 ? (
                  <>
                    <strong>{money(c.readyToAssign)} is waiting for a job</strong>
                    <span>Give every dollar somewhere to go.</span>
                  </>
                ) : (
                  <>
                    <strong>{money(-c.readyToAssign)} assigned that you don't have</strong>
                    <span>Take it back from a category so the plan matches your accounts.</span>
                  </>
                )}
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => navigate('/')}>
                {c.readyToAssign > 0 ? 'Assign' : 'Fix'}
              </button>
            </section>
          )}

          {c.overspent.length > 0 && (
            <section className="card today-card list">
              <h3>
                <Icon name="alert" size={16} /> Overspent
              </h3>
              {c.overspent.map((o) => (
                <div className="today-row" key={o.categoryId}>
                  <span className="name truncate">{o.name}</span>
                  <span className="amt neg">−{money(o.amount)}</span>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setMonth(currentMonth())
                      setCovering({ id: o.categoryId, amount: o.amount })
                    }}
                  >
                    Cover
                  </button>
                </div>
              ))}
            </section>
          )}

          {c.upcoming.length > 0 && (
            <section className="card today-card list">
              <h3>
                <Icon name="calendar" size={16} /> Coming up
              </h3>
              {c.upcoming.map((b) => (
                <div className={`today-row${b.short > 0 ? ' short' : ''}`} key={b.key}>
                  <span className="when">{dayLabel(b.date, todayIso)}</span>
                  <span className="name truncate">
                    {b.name}
                    {b.short > 0 && <span className="note">{money(b.short)} short</span>}
                  </span>
                  <span className="amt">{money(b.amount)}</span>
                </div>
              ))}
            </section>
          )}

          {c.unapproved.length > 0 && (
            <ReviewList
              title="To approve"
              icon="check"
              items={c.unapproved}
              action={
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    const ids = c.unapproved.map((t) => t.id)
                    await setApproved(ids, true)
                    toast(`Approved ${ids.length}`, { action: { label: 'Undo', run: () => void setApproved(ids, false) } })
                  }}
                >
                  Approve all
                </button>
              }
              renderAction={(t) => (
                <button className="icon-btn approve" aria-label="Approve" onClick={() => void setApproved([t.id], true)}>
                  <Icon name="check" size={16} strokeWidth={2.6} />
                </button>
              )}
            />
          )}

          {c.uncategorized.length > 0 && (
            <ReviewList
              title="Needs a category"
              icon="info"
              items={c.uncategorized}
              renderAction={(t) => (
                <CategorySelect
                  className="mini"
                  value={null}
                  includeInflow
                  noneLabel="Choose…"
                  onChange={(id) => id && void updateTransaction(t.id, { categoryId: id })}
                />
              )}
            />
          )}

          {c.underfunded.count > 0 && (
            <section className="card today-card">
              <Icon name="target" size={18} />
              <div className="txt">
                <strong>
                  {c.underfunded.count} target{c.underfunded.count === 1 ? '' : 's'} need {money(c.underfunded.amount)}
                </strong>
                <span>Still to set aside this month.</span>
              </div>
              <button className="btn btn-sm" onClick={() => navigate('/plan')}>
                Review
              </button>
            </section>
          )}

          {c.attention === 0 && (
            <p className="today-done">Nothing else needs you today. Your budget is up to date.</p>
          )}
        </div>
      </div>

      {covering && (
        <MoveMoneyModal toCategoryId={covering.id} suggestedAmount={covering.amount} onClose={() => setCovering(null)} />
      )}
    </>
  )
}

function ReviewList({
  title,
  icon,
  items,
  action,
  renderAction,
}: {
  title: string
  icon: 'check' | 'info'
  items: Transaction[]
  action?: React.ReactNode
  renderAction: (t: Transaction) => React.ReactNode
}) {
  const { money, payeeById, accountById } = useData()
  const openTxnModal = useUi((s) => s.openTxnModal)
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, SHOW)
  return (
    <section className="card today-card list">
      <h3>
        <Icon name={icon} size={16} /> {title} <span className="n">{items.length}</span>
        <span className="spacer" />
        {action}
      </h3>
      {shown.map((t) => {
        const payee = t.payeeId ? payeeById.get(t.payeeId)?.name : undefined
        const [, m, d] = t.date.split('-').map(Number)
        return (
          <div className="today-row txn" key={t.id}>
            <button className="what" onClick={() => openTxnModal({ transactionId: t.id })}>
              <span className="name truncate">{payee || t.memo || 'No payee'}</span>
              <span className="meta truncate">
                {MONTH_NAMES[m - 1].slice(0, 3)} {d} · {accountById.get(t.accountId)?.name}
              </span>
            </button>
            <span className={`amt${t.amount > 0 ? ' pos' : ''}`}>{money(t.amount)}</span>
            {renderAction(t)}
          </div>
        )
      })}
      {items.length > SHOW && (
        <button className="linkish more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </section>
  )
}
