import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { NavMenuButton } from '../components/NavMenuButton'
import { useWidth } from '../components/charts'
import { useData } from '../hooks/useData'
import { toast } from '../state/ui'
import { createScheduled } from '../db/actions'
import { addDays, addMonths, currentMonth, DAY_NAMES, fromISODate, monthEnd, monthLabel, MONTH_NAMES, today } from '../lib/dates'
import { buildForecast, guessIncome, type ForecastDay } from '../lib/forecast'
import { FREQUENCY_LABELS } from '../budget/recurrence'
import { cleanPayeeName } from '../lib/rules'
import type { Cents, Id } from '../types'

/** How far ahead the low point is looked for. */
const HORIZON_DAYS = 60
/** A balance this low is worth a heads-up even if it stays positive. */
const CUSHION: Cents = 20_000

/**
 * Cash flow, day by day: what each account really did, and where its balance
 * is headed through everything scheduled — so a dip before payday shows up
 * while there's still time to move money.
 */
export default function CalendarPage() {
  const { accounts, transactions, scheduled, subscriptions, payees, money } = useData()
  const todayIso = today()
  const spending = useMemo(() => {
    const open = accounts.filter((a) => !a.closed && a.onBudget)
    const cash = open.filter((a) => a.type === 'checking' || a.type === 'cash')
    return (cash.length ? cash : open.filter((a) => a.class === 'budget')).map((a) => a.id)
  }, [accounts])
  const [choice, setChoice] = useState<'spending' | Id>('spending')
  const accountIds = choice === 'spending' ? spending : [choice]
  const [month, setMonth] = useState(currentMonth())
  const [selected, setSelected] = useState(todayIso)

  const first = `${addMonths(currentMonth(), -2)}-01`
  const horizon = addDays(todayIso, HORIZON_DAYS)
  const last = [monthEnd(addMonths(currentMonth(), 2)), horizon].sort().pop()!
  const forecast = useMemo(
    () => buildForecast({ today: todayIso, from: first, to: last, accountIds, accounts, transactions, scheduled, subscriptions, payees }),
    // accountIds is derived from choice/spending
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayIso, first, last, choice, spending, accounts, transactions, scheduled, subscriptions, payees],
  )
  const income = useMemo(
    () => (forecast.nextIncome ? null : guessIncome({ today: todayIso, accountIds, transactions, scheduled, payees })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [forecast.nextIncome, todayIso, choice, spending, transactions, scheduled, payees],
  )

  const byDate = useMemo(() => new Map(forecast.days.map((d) => [d.date, d])), [forecast])
  const ahead = forecast.days.filter((d) => d.date >= todayIso && d.date <= horizon)
  const low = ahead.reduce((m, d) => (d.balance < m.balance ? d : m), ahead[0] ?? forecast.days[forecast.days.length - 1])
  const monthDays = forecast.days.filter((d) => d.date.startsWith(month))
  const sel = byDate.get(selected)
  const accountLabel = choice === 'spending' ? (spending.length === 1 ? accounts.find((a) => a.id === spending[0])?.name : 'Checking & cash') : accounts.find((a) => a.id === choice)?.name
  const canBack = month > addMonths(currentMonth(), -2)
  const canForward = month < addMonths(currentMonth(), 2)

  async function addPaycheck() {
    if (!income) return
    await createScheduled({
      accountId: income.accountId,
      nextDate: income.nextDate,
      frequency: income.frequency,
      amount: income.amount,
      payeeId: income.payeeId,
      categoryId: income.categoryId,
      memo: '',
      flag: null,
      autoEnter: false,
      paused: false,
    })
    toast(`${cleanPayeeName(income.name)} added to your schedule`)
  }

  const tone = !low ? 'ok' : low.balance < 0 ? 'bad' : low.balance < CUSHION ? 'warn' : 'ok'

  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <h1>Cash flow</h1>
        <span className="spacer" />
        <select className="select cal-account" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Account">
          <option value="spending">Checking & cash</option>
          {accounts
            .filter((a) => !a.closed && a.onBudget)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </header>

      <div className="content content-pad">
        <div className="content-narrow cal">
          {accountIds.length === 0 ? (
            <div className="card empty">
              <h3>No accounts yet</h3>
              <p>Add a checking account to see where its balance is headed.</p>
            </div>
          ) : (
            <>
              {low && (
                <section className={`cal-status ${tone}`}>
                  <Icon name={tone === 'ok' ? 'check' : 'alert'} size={18} />
                  <div>
                    <strong>
                      {tone === 'bad'
                        ? `${accountLabel} goes ${money(-low.balance)} negative ${whenText(low.date, todayIso)}`
                        : tone === 'warn'
                          ? `${accountLabel} dips to ${money(low.balance)} ${whenText(low.date, todayIso)}`
                          : `${accountLabel} stays above ${money(low.balance)}`}
                    </strong>
                    <span>
                      {tone === 'ok'
                        ? `Lowest point in the next ${HORIZON_DAYS} days, counting everything scheduled.`
                        : forecast.nextIncome && forecast.nextIncome.date > low.date
                          ? `That's before ${money(forecast.nextIncome.amount)} arrives ${whenText(forecast.nextIncome.date, todayIso)}.`
                          : 'Move money in or push a bill back before then.'}
                    </span>
                  </div>
                </section>
              )}

              {income && (
                <section className="card cal-income">
                  <div>
                    <strong>Is {cleanPayeeName(income.name)} your paycheck?</strong>
                    <span>
                      About {money(income.amount)}, {FREQUENCY_LABELS[income.frequency].toLowerCase()}. Schedule it so the forecast counts on it — next one{' '}
                      {whenText(income.nextDate, todayIso)}.
                    </span>
                  </div>
                  <button className="btn btn-sm btn-primary" onClick={addPaycheck}>
                    Add it
                  </button>
                </section>
              )}

              <div className="cal-nav">
                <button className="icon-btn" disabled={!canBack} onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
                  <Icon name="chevronLeft" />
                </button>
                <h2>{monthLabel(month)}</h2>
                <button className="icon-btn" disabled={!canForward} onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
                  <Icon name="chevronRight" />
                </button>
              </div>

              <BalanceChart days={monthDays} low={low?.date} selected={selected} onSelect={setSelected} />

              <MonthGrid month={month} byDate={byDate} today={todayIso} low={tone !== 'ok' ? low?.date : undefined} selected={selected} onSelect={setSelected} />

              {sel && <DayDetail day={sel} today={todayIso} />}
            </>
          )}
        </div>
      </div>
    </>
  )
}

