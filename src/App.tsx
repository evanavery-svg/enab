import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Icon, type IconName } from './components/Icon'
import { Toasts } from './components/Toasts'
import { Sidebar } from './components/Sidebar'
import { TransactionModal } from './components/TransactionModal'
import { CategoryDetail } from './components/CategoryDetail'
import { InstallGuide } from './components/InstallGuide'
import { isInstalled } from './lib/install'
import { useData } from './hooks/useData'
import { useUi } from './state/ui'
import BudgetPage from './pages/BudgetPage'
import AccountsPage from './pages/AccountsPage'
import RegisterPage from './pages/RegisterPage'
import ReportsPage from './pages/ReportsPage'
import PlanPage from './pages/PlanPage'
import SettingsPage from './pages/SettingsPage'
import PayeesPage from './pages/PayeesPage'
import ScheduledPage from './pages/ScheduledPage'
import MorePage from './pages/MorePage'

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Budget', icon: 'layers', end: true },
  { to: '/accounts', label: 'Accounts', icon: 'wallet' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/more', label: 'More', icon: 'more' },
]

export default function App() {
  const { settings, ready } = useData()
  const [showInstallGuide, setShowInstallGuide] = useState(false)
  const openTxnModal = useUi((s) => s.openTxnModal)
  const txnModal = useUi((s) => s.txnModal)
  const detailCategoryId = useUi((s) => s.detailCategoryId)
  const location = useLocation()

  // Theme lives on the root element so CSS can key off it directly.
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
  }, [settings.theme])

  useEffect(() => {
    document.title = `${settings.budgetName || 'ENAB'} — ENAB`
  }, [settings.budgetName])

  // Offer the Home Screen guide once, and never to someone already running
  // the installed app. Waits for `ready` so the saved flag has actually loaded.
  useEffect(() => {
    if (!ready || settings.installGuideSeenAt || isInstalled()) return
    setShowInstallGuide(true)
  }, [ready, settings.installGuideSeenAt])

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Routes>
          <Route path="/" element={<BudgetPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/accounts/:accountId" element={<RegisterPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/payees" element={<PayeesPage />} />
          <Route path="/scheduled" element={<ScheduledPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="*" element={<BudgetPage />} />
        </Routes>

        <nav className="bottom-nav">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                isActive || (t.to === '/accounts' && location.pathname.startsWith('/accounts'))
                  ? 'active'
                  : undefined
              }
            >
              <Icon name={t.icon} size={22} />
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <button className="fab" onClick={() => openTxnModal()} aria-label="Add transaction">
        <Icon name="plus" size={26} strokeWidth={2.4} />
      </button>

      {showInstallGuide && <InstallGuide onClose={() => setShowInstallGuide(false)} />}
      {txnModal?.open && <TransactionModal />}
      {detailCategoryId && <CategoryDetail categoryId={detailCategoryId} />}
      <Toasts />
    </div>
  )
}
