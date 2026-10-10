import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { NavMenuButton } from '../components/NavMenuButton'
import { MenuButton } from '../components/Menu'
import { ConfirmDialog } from '../components/Modal'
import { AccountFormModal } from '../components/AccountForm'
import { ReconcileModal } from '../components/ReconcileModal'
import { CsvImportModal } from '../components/CsvImportModal'
import { CategorySelect } from '../components/CategorySelect'
import { useData } from '../hooks/useData'
import { toast, useUi } from '../state/ui'
import {
  categorizeTransactions,
  deleteAccount,
  deleteTransactions,
  enterScheduled,
  setAccountClosed,
  setClearedStatus,
  skipScheduled,
} from '../db/actions'
import { formatDate, friendlyDate, today } from '../lib/dates'
import type { Cents, Id, Transaction } from '../types'

type FilterKey = 'all' | 'uncategorized' | 'uncleared' | 'unapproved' | 'flagged' | 'inflow' | 'outflow'

/** Labels that hide the actual date, so the date is shown alongside them. */
const RELATIVE_LABELS = new Set(['Today', 'Yesterday', 'Tomorrow'])

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'uncategorized', label: 'Needs a category' },
  { key: 'uncleared', label: 'Uncleared' },
  { key: 'unapproved', label: 'Unapproved' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'inflow', label: 'Inflows' },
  { key: 'outflow', label: 'Outflows' },
]

/** Rows rendered per page of register history. */
const REGISTER_PAGE = 200