function whenText(date: string, todayIso: string): string {
  if (date === todayIso) return 'today'
  if (date === addDays(todayIso, 1)) return 'tomorrow'
  const d = fromISODate(date)
  return `on ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

/** "1.2k", "86", "−340": enough to scan a calendar cell. */
function compact(cents: Cents): string {
  const v = Math.abs(cents) / 100
  const s = v >= 10_000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(v)}`
  return `${cents < 0 ? '−' : '+'}${s}`
}

function netOf(day: ForecastDay): Cents {
  return day.events.reduce((s, e) => s + (e.counted ? e.amount : 0), 0)
}

function BalanceChart({
  days,
  low,
  selected,
  onSelect,
}: {
  days: ForecastDay[]
  low?: string
  selected: string
  onSelect: (d: string) => void
}) {
  const { money } = useData()
  const [ref, width] = useWidth()
  const height = 132
  const pad = { top: 22, right: 10, bottom: 18, left: 10 }
  if (days.length === 0) return null
  const values = days.map((d) => d.balance)
  const min = Math.min(0, ...values)
  const max = Math.max(...values, 1)
  const plotW = Math.max(1, width - pad.left - pad.right)
  const plotH = height - pad.top - pad.bottom
  const x = (i: number) => pad.left + (days.length === 1 ? plotW / 2 : (i / (days.length - 1)) * plotW)
  const y = (v: number) => pad.top + plotH - ((v - min) / (max - min || 1)) * plotH
  const split = days.findIndex((d) => d.projected)
  const path = (from: number, to: number) =>
    days
      .slice(from, to)
      .map((d, k) => `${k === 0 ? 'M' : 'L'}${x(from + k).toFixed(1)},${y(d.balance).toFixed(1)}`)
      .join('')
  const pastEnd = split === -1 ? days.length : split
  const lowIdx = low ? days.findIndex((d) => d.date === low) : -1
  const selIdx = days.findIndex((d) => d.date === selected)
  const pick = (clientX: number, rect: DOMRect) => {
    const i = Math.round(((clientX - rect.left - pad.left) / plotW) * (days.length - 1))
    const d = days[Math.max(0, Math.min(days.length - 1, i))]
    if (d) onSelect(d.date)
  }

  return (
    <div className="card cal-chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Balance through the month"
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerMove={(e) => (e.buttons || e.pointerType === 'mouse') && pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        >
          {min < 0 && <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} className="zero" />}
          <path d={`${path(0, days.length)}L${x(days.length - 1)},${y(min)}L${x(0)},${y(min)}Z`} className="area" />
          {pastEnd > 0 && <path d={path(0, pastEnd)} className="line" />}
          {split !== -1 && <path d={path(Math.max(0, split - 1), days.length)} className="line projected" />}
          {selIdx >= 0 && (
            <>
              <line x1={x(selIdx)} x2={x(selIdx)} y1={pad.top - 4} y2={height - pad.bottom} className="cross" />
              <circle cx={x(selIdx)} cy={y(days[selIdx].balance)} r={4} className="dot" />
              <text x={Math.min(Math.max(x(selIdx), 44), width - 44)} y={12} textAnchor="middle" className="val">
                {money(days[selIdx].balance)}
              </text>
            </>
          )}
          {lowIdx >= 0 && lowIdx !== selIdx && <circle cx={x(lowIdx)} cy={y(days[lowIdx].balance)} r={4.5} className="low" />}
          <text x={pad.left} y={height - 4} className="axis">
            {Number(days[0].date.slice(8))}
          </text>
          <text x={width - pad.right} y={height - 4} textAnchor="end" className="axis">
            {Number(days[days.length - 1].date.slice(8))}
          </text>
          {split > 0 && (
            <text x={x(split)} y={height - 4} textAnchor="middle" className="axis today">
              today
            </text>
          )}
        </svg>
      )}
    </div>
  )
}

