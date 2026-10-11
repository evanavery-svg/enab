import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import { Logo } from './Logo'
import { AccountFormModal } from './AccountForm'
import { AppFooter } from './AppFooter'
import { useData } from '../hooks/useData'
import { useUi } from '../state/ui'
import type { Account, Cents } from '../types'

export function Sidebar() {
  const { settings, accounts, balances, money, budget } = useData()
  const month = useUi((s) => s.month)
  const openTxnModal = useUi((s) => s.openTxnModal)
  const closeNav = useUi((s) => s.closeNav)
  const [addingAccount, setAddingAccount] = useState(false)

  const readyToAssign = budget.summaries.get(month)?.readyToAssign ?? 0

  const open = accounts.filter((a) => !a.closed)
  const sections: { title: string; items: Account[] }[] = [
    { title: 'Budget', items: open.filter((a) => a.class === 'budget') },
    { title: 'Credit Cards', items: open.filter((a) => a.class === 'credit') },
    { title: 'Tracking', items: open.filter((a) => a.class === 'tracking') },
    { title: 'Closed', items: accounts.filter((a) => a.closed) },
  ]

  const total = (items: Account[]): Cents =>
    items.reduce((sum, a) => sum + (balances.get(a.id)?.working ?? 0), 0)

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-brand">
          <Logo size={26} />
          <span>ENAB</span>
        </div>
        <div className="sidebar-budget-name truncate">{settings.budgetName}</div>
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 10 }}
          onClick={() => {
            closeNav()
            openTxnModal()
          }}
        >
          <Icon name="plus" size={16} /> Add Transaction
        </button>
      </div>

      <div className="sidebar-scroll">
        <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Icon name="layers" />
          <span>Budget</span>
          <span className={`nav-amount ${readyToAssign < 0 ? 'neg' : ''}`}>{money(readyToAssign)}</span>
        </NavLink>
        <NavLink to="/plan" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Icon name="target" />
          <span>Auto-Budget</span>
        </NavLink>
        <NavLink to="/reports" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Icon name="chart" />
          <span>Reports</span>
        </NavLink>
        <NavLink to="/subscriptions" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Icon name="repeat" />
          <span>Subscriptions</span>
        </NavLink>
        <NavLink to="/accounts" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Icon name="wallet" />
          <span>All Accounts</span>
        </NavLink>

        {sections.map((section) =>
          section.items.length === 0 ? null : (
            <div key={section.title}>
              <div className="sidebar-section">
                <h4>{section.title}</h4>
                <span className="total">{money(total(section.items))}</span>
              </div>
              {section.items.map((a) => {
                const balance = balances.get(a.id)?.working ?? 0
                return (
                  <NavLink
                    key={a.id}
                    to={`/accounts/${a.id}`}
                    className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                  >
                    <span className="truncate" style={{ flex: 1, minWidth: 0 }}>
                      {a.name}
                    </span>
                    <span className={`nav-amount ${balance < 0 ? 'neg' : ''}`}>{money(balance)}</span>
                  </NavLink>
                )
              })}
            </div>
          ),
        )}

        <button className="nav-link" style={{ width: '100%', border: 0, background: 'none', marginTop: 10 }} onClick={() => { closeNav(); setAddingAccount(true) }}>
          <Icon name="plus" />
          <span>Add Account</span>
        </button>
      </div>

      <div className="sidebar-foot">
        <NavLink to="/scheduled" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Icon name="repeat" />
          <span>Scheduled</span>
        </NavLink>
        <NavLink to="/payees" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Icon name="users" />
          <span>Payees</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Icon name="settings" />
          <span>Settings</span>
        </NavLink>
        <AppFooter />
      </div>

      {addingAccount && <AccountFormModal onClose={() => setAddingAccount(false)} />}
    </aside>
  )
}
