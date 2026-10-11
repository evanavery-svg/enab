import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { NavMenuButton } from '../components/NavMenuButton'
import { useData } from '../hooks/useData'
import { useUi } from '../state/ui'
import { monthLabel, MONTH_SHORT, today } from '../lib/dates'
import { searchTransactions, topPayees, type SearchKind, type SearchRange } from '../lib/search'
import type { Transaction } from '../types'

const RANGES: { key: SearchRange; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'month', label: 'This month' },
  { key: '3m', label: '3 months' },
  { key: 'year', label: 'This year' },
  { key: 'lastYear', label: 'Last year' },
]
const KINDS: { key: SearchKind; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'spending', label: 'Spending' },
  { key: 'income', label: 'Income' },
]
const PAGE = 150

/** Every transaction in every account, searchable — with the total that answers "how much did I spend on…". */
export default function SearchPage() {
  const { transactions, accounts, categories, payees, money, payeeById, accountById, categoryById } = useData()
  const openTxnModal = useUi((s) => s.openTxnModal)
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<SearchRange>('all')
  const [kind, setKind] = useState<SearchKind>('all')
  const [accountId, setAccountId] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const inputRef = useRef<HTMLInputElement>(null)

  // Typing stays instant; the result list catches up a beat behind.
  const deferredQuery = useDeferredValue(query)
  const active = deferredQuery.trim() !== '' || range !== 'all' || kind !== 'all' || accountId !== null

  useEffect(() => setLimit(PAGE), [deferredQuery, range, kind, accountId])
  useEffect(() => {
    // Desktop: type straight away. Phones: wait for a tap, so the keyboard
    // doesn't cover the suggestions the moment the page opens.
    if (window.matchMedia?.('(pointer: fine)').matches) inputRef.current?.focus()
  }, [])

  const result = useMemo(
    () =>
      active
        ? searchTransactions(transactions, { query: deferredQuery, range, kind, accountId, today: today() }, { accounts, categories, payees })
        : null,
    [active, transactions, deferredQuery, range, kind, accountId, accounts, categories, payees],
  )
  const suggestions = useMemo(() => topPayees(transactions, payees), [transactions, payees])

  const groups = useMemo(() => {
    const out: { month: string; rows: Transaction[]; total: number }[] = []
    for (const t of result?.matches.slice(0, limit) ?? []) {
      const m = t.date.slice(0, 7)
      let g = out[out.length - 1]
      if (!g || g.month !== m) out.push((g = { month: m, rows: [], total: 0 }))
      g.rows.push(t)
      g.total += t.amount
    }
    return out
  }, [result, limit])

  const openAccounts = accounts.filter((a) => !a.closed)

  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <h1>Search</h1>
      </header>

      <div className="content content-pad">
        <div className="content-narrow search">
          <div className="search-box">
            <Icon name="search" size={18} />
            <input
              ref={inputRef}
              className="input"
              type="search"
              placeholder="Payee, category, memo or amount"
              aria-label="Search for"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              enterKeyHint="search"
              autoComplete="off"
            />
            {query && (
              <button className="icon-btn" aria-label="Clear search" onClick={() => setQuery('')}>
                <Icon name="x" size={16} />
              </button>
            )}
          </div>

          <div className="search-filters">
            <select className="select chip" value={range} onChange={(e) => setRange(e.target.value as SearchRange)} aria-label="Date range">
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <select className="select chip" value={kind} onChange={(e) => setKind(e.target.value as SearchKind)} aria-label="Spending or income">
              {KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
            <select className="select chip" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value || null)} aria-label="Account">
              <option value="">All accounts</option>
              {openAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {!result ? (
            <div className="search-start">
              {suggestions.length > 0 && (
                <>
                  <h3>Try</h3>
                  <div className="search-suggest">
                    {suggestions.map((p) => (
                      <button key={p} className="groc-chip" onClick={() => setQuery(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className="search-tips">
                Every word has to match. Add an amount to narrow it: <code>12.99</code>, <code>&gt;100</code>, <code>&lt;$20</code>.
              </p>
            </div>
          ) : (
            <>
              <section className={`search-summary${query !== deferredQuery ? ' stale' : ''}`} aria-live="polite">
                <div className="count">
                  {result.matches.length.toLocaleString()} transaction{result.matches.length === 1 ? '' : 's'}
                </div>
                <div className="sums">
                  {result.spent > 0 && (
                    <span>
                      Spent <strong>{money(result.spent)}</strong>
                    </span>
                  )}
                  {result.received > 0 && (
                    <span>
                      Received <strong className="pos">{money(result.received)}</strong>
                    </span>
                  )}
                </div>
              </section>

              {result.matches.length === 0 ? (
                <div className="card search-none">Nothing matches. Try fewer words or a wider date range.</div>
              ) : (
                groups.map((g) => (
                  <section key={g.month} className="search-group">
                    <header>
                      <span>{monthLabel(g.month)}</span>
                      <span className={g.total > 0 ? 'pos' : ''}>{money(g.total)}</span>
                    </header>
                    <div className="card">
                      {g.rows.map((t) => {
                        const payee = t.payeeId ? payeeById.get(t.payeeId)?.name : undefined
                        const transferTo = t.transferAccountId ? accountById.get(t.transferAccountId)?.name : undefined
                        const category = t.subtransactions?.length
                          ? 'Split'
                          : t.categoryId
                            ? categoryById.get(t.categoryId)?.name
                            : transferTo
                              ? `Transfer · ${transferTo}`
                              : 'Uncategorized'
                        const [, m, d] = t.date.split('-').map(Number)
                        return (
                          <button key={t.id} className="search-row" onClick={() => openTxnModal({ transactionId: t.id })}>
                            <span className="date">
                              <span className="d">{d}</span>
                              <span className="m">{MONTH_SHORT[m - 1]}</span>
                            </span>
                            <span className="what">
                              <span className="name truncate">{payee || t.memo || 'No payee'}</span>
                              <span className="meta truncate">
                                {category} · {accountById.get(t.accountId)?.name}
                                {t.memo && payee ? ` · ${t.memo}` : ''}
                              </span>
                            </span>
                            <span className={`amt${t.amount > 0 ? ' pos' : ''}`}>{money(t.amount)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))
              )}
              {result.matches.length > limit && (
                <button className="btn btn-block" onClick={() => setLimit(limit + PAGE)}>
                  Show more ({(result.matches.length - limit).toLocaleString()} left)
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