function MonthGrid({
  month,
  byDate,
  today: todayIso,
  low,
  selected,
  onSelect,
}: {
  month: string
  byDate: Map<string, ForecastDay>
  today: string
  low?: string
  selected: string
  onSelect: (d: string) => void
}) {
  const lead = fromISODate(`${month}-01`).getDay()
  const count = Number(monthEnd(month).slice(8))
  return (
    <div className="cal-grid" role="grid" aria-label={monthLabel(month)}>
      {DAY_NAMES.map((d) => (
        <div key={d} className="dow" role="columnheader">
          {d[0]}
        </div>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <div key={`b${i}`} />
      ))}
      {Array.from({ length: count }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, '0')}`
        const day = byDate.get(date)
        const net = day ? netOf(day) : 0
        const markers = day?.events.filter((e) => !e.counted).length ?? 0
        const cls = [
          'cal-day',
          date === todayIso && 'today',
          date < todayIso && 'past',
          date === selected && 'selected',
          date === low && 'low',
          day && day.balance < 0 && 'neg',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <button key={date} className={cls} onClick={() => onSelect(date)} aria-label={`${MONTH_NAMES[Number(month.slice(5)) - 1]} ${i + 1}`}>
            <span className="n">{i + 1}</span>
            {net !== 0 && <span className={`amt${net > 0 ? ' in' : ''}`}>{compact(net)}</span>}
            {markers > 0 && <span className="mark" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

function DayDetail({ day, today: todayIso }: { day: ForecastDay; today: string }) {
  const { money } = useData()
  const d = fromISODate(day.date)
  const label = day.date === todayIso ? 'Today' : `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`
  return (
    <section className="card cal-detail">
      <header>
        <h3>{label}</h3>
        <span className={`bal${day.balance < 0 ? ' neg' : ''}`}>
          {money(day.balance)}
          <small>{day.projected ? 'projected' : 'end of day'}</small>
        </span>
      </header>
      {day.events.length === 0 ? (
        <p className="none">{day.projected ? 'Nothing scheduled.' : 'No transactions.'}</p>
      ) : (
        day.events.map((e) => (
          <div key={e.key} className={`cal-event${e.counted ? '' : ' muted'}`}>
            <span className="name truncate">{e.name}</span>
            <span className="kind">{e.kind === 'actual' ? '' : e.kind === 'scheduled' ? 'scheduled' : 'subscription · not counted'}</span>
            <span className={`amt${e.amount > 0 ? ' pos' : ''}`}>{money(e.amount)}</span>
          </div>
        ))
      )}
    </section>
  )
}
