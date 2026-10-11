import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { NavMenuButton } from '../components/NavMenuButton'
import { useData } from '../hooks/useData'
import { toast, useUi } from '../state/ui'
import { setCategoryGoal } from '../db/actions'
import { addMonths, currentMonth, monthLabel } from '../lib/dates'
import { buildReview, raisedGoal } from '../lib/review'

/**
 * A look back at one month, the YNAB way: not to grade it, but to make next
 * month's plan more honest — targets that match what things really cost.
 */
export default function ReviewPage() {
  const { month: param } = useParams()
  const navigate = useNavigate()
  const { budget, categories, groups, categoryById, money } = useData()
  const setUiMonth = useUi((s) => s.setMonth)
  const thisMonth = currentMonth()
  const month = param && /^\d{4}-\d{2}$/.test(param) && param <= thisMonth ? param : addMonths(thisMonth, -1)
  const earliest = budget.months[0] ?? month
  const r = useMemo(() => buildReview({ month, budget, categories, groups }), [month, budget, categories, groups])
  const name = monthLabel(month, { withYear: false })
  const inProgress = month === thisMonth
  const net = r.income - r.spent
  const vsPlan = r.planned - r.spent
  const top = [...r.categories].filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 6)
  const scale = Math.max(1, ...top.map((c) => Math.max(c.spent, c.assigned)))

  async function raise(id: string, amount: number) {
    const cat = categoryById.get(id)
    if (!cat) return
    const before = cat.goal
    await setCategoryGoal(id, raisedGoal(cat.goal, amount, thisMonth))
    toast(`${cat.name} target is now ${money(amount)} a month`, { action: { label: 'Undo', run: () => void setCategoryGoal(id, before) } })
  }

  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <h1>Month in review</h1>
      </header>

      <div className="content content-pad">
        <div className="content-narrow review">
          <div className="cal-nav">
            <button className="icon-btn" disabled={month <= earliest} onClick={() => navigate(`/review/${addMonths(month, -1)}`)} aria-label="Previous month">
              <Icon name="chevronLeft" />
            </button>
            <h2>
              {monthLabel(month)}
              {inProgress && <span className="so-far">so far</span>}
            </h2>
            <button className="icon-btn" disabled={month >= thisMonth} onClick={() => navigate(`/review/${addMonths(month, 1)}`)} aria-label="Next month">
              <Icon name="chevronRight" />
            </button>
          </div>

          <section className="review-hero">
            <div className="stats">
              <div>
                <span className="k">Came in</span>
                <span className="v">{money(r.income)}</span>
              </div>
              <div>
                <span className="k">Went out</span>
                <span className="v">{money(r.spent)}</span>
              </div>
              <div>
                <span className="k">{net >= 0 ? 'Kept' : 'Short'}</span>
                <span className={`v ${net >= 0 ? 'pos' : 'neg'}`}>{money(Math.abs(net))}</span>
              </div>
            </div>
            <p className="line">
              You planned {money(r.planned)} and spent {money(r.spent)}
              {r.planned > 0 && (vsPlan >= 0 ? <> — {money(vsPlan)} under plan.</> : <> — {money(-vsPlan)} over plan.</>)}
            </p>
          </section>

          {top.length > 0 && (
            <section className="card review-card">
              <h3>Where it went</h3>
              {top.map((c) => {
                const over = c.spent > c.assigned
                return (
                  <div className="where" key={c.id}>
                    <div className="top">
                      <span className="name truncate">{c.name}</span>
                      <span className={`amt${over ? ' warn' : ''}`}>
                        {money(c.spent)}
                        <small> of {money(c.assigned)}</small>
                      </span>
                    </div>
                    <div className="track" aria-hidden="true">
                      <span className="fill" style={{ width: `${(Math.min(c.spent, c.assigned) / scale) * 100}%` }} />
                      {over && (
                        <span className="over" style={{ left: `${(c.assigned / scale) * 100}%`, width: `${((c.spent - c.assigned) / scale) * 100}%` }} />
                      )}
                      {c.assigned > 0 && <span className="plan" style={{ left: `${(c.assigned / scale) * 100}%` }} />}
                    </div>
                  </div>
                )
              })}
              <p className="legend">
                <span className="sw fill" /> spent within plan <span className="sw over" /> over plan <span className="sw plan" /> assigned
              </p>
            </section>
          )}

          {r.overPlan.length > 0 && (
            <section className="card review-card">
              <h3>Went over plan</h3>
              {r.overPlan.slice(0, 6).map((c) => {
                const s = r.suggestions.find((x) => x.category.id === c.id)
                return (
                  <div className="review-row" key={c.id}>
                    <div className="what">
                      <span className="name truncate">{c.name}</span>
                      <span className="meta">
                        {money(c.spent - c.assigned)} over
                        {c.overStreak > 1 && <span className="streak">{c.overStreak} months running</span>}
                      </span>
                    </div>
                    {s && (
                      <button className="btn btn-sm" onClick={() => void raise(c.id, s.amount)}>
                        Target {money(s.amount)}
                      </button>
                    )}
                  </div>
                )
              })}
              {r.suggestions.length > 0 && (
                <p className="note">A target that matches what something really costs makes next month's plan one you can keep.</p>
              )}
            </section>
          )}

          {r.changes.length > 0 && (
            <section className="card review-card">
              <h3>Since {monthLabel(addMonths(month, -1), { withYear: false })}</h3>
              {r.changes.map(({ category: c, before, delta }) => (
                <div className="review-row" key={c.id}>
                  <div className="what">
                    <span className="name truncate">{c.name}</span>
                    <span className="meta">
                      {money(before)} → {money(c.spent)}
                    </span>
                  </div>
                  <span className={`delta ${delta > 0 ? 'up' : 'down'}`}>
                    {delta > 0 ? '▲' : '▼'} {money(Math.abs(delta))}
                  </span>
                </div>
              ))}
            </section>
          )}

          {r.carried > 0 && !inProgress && (
            <section className="card review-card">
              <h3>Rolled into {monthLabel(addMonths(month, 1), { withYear: false })}</h3>
              <p className="carried">
                <strong>{money(r.carried)}</strong> stayed in your categories, ready for what's next.
              </p>
              <div className="chips">
                {r.carriedTop.map((c) => (
                  <span key={c.id} className="cat">
                    {c.name} {money(c.available)}
                  </span>
                ))}
              </div>
            </section>
          )}

          {r.spent === 0 && r.income === 0 && (
            <div className="card empty">
              <h3>Nothing recorded in {name}</h3>
              <p>Once transactions are in, this is where the month adds up.</p>
            </div>
          )}

          {!inProgress && (
            <button
              className="btn btn-primary btn-block"
              onClick={() => {
                setUiMonth(thisMonth)
                navigate('/')
              }}
            >
              Plan {monthLabel(thisMonth, { withYear: false })}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
