import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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
const pages = {
  accounts: () => import('./pages/AccountsPage'),
  register: () => import('./pages/RegisterPage'),
  reports: () => import('./pages/ReportsPage'),
  plan: () => import('./pages/PlanPage'),
  settings: () => import('./pages/SettingsPage'),
  payees: () => import('./pages/PayeesPage'),
  scheduled: () => import('./pages/ScheduledPage'),
  subscriptions: () => import('./pages/SubscriptionsPage'),
  groceries: () => import('./pages/GroceriesPage'),
  today: () => import('./pages/TodayPage'),
  search: () => import('./pages/SearchPage'),
  calendar: () => import('./pages/CalendarPage'),
  review: () => import('./pages/ReviewPage'),
}
const AccountsPage = lazy(pages.accounts)
const RegisterPage = lazy(pages.register)
const ReportsPage = lazy(pages.reports)
const PlanPage = lazy(pages.plan)
const SettingsPage = lazy(pages.settings)
const PayeesPage = lazy(pages.payees)
const ScheduledPage = lazy(pages.scheduled)
const SubscriptionsPage = lazy(pages.subscriptions)
const GroceriesPage = lazy(pages.groceries)
const TodayPage = lazy(pages.today)
const SearchPage = lazy(pages.search)
const CalendarPage = lazy(pages.calendar)
const ReviewPage = lazy(pages.review)

/**
 * Load every other screen's code once the app has settled. Until a lazy page
 * has loaded, opening it blanks the screen for a beat while the chunk is
 * fetched and parsed; warmed up in idle time, every tab opens at once.
 */
function preloadPages() {
  const idle =
    (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback ??
    ((cb: () => void) => window.setTimeout(cb, 1))
  const queue = Object.values(pages)
  const next = () => {
    const load = queue.shift()
    if (!load) return
    load().catch(() => {}).finally(() => idle(next, { timeout: 2000 }))
  }
  window.setTimeout(() => idle(next, { timeout: 2000 }), 1200)
}

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

  useEffect(preloadPages, [])

  // "/" opens search from anywhere a keyboard is in use, unless typing.
  const navigate = useNavigate()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.scrim, .drawer')) return
      e.preventDefault()
      navigate('/search')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])

  // A new screen starts at its top. On a phone the document is what scrolls,
  // so without this a page opened from halfway down the budget would open
  // halfway down too.
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

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
            <Route path="/groceries" element={<GroceriesPage />} />
            <Route path="/today" element={<TodayPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/review/:month" element={<ReviewPage />} />
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
