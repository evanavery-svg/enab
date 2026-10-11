import { lazy, Suspense, useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Toasts } from './components/Toasts'
import { Sidebar } from './components/Sidebar'
import { TransactionModal } from './components/TransactionModal'
import { CategoryDetail } from './components/CategoryDetail'
import { InstallGuide } from './components/InstallGuide'
import { isInstalled } from './lib/install'
import { useData } from './hooks/useData'
import { useUi } from './state/ui'
import BudgetPage from './pages/BudgetPage'

// The Budget screen is where the app opens, so it ships in the main bundle.
// Everything else loads on first visit — the service worker precaches every
// chunk, so this costs nothing offline and shortens the launch on a phone.
const AccountsPage = lazy(() => import('./pages/AccountsPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const PlanPage = lazy(() => import('./pages/PlanPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const PayeesPage = lazy(() => import('./pages/PayeesPage'))
const ScheduledPage = lazy(() => import('./pages/ScheduledPage'))
const SubscriptionsPage = lazy(() => import('./pages/SubscriptionsPage'))

export default function App() {
  const { settings, ready } = useData()
  const [showInstallGuide, setShowInstallGuide] = useState(false)
  const txnModal = useUi((s) => s.txnModal)
  const detailCategoryId = useUi((s) => s.detailCategoryId)
  const navOpen = useUi((s) => s.navOpen)
  const openNav = useUi((s) => s.openNav)
  const closeNav = useUi((s) => s.closeNav)
  const location = useLocation()

  // The drawer closes itself whenever the route changes, so tapping any nav
  // link inside it dismisses it.
  useEffect(() => closeNav(), [location.pathname, closeNav])

  // Lock background scroll while the drawer is open. On a phone the page
  // itself scrolls now, and the scrim only blocks touch/click — a wheel or
  // keyboard scroll would otherwise still move the page underneath it.
  useEffect(() => {
    if (!navOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [navOpen])

  // Swipe from the left edge opens the drawer; swipe left while it is open
  // closes it. Touch only, so it never interferes with a mouse on desktop.
  useEffect(() => {
    const EDGE = 30 // px from the left edge that starts an opening swipe
    const THRESHOLD = 55 // horizontal travel that commits the gesture
    let startX = 0
    let startY = 0
    let tracking = false
    let decided = false

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      decided = false
      // Track an opening swipe only from the very edge; a closing swipe from
      // anywhere while the drawer is open.
      tracking = navOpen || startX <= EDGE
    }
    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (!decided) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return
        decided = true
        // A mostly-vertical move is a scroll, not a drawer swipe.
        if (Math.abs(dy) > Math.abs(dx)) {
          tracking = false
          return
        }
      }
      if (!navOpen && dx > THRESHOLD) {
        openNav()
        tracking = false
      } else if (navOpen && dx < -THRESHOLD) {
        closeNav()
        tracking = false
      }
    }
    const onEnd = () => {
      tracking = false
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
    }
  }, [navOpen, openNav, closeNav])

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
    <div className={`app${navOpen ? ' nav-open' : ''}`}>
      {navOpen && <div className="nav-scrim" onClick={closeNav} />}
      <Sidebar />
      <div className="main">
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<BudgetPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:accountId" element={<RegisterPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/plan" element={<PlanPage />} />
            <Route path="/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/payees" element={<PayeesPage />} />
            <Route path="/scheduled" element={<ScheduledPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<BudgetPage />} />
          </Routes>
        </Suspense>
      </div>

      {showInstallGuide && <InstallGuide onClose={() => setShowInstallGuide(false)} />}
      {txnModal?.open && <TransactionModal />}
      {detailCategoryId && <CategoryDetail categoryId={detailCategoryId} />}
      <Toasts />
    </div>
  )
}
