import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../components/Icon'
import { AppFooter } from '../components/AppFooter'
import { useData } from '../hooks/useData'
import { updateSettings } from '../db/actions'

const LINKS: { to: string; label: string; icon: IconName; blurb: string }[] = [
  { to: '/scheduled', label: 'Scheduled', icon: 'repeat', blurb: 'Recurring transactions and upcoming bills' },
  { to: '/payees', label: 'Payees', icon: 'users', blurb: 'Rename, merge and tidy up' },
  { to: '/settings', label: 'Settings', icon: 'settings', blurb: 'Currency, theme, backups and CSV import' },
]

export default function MorePage() {
  const { settings, budget, money, transactions } = useData()
  const uncategorized = budget.uncategorizedCount

  return (
    <>
      <header className="topbar">
        <h1>More</h1>
        <span className="spacer" />
        <button
          className="icon-btn"
          title="Toggle theme"
          onClick={() =>
            updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
          }
        >
          <Icon name={settings.theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </header>

      <div className="content content-pad">
        <div className="content-narrow">
          {uncategorized > 0 && (
            <Link
              to="/accounts"
              className="card card-pad"
              style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, color: 'var(--warning)' }}
            >
              <Icon name="alert" size={18} />
              <span style={{ fontSize: 14 }}>
                {uncategorized} transaction{uncategorized === 1 ? '' : 's'} still need a category.
              </span>
            </Link>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            {LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="list-row" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                <Icon name={l.icon} size={18} />
                <span className="grow">
                  <span style={{ fontWeight: 600 }}>{l.label}</span>
                  <span className="sub">{l.blurb}</span>
                </span>
                <Icon name="chevronRight" size={16} />
              </Link>
            ))}
          </div>

          <div className="card card-pad">
            <div className="sidebar-brand" style={{ marginBottom: 8 }}>
              <span className="mark">E</span>
              <span>{settings.budgetName}</span>
            </div>
            <p className="dim" style={{ fontSize: 13.5, marginBottom: 0 }}>
              {transactions.length} transaction{transactions.length === 1 ? '' : 's'} ·{' '}
              {budget.months.length} month{budget.months.length === 1 ? '' : 's'} of budget history ·{' '}
              {money(budget.summaries.get(budget.months[budget.months.length - 1] ?? '')?.totalAvailable ?? 0)}{' '}
              sitting in categories.
            </p>
          </div>

          <AppFooter style={{ marginTop: 18 }} />
        </div>
      </div>
    </>
  )
}
