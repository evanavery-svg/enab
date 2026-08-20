import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { NavMenuButton } from '../components/NavMenuButton'
import { AccountFormModal } from '../components/AccountForm'
import { useData } from '../hooks/useData'
import { ACCOUNT_TYPE_LABELS } from '../db/actions'
import { formatDate } from '../lib/dates'
import type { Account } from '../types'

export default function AccountsPage() {
  const { accounts, balances, money, settings } = useData()
  const [adding, setAdding] = useState(false)

  const open = accounts.filter((a) => !a.closed)
  const sections: { title: string; hint?: string; items: Account[] }[] = [
    { title: 'Budget accounts', hint: 'Money here is available to assign', items: open.filter((a) => a.class === 'budget') },
    { title: 'Credit', hint: 'Each has its own payment category', items: open.filter((a) => a.class === 'credit') },
    { title: 'Tracking', hint: 'Counted in net worth, outside the budget', items: open.filter((a) => a.class === 'tracking') },
    { title: 'Closed', items: accounts.filter((a) => a.closed) },
  ]

  const totalFor = (items: Account[]) =>
    items.reduce((sum, a) => sum + (balances.get(a.id)?.working ?? 0), 0)

  const onBudgetTotal = totalFor(open.filter((a) => a.onBudget))
  const assets = accounts
    .filter((a) => !a.closed)
    .reduce((sum, a) => sum + Math.max(0, balances.get(a.id)?.working ?? 0), 0)
  const debts = accounts
    .filter((a) => !a.closed)
    .reduce((sum, a) => sum + Math.min(0, balances.get(a.id)?.working ?? 0), 0)

  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <h1>All Accounts</h1>
        <span className="spacer" />
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} /> Account
        </button>
      </header>

      <div className="content content-pad">
        <div className="content-narrow">
          <div className="acct-summary">
            <div className="card stat">
              <div className="k">Net worth</div>
              <div className={`v ${assets + debts < 0 ? 'neg' : ''}`}>{money(assets + debts)}</div>
            </div>
            <div className="card stat">
              <div className="k">Assets</div>
              <div className="v pos">{money(assets)}</div>
            </div>
            <div className="card stat">
              <div className="k">Debts</div>
              <div className="v neg">{money(debts)}</div>
            </div>
            <div className="card stat">
              <div className="k">On budget</div>
              <div className="v">{money(onBudgetTotal)}</div>
            </div>
          </div>

          {accounts.length === 0 && (
            <div className="card empty">
              <h3>No accounts yet</h3>
              <p>Add the account your money sits in to get started.</p>
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
                <Icon name="plus" size={16} /> Add account
              </button>
            </div>
          )}

          {sections.map((section) =>
            section.items.length === 0 ? null : (
              <div key={section.title} style={{ marginBottom: 16 }}>
                <div className="sidebar-section" style={{ padding: '0 4px' }}>
                  <h4>{section.title}</h4>
                  <span className="total">{money(totalFor(section.items))}</span>
                </div>
                {section.hint && (
                  <p className="faint" style={{ fontSize: 12.5, margin: '0 4px 6px' }}>
                    {section.hint}
                  </p>
                )}
                <div className="card">
                  <ul className="acct-list">
                    {section.items.map((a) => {
                      const b = balances.get(a.id)
                      return (
                        <li key={a.id}>
                          <Link to={`/accounts/${a.id}`}>
                            <Icon
                              name={a.class === 'credit' ? 'card' : a.class === 'tracking' ? 'chart' : 'bank'}
                              size={18}
                            />
                            <span className="name">
                              <span className="truncate">{a.name}</span>
                              <small>
                                {ACCOUNT_TYPE_LABELS[a.type]}
                                {a.lastReconciledAt &&
                                  ` · reconciled ${formatDate(a.lastReconciledAt.slice(0, 10), settings.dateFormat)}`}
                                {(b?.uncleared ?? 0) !== 0 && ` · ${money(b!.uncleared)} uncleared`}
                              </small>
                            </span>
                            <span className={`bal ${(b?.working ?? 0) < 0 ? 'neg' : ''}`}>
                              {money(b?.working ?? 0)}
                            </span>
                            <Icon name="chevronRight" size={16} />
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      {adding && <AccountFormModal onClose={() => setAdding(false)} />}
    </>
  )
}