export default function RegisterPage() {
  const { accountId } = useParams<{ accountId: string }>()
  const navigate = useNavigate()
  const data = useData()
  const { accountById, balances, money, transactions, payeeById, categoryById, settings, scheduled } = data
  const openTxn = useUi((s) => s.openTxnModal)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selected, setSelected] = useState<Set<Id>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [importingCsv, setImportingCsv] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
  const [confirmDeleteTxns, setConfirmDeleteTxns] = useState(false)

  const account = accountId ? accountById.get(accountId) : undefined

  /** Chronological order first so running balances accumulate correctly. */
  const rows = useMemo(() => {
    if (!accountId) return []
    const mine = transactions
      .filter((t) => t.accountId === accountId)
      .sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)))

    let running = 0
    const withBalance = mine.map((t) => {
      running += t.amount
      return { txn: t, running }
    })
    return withBalance.reverse()
  }, [transactions, accountId])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(({ txn }) => {
      switch (filter) {
        case 'uncategorized':
          if (txn.categoryId || txn.subtransactions?.length || txn.transferTransactionId) return false
          break
        case 'uncleared':
          if (txn.cleared !== 'uncleared') return false
          break
        case 'unapproved':
          if (txn.approved) return false
          break
        case 'flagged':
          if (!txn.flag) return false
          break
        case 'inflow':
          if (txn.amount <= 0) return false
          break
        case 'outflow':
          if (txn.amount >= 0) return false
          break
      }
      if (!q) return true
      const payee = txn.payeeId ? (payeeById.get(txn.payeeId)?.name ?? '') : ''
      const category = txn.categoryId ? (categoryById.get(txn.categoryId)?.name ?? '') : ''
      return (
        payee.toLowerCase().includes(q) ||
        category.toLowerCase().includes(q) ||
        txn.memo.toLowerCase().includes(q) ||
        money(txn.amount).toLowerCase().includes(q)
      )
    })
  }, [rows, filter, query, payeeById, categoryById, money])

  const upcoming = useMemo(
    () =>
      scheduled
        .filter((s) => s.accountId === accountId && !s.paused)
        .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
        .slice(0, 4),
    [scheduled, accountId],
  )

  // A busy account holds thousands of rows. Building them all made opening the
  // register, and every keystroke in search, rebuild the whole history. Render
  // the newest page and grow as the end scrolls into view; search and filters
  // still run over everything.
  const [limit, setLimit] = useState(REGISTER_PAGE)
  useEffect(() => setLimit(REGISTER_PAGE), [accountId, filter, query])
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + REGISTER_PAGE)
      },
      { rootMargin: '800px 0px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [sentinel])

  if (!account) {
    return (
      <>
        <header className="topbar">
          <NavMenuButton />
          <h1>Account</h1>
        </header>
        <div className="content">
          <div className="empty">
            <h3>Account not found</h3>
            <p>It may have been deleted.</p>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate('/accounts')}>
              Back to accounts
            </button>
          </div>
        </div>
      </>
    )
  }

  const balance = balances.get(account.id)

  function toggleSelected(id: Id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function bulkCleared(status: 'cleared' | 'uncleared') {
    await setClearedStatus([...selected], status)
    toast(`${selected.size} marked ${status}`)
    setSelected(new Set())
  }

  async function bulkCategorize(categoryId: Id | null) {
    await categorizeTransactions([...selected], categoryId)
    toast(`${selected.size} recategorised`)
    setSelected(new Set())
  }

  async function bulkDelete() {
    const count = selected.size
    await deleteTransactions([...selected])
    toast(`${count} transaction${count === 1 ? '' : 's'} deleted`)
    setSelected(new Set())
    setConfirmDeleteTxns(false)
  }

  // Group the visible rows by date so the register reads like a statement.
  const groups: { date: string; items: { txn: Transaction; running: Cents }[] }[] = []
  for (const row of visible.slice(0, limit)) {
    const last = groups[groups.length - 1]
    if (last && last.date === row.txn.date) last.items.push(row)
    else groups.push({ date: row.txn.date, items: [row] })
  }

  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <button className="icon-btn" onClick={() => navigate('/accounts')} aria-label="Back">
          <Icon name="chevronLeft" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="truncate">{account.name}</h1>
          <div className="subtitle">
            {money(balance?.working ?? 0)}
            {account.closed && ' · closed'}
          </div>
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => openTxn({ accountId: account.id })}>
          <Icon name="plus" size={15} />
          <span className="add-label">Add</span>
        </button>
        <MenuButton label={<Icon name="more" size={18} />} className="icon-btn" align="end" title="Account options">
          {(close) => (
            <>
              <button
                onClick={() => {
                  setReconciling(true)
                  close()
                }}
              >
                <Icon name="check" size={16} /> Reconcile account
              </button>
              <button
                onClick={() => {
                  setImportingCsv(true)
                  close()
                }}
              >
                <Icon name="upload" size={16} /> Import from bank CSV
              </button>
              <button
                onClick={() => {
                  setEditing(true)
                  close()
                }}
              >
                <Icon name="edit" size={16} /> Edit account
              </button>
              <button
                onClick={() => {
                  setSelectMode((v) => !v)
                  setSelected(new Set())
                  close()
                }}
              >
                <Icon name="check" size={16} /> {selectMode ? 'Exit select mode' : 'Select transactions'}
              </button>
              <div className="menu-sep" />
              <button
                onClick={async () => {
                  await setAccountClosed(account.id, !account.closed)
                  toast(account.closed ? 'Account reopened' : 'Account closed')
                  close()
                }}
              >
                <Icon name="archive" size={16} /> {account.closed ? 'Reopen' : 'Close'} account
              </button>
              <button
                className="danger"
                onClick={() => {
                  setConfirmDeleteAccount(true)
                  close()
                }}
              >
                <Icon name="trash" size={16} /> Delete account
              </button>
            </>
          )}
        </MenuButton>
      </header>

      <div className="balances-strip">
        <div className="b">
          <div className="k">Cleared</div>
          <div className="v">{money(balance?.cleared ?? 0)}</div>
        </div>
        <div className="sep" />
        <div className="b">
          <div className="k">Uncleared</div>
          <div className="v">{money(balance?.uncleared ?? 0)}</div>
        </div>
        <div className="sep" />
        <div className="b">
          <div className="k">Working</div>
          <div className={`v ${(balance?.working ?? 0) < 0 ? 'neg' : ''}`}>{money(balance?.working ?? 0)}</div>
        </div>
      </div>

      <div className="register-toolbar">
        <div className="search" style={{ position: 'relative' }}>
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="Search this account"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-faint)' }}>
            <Icon name="search" size={16} />
          </span>
        </div>
        <MenuButton
          label={
            <>
              <Icon name="filter" size={15} /> {FILTERS.find((f) => f.key === filter)?.label}
            </>
          }
        >
          {(close) => (
            <>
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => {
                    setFilter(f.key)
                    close()
                  }}
                >
                  {f.label}
                  {filter === f.key && <span className="amount">✓</span>}
                </button>
              ))}
            </>
          )}
        </MenuButton>
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 12.5 }}>
          {visible.length} of {rows.length}
        </span>
      </div>

      <div className="content">
        {upcoming.length > 0 && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <div className="faint" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>
              Upcoming
            </div>
            {upcoming.map((s) => {
              const payee = s.payeeId ? (payeeById.get(s.payeeId)?.name ?? 'Scheduled') : 'Scheduled'
              return (
                <div key={s.id} className="mini-txn">
                  <span className="upcoming-badge">
                    <Icon name="repeat" size={12} />
                    {friendlyDate(s.nextDate, settings.dateFormat)}
                  </span>
                  <div className="who truncate">{payee}</div>
                  <div className={`amt ${s.amount > 0 ? 'pos' : ''}`}>{money(s.amount)}</div>
                  <button className="btn btn-sm" onClick={() => enterScheduled(s.id)} disabled={s.nextDate > today()}>
                    Enter
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => skipScheduled(s.id)}>
                    Skip
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {visible.length === 0 ? (
          <div className="empty">
            <h3>{rows.length === 0 ? 'No transactions yet' : 'Nothing matches'}</h3>
            <p>
              {rows.length === 0
                ? 'Add your first transaction to start tracking this account.'
                : 'Try a different search or filter.'}
            </p>
            {rows.length === 0 && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                <button className="btn btn-primary" onClick={() => openTxn({ accountId: account.id })}>
                  <Icon name="plus" size={16} /> Add transaction
                </button>
                <button className="btn" onClick={() => setImportingCsv(true)}>
                  <Icon name="upload" size={16} /> Import from bank CSV
                </button>
              </div>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.date}>
              <div className="txn-group-date">
                {friendlyDate(group.date, settings.dateFormat)}
                {RELATIVE_LABELS.has(friendlyDate(group.date, settings.dateFormat)) && (
                  <span className="faint" style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                    {' · '}
                    {formatDate(group.date, settings.dateFormat)}
                  </span>
                )}
              </div>
              {group.items.map(({ txn, running }) => (
                <TransactionRow
                  key={txn.id}
                  txn={txn}
                  running={running}
                  selectMode={selectMode}
                  selected={selected.has(txn.id)}
                  onToggleSelect={() => toggleSelected(txn.id)}
                  onOpen={() => openTxn({ transactionId: txn.id })}
                />
              ))}
            </div>
          ))
        )}
        {visible.length > limit && (
          <div ref={setSentinel} style={{ padding: '14px 16px 24px', textAlign: 'center' }}>
            <button className="btn btn-sm" onClick={() => setLimit((n) => n + REGISTER_PAGE)}>
              Show older ({visible.length - limit} more)
            </button>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span className="count">{selected.size} selected</span>
          <button className="btn btn-sm" onClick={() => bulkCleared('cleared')}>
            Clear
          </button>
          <button className="btn btn-sm" onClick={() => bulkCleared('uncleared')}>
            Unclear
          </button>
          <MenuButton label="Categorize" className="btn btn-sm">
            {(close) => (
              <div style={{ padding: 6, width: 240 }}>
                <CategorySelect
                  value={null}
                  noneLabel="Choose a category…"
                  onChange={(id) => {
                    if (id) bulkCategorize(id)
                    close()
                  }}
                />
              </div>
            )}
          </MenuButton>
          <button className="btn btn-sm btn-danger" onClick={() => setConfirmDeleteTxns(true)}>
            Delete
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
            Cancel
          </button>
        </div>
      )}

      {reconciling && <ReconcileModal account={account} onClose={() => setReconciling(false)} />}
      {importingCsv && <CsvImportModal accountId={account.id} onClose={() => setImportingCsv(false)} />}
      {editing && <AccountFormModal account={account} onClose={() => setEditing(false)} />}
      {confirmDeleteAccount && (
        <ConfirmDialog
          title={`Delete ${account.name}?`}
          message="Every transaction in this account will be deleted too. This cannot be undone."
          onConfirm={async () => {
            await deleteAccount(account.id)
            toast('Account deleted')
            navigate('/accounts')
          }}
          onCancel={() => setConfirmDeleteAccount(false)}
        />
      )}
      {confirmDeleteTxns && (
        <ConfirmDialog
          title={`Delete ${selected.size} transaction${selected.size === 1 ? '' : 's'}?`}
          message="Any transfers will have both sides removed. This cannot be undone."
          onConfirm={bulkDelete}
          onCancel={() => setConfirmDeleteTxns(false)}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function TransactionRow({
  txn,
  running,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
}: {
  txn: Transaction
  running: Cents
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
}) {
  const { payeeById, categoryById, accountById, money, settings } = useData()

  const payee = txn.payeeId ? (payeeById.get(txn.payeeId)?.name ?? '') : ''
  const isTransfer = !!txn.transferAccountId
  const transferTo = txn.transferAccountId ? accountById.get(txn.transferAccountId)?.name : undefined

  const categoryLabel = txn.subtransactions?.length
    ? `Split (${txn.subtransactions.length})`
    : txn.categoryId
      ? (categoryById.get(txn.categoryId)?.name ?? 'Unknown')
      : isTransfer
        ? 'Transfer'
        : ''

  return (
    <div
      className={`txn-row${selected ? ' selected' : ''}${txn.cleared === 'uncleared' ? ' pending' : ''}`}
      onClick={(e) => {
        if (selectMode) {
          e.preventDefault()
          onToggleSelect()
        } else {
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          selectMode ? onToggleSelect() : onOpen()
        }
      }}
    >
      {selectMode && (
        <input
          className="txn-check"
          type="checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={onToggleSelect}
          aria-label="Select transaction"
        />
      )}

      {txn.flag && <span className={`flag-dot flag-${txn.flag}`} />}

      <div className="txn-main">
        <div className="payee truncate">
          {isTransfer ? `Transfer : ${transferTo ?? '—'}` : payee || 'No payee'}
        </div>
        <div className="meta">
          {categoryLabel ? (
            <span className="truncate">{categoryLabel}</span>
          ) : (
            <span className="cat-missing">Needs a category</span>
          )}
          {txn.memo && <span className="memo truncate">· {txn.memo}</span>}
          {!txn.approved && <span className="pill pill-warning">Unapproved</span>}
        </div>
      </div>

      <div className="txn-right">
        <div className={`amt ${txn.amount > 0 ? 'pos' : ''}`}>{money(txn.amount)}</div>
        {settings.showRunningBalance && <div className="running">{money(running)}</div>}
      </div>

      <button
        className={`cleared-mark ${txn.cleared}`}
        title={txn.cleared}
        aria-label={`Mark ${txn.cleared === 'cleared' ? 'uncleared' : 'cleared'}`}
        onClick={(e) => {
          e.stopPropagation()
          if (txn.cleared === 'reconciled') {
            toast('Reconciled transactions stay locked', { tone: 'danger' })
            return
          }
          setClearedStatus([txn.id], txn.cleared === 'cleared' ? 'uncleared' : 'cleared')
        }}
      >
        {txn.cleared === 'reconciled' ? '✓' : txn.cleared === 'cleared' ? 'C' : ''}
      </button>
    </div>
  )
}
