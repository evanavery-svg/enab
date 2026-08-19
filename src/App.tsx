import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Toasts } from './components/Toasts'
import { Sidebar } from './components/Sidebar'
import { NavDock } from './components/NavDock'
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

export default function App() {
  const { settings, ready } = useData()
  const [showInstallGuide, setShowInstallGuide] = useState(false)
  const txnModal = useUi((s) => s.txnModal)
  const detailCategoryId = useUi((s) => s.detailCategoryId)

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
          <Route path="*" element={<BudgetPage />} />
        </Routes>
      </div>

      <NavDock />

      {showInstallGuide && <InstallGuide onClose={() => setShowInstallGuide(false)} />}
      {txnModal?.open && <TransactionModal />}
      {detailCategoryId && <CategoryDetail categoryId={detailCategoryId} />}
      <Toasts />
    </div>
  )
}
