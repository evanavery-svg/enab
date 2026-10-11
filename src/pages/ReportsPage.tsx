import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { NavMenuButton } from '../components/NavMenuButton'
import { BarChart, Legend, LineChart, Sparkline } from '../components/charts'
import { useData } from '../hooks/useData'
import { useUi } from '../state/ui'
import { computeAgeOfMoney } from '../budget/ageOfMoney'
import { addMonths, compareIso, monthEnd, monthLabel, monthRange } from '../lib/dates'
import { formatCompact } from '../lib/money'
import type { Cents, Id, MonthKey } from '../types'

type RangeKey = '3' | '6' | '12' | 'ytd' | 'all'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '3', label: '3 months' },
  { key: '6', label: '6 months' },
  { key: '12', label: '12 months' },
  { key: 'ytd', label: 'This year' },
  { key: 'all', label: 'All time' },
]

export default function ReportsPage() {
  const data = useData()
  const { budget, categories, categoryById, groups, money, format, accounts, transactions } = data
  const month = useUi((s) => s.month)
  const openDetail = useUi((s) => s.openCategoryDetail)

  const [range, setRange] = useState<RangeKey>('6')
  const [groupBy, setGroupBy] = useState<'category' | 'group'>('category')

  const months: MonthKey[] = useMemo(() => {
    const available = budget.months.filter((m) => m <= month)
    if (available.length === 0) return [month]
    switch (range) {
      case 'all':
        return available
      case 'ytd': {
        const year = month.slice(0, 4)
        return available.filter((m) => m.startsWith(year))
      }
      default: {
        const count = Number(range)
        const start = addMonths(month, -(count - 1))
        return monthRange(start > available[0] ? start : available[0], month)
      }
    }
  }, [budget.months, range, month])

  /** Categories that represent real spending — payment categories don't. */
  const spendingCategories = useMemo(
    () => categories.filter((c) => !c.isInflow && !c.linkedAccountId),
    [categories],
  )

  const spendingByCategory = useMemo(() => {
    const totals = new Map<Id, Cents>()
    for (const m of months) {
      const states = budget.categoryStates.get(m)
      if (!states) continue
      for (const c of spendingCategories) {
        const activity = states.get(c.id)?.activity ?? 0
        if (activity >= 0) continue
        totals.set(c.id, (totals.get(c.id) ?? 0) + -activity)
      }
    }
    return [...totals.entries()]
      .map(([id, amount]) => ({ id, amount, name: categoryById.get(id)?.name ?? 'Unknown' }))
      .filter((r) => r.amount > 0)
      .sort((a, b) => b.amount - a.amount)
  }, [months, budget, spendingCategories, categoryById])

  const spendingByGroup = useMemo(() => {
    const totals = new Map<Id, Cents>()
    for (const row of spendingByCategory) {
      const groupId = categoryById.get(row.id)?.groupId
      if (!groupId) continue
      totals.set(groupId, (totals.get(groupId) ?? 0) + row.amount)
    }
    return [...totals.entries()]
      .map(([id, amount]) => ({ id, amount, name: groups.find((g) => g.id === id)?.name ?? 'Unknown' }))
      .sort((a, b) => b.amount - a.amount)
  }, [spendingByCategory, categoryById, groups])

  const breakdown = groupBy === 'category' ? spendingByCategory : spendingByGroup
  const breakdownTotal = breakdown.reduce((sum, r) => sum + r.amount, 0)

  const monthlyTotals = useMemo(
    () =>
      months.map((m) => {
        const states = budget.categoryStates.get(m)
        let spent = 0
        for (const c of spendingCategories) {
          const activity = states?.get(c.id)?.activity ?? 0
          if (activity < 0) spent += -activity
        }
        return {
          month: m,
          label: monthLabel(m, { short: true, withYear: false }),
          spent,
          income: budget.summaries.get(m)?.income ?? 0,
        }
      }),
    [months, budget, spendingCategories],
  )

  const { netWorthSeries, accountBreakdown, netWorthChange } = useMemo(() => {
    const live = new Set(accounts.map((a) => a.id))
    const byMonth = new Map<MonthKey, Cents[]>()
    const sorted = [...transactions].sort((a, b) => compareIso(a.date, b.date))
    const balancePerAccount = new Map<Id, Cents>()
    let cursor = 0
    for (const m of months) {
      const end = monthEnd(m)
      while (cursor < sorted.length && sorted[cursor].date <= end) {
        const t = sorted[cursor++]
        if (live.has(t.accountId)) {
          balancePerAccount.set(t.accountId, (balancePerAccount.get(t.accountId) ?? 0) + t.amount)
        }
      }
      let assets = 0
      let debts = 0
      for (const balance of balancePerAccount.values()) {
        if (balance >= 0) assets += balance
        else debts += balance
      }
      byMonth.set(m, [assets + debts, assets, debts])
    }
    const nwSeries = months.map((m) => ({
      label: monthLabel(m, { short: true, withYear: false }),
      values: byMonth.get(m) ?? [0, 0, 0],
    }))

    // Per-account current breakdown
    const breakdown = accounts
      .map((a) => ({
        name: a.name,
        balance: balancePerAccount.get(a.id) ?? 0,
        type: a.type,
        class: a.class,
      }))
      .filter((a) => a.balance !== 0)
      .sort((a, b) => b.balance - a.balance)

    // Net worth change over period
    const first = nwSeries.length > 1 ? nwSeries[0].values[0] : 0
    const last = nwSeries.length > 0 ? nwSeries[nwSeries.length - 1].values[0] : 0
    const change = last - first

    return { netWorthSeries: nwSeries, accountBreakdown: breakdown, netWorthChange: change }
  }, [months, transactions, accounts])

  const accountBreakdownTotal = useMemo(
    () => accountBreakdown.reduce((s, a) => s + Math.abs(a.balance), 0) || 1,
    [accountBreakdown],
  )

  const ageOfMoney = useMemo(() => computeAgeOfMoney(accounts, transactions), [accounts, transactions])

  const totalIncome = monthlyTotals.reduce((s, m) => s + m.income, 0)
  const totalSpent = monthlyTotals.reduce((s, m) => s + m.spent, 0)
  const compact = (v: number) => formatCompact(v, format)

  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <h1>Reports</h1>
        <span className="spacer" />
        <Link to="/review" className="btn btn-sm">
          <Icon name="calendar" size={15} /> <span className="hide-phone">Month in </span>review
        </Link>
        <select className="select" style={{ width: 'auto' }} value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </header>

      <div className="content content-pad">
        <div className="acct-summary">
          <div className="card stat">
            <div className="k">Spent</div>
            <div className="v">{money(totalSpent)}</div>
          </div>
          <div className="card stat">
            <div className="k">Income</div>
            <div className="v pos">{money(totalIncome)}</div>
          </div>
          <div className="card stat">
            <div className="k">Net</div>
            <div className={`v ${totalIncome - totalSpent < 0 ? 'neg' : ''}`}>{money(totalIncome - totalSpent)}</div>
          </div>
          <div className="card stat">
            <div className="k">Age of money</div>
            <div className="v">{ageOfMoney.days === null ? '—' : `${ageOfMoney.days} days`}</div>
            {ageOfMoney.history.length > 2 && (
              <Sparkline values={ageOfMoney.history.slice(-40).map((h) => h.days)} height={34} />
            )}
          </div>
        </div>

        <div className="report-grid two">
          <section className="card chart-card">
            <header style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <h3>Spending by {groupBy}</h3>
                <p>
                  {money(breakdownTotal)} across {months.length} month{months.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="segmented" style={{ width: 190, flex: 'none' }}>
                <button aria-pressed={groupBy === 'category'} onClick={() => setGroupBy('category')}>
                  Category
                </button>
                <button aria-pressed={groupBy === 'group'} onClick={() => setGroupBy('group')}>
                  Group
                </button>
              </div>
            </header>

            {breakdown.length === 0 ? (
              <p className="dim" style={{ fontSize: 14 }}>
                No spending recorded in this period.
              </p>
            ) : (
              <ul className="breakdown">
                {breakdown.map((row) => {
                  const pct = breakdownTotal === 0 ? 0 : row.amount / breakdownTotal
                  return (
                    <li key={row.id}>
                      <span className="label truncate">
                        {groupBy === 'category' ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ padding: 0, fontWeight: 500 }}
                            onClick={() => openDetail(row.id)}
                          >
                            {row.name}
                          </button>
                        ) : (
                          row.name
                        )}
                      </span>
                      <span className="bar">
                        <span className="progress">
                          <span style={{ width: `${Math.round(pct * 100)}%`, background: 'var(--c1)' }} />
                        </span>
                      </span>
                      <span className="val">{money(row.amount)}</span>
                      <span className="pct">{Math.round(pct * 100)}%</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="card chart-card">
            <header>
              <h3>Income and spending</h3>
              <p>Money in versus money out, month by month</p>
            </header>
            <BarChart
              data={monthlyTotals.map((m) => ({ label: m.label, values: [m.income, m.spent] }))}
              series={[{ name: 'Income' }, { name: 'Spending' }]}
              format={compact}
            />
            <Legend
              series={[{ name: 'Income' }, { name: 'Spending' }]}
              values={[money(totalIncome), money(totalSpent)]}
            />
          </section>

          <section className="card chart-card">
            <header>
              <h3>Spending over time</h3>
              <p>Total outflow each month</p>
            </header>
            <BarChart
              data={monthlyTotals.map((m) => ({ label: m.label, values: [m.spent] }))}
              series={[{ name: 'Spending', color: 'var(--c1)' }]}
              format={compact}
            />
          </section>

          <section className="card chart-card">
            <header>
              <h3>Net worth</h3>
              <p>
                Everything you own, minus everything you owe
                {netWorthChange !== 0 && (
                  <span style={{ marginLeft: 8, fontWeight: 650, color: netWorthChange > 0 ? 'var(--positive)' : 'var(--danger)' }}>
                    {netWorthChange > 0 ? '+' : ''}{money(netWorthChange)} this period
                  </span>
                )}
              </p>
            </header>
            <LineChart
              data={netWorthSeries}
              series={[{ name: 'Net worth' }, { name: 'Assets' }, { name: 'Debts' }]}
              format={compact}
              area
            />
            <Legend
              series={[{ name: 'Net worth' }, { name: 'Assets' }, { name: 'Debts' }]}
              values={netWorthSeries.length ? netWorthSeries[netWorthSeries.length - 1].values.map((v) => money(v)) : undefined}
            />
            {accountBreakdown.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h4 style={{ fontSize: 13, fontWeight: 650, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.03em' }}>By account</h4>
                <ul className="breakdown" style={{ fontSize: 13.5 }}>
                  {accountBreakdown.map((a) => {
                    const pct = Math.abs(a.balance) / accountBreakdownTotal
                    return (
                      <li key={a.name}>
                        <span className="label truncate">{a.name}</span>
                        <span className="bar">
                          <span className="progress">
                            <span style={{ width: `${Math.round(pct * 100)}%`, background: a.balance >= 0 ? 'var(--c1)' : 'var(--c3)' }} />
                          </span>
                        </span>
                        <span className={`val ${a.balance < 0 ? 'neg' : ''}`}>{money(a.balance)}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </section>
        </div>

        {ageOfMoney.days !== null && (
          <div className="card card-pad" style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Icon name="clock" size={18} />
            <div style={{ fontSize: 14 }}>
              <strong>Age of money: {ageOfMoney.days} days.</strong>{' '}
              <span className="dim">
                That's how long the dollars you most recently spent sat in your accounts first. Higher means
                you're spending money you earned longer ago — the goal is to get past 30 days, so this month's
                spending comes from last month's income.
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
