import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import { useUi } from '../state/ui'

interface Destination {
  to: string
  label: string
  icon: IconName
  /** Match this route exactly rather than by prefix. */
  exact?: boolean
}

/** The four primary tabs, always visible in the bar. */
const PRIMARY: Destination[] = [
  { to: '/', label: 'Budget', icon: 'layers', exact: true },
  { to: '/accounts', label: 'Accounts', icon: 'wallet' },
  { to: '/plan', label: 'Auto-Budget', icon: 'target' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
]

/** Everything else lives behind the "More" tab. */
const MORE: Destination[] = [
  { to: '/scheduled', label: 'Scheduled', icon: 'repeat' },
  { to: '/payees', label: 'Payees', icon: 'users' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

/** True when the current route belongs to the "More" group. */
function inMore(pathname: string): boolean {
  return MORE.some((d) => pathname === d.to || pathname.startsWith(d.to + '/'))
}

/**
 * The mobile navigation: a flush bottom tab bar. It is a plain flex child at
 * the end of the `.app` column (see layout.css) — nothing position:fixed — so
 * it sits on the screen's true bottom edge even in an iOS standalone PWA,
 * where fixed / percentage-height layouts leave a band of dead space below.
 * On desktop the sidebar navigates and this is hidden by CSS.
 */
export function BottomNav() {
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  // Close the sheet whenever the route changes.
  useEffect(() => setMoreOpen(false), [location.pathname])

  const moreActive = inMore(location.pathname)

  return (
    <>
      <nav className="bottom-nav" aria-label="Primary">
        {PRIMARY.map((d) => (
          <NavLink
            key={d.to}
            to={d.to}
            end={d.exact}
            className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
          >
            <span className="bn-ico">
              <Icon name={d.icon} size={22} />
            </span>
            {d.label}
          </NavLink>
        ))}
        <button
          className={`bottom-nav-item${moreActive ? ' active' : ''}`}
          onClick={() => setMoreOpen(true)}
          aria-haspopup="menu"
        >
          <span className="bn-ico">
            <Icon name="more" size={22} />
          </span>
          More
        </button>
      </nav>

      {moreOpen && <MoreSheet current={location.pathname} onClose={() => setMoreOpen(false)} />}
    </>
  )
}

function MoreSheet({ current, onClose }: { current: string; onClose: () => void }) {
  const navigate = useNavigate()
  const openTxnModal = useUi((s) => s.openTxnModal)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <div className="navsheet-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="navsheet" role="menu">
        <div className="navsheet-grabber" />

        <button
          className="navsheet-add"
          onClick={() => {
            onClose()
            openTxnModal()
          }}
        >
          <Icon name="plus" size={20} strokeWidth={2.4} />
          <span>New Transaction</span>
        </button>

        <div className="navsheet-list">
          {MORE.map((d) => {
            const isCurrent = current === d.to || current.startsWith(d.to + '/')
            return (
              <button
                key={d.to}
                className={`navsheet-item${isCurrent ? ' current' : ''}`}
                onClick={() => {
                  onClose()
                  navigate(d.to)
                }}
                role="menuitem"
              >
                <span className="navsheet-item-icon">
                  <Icon name={d.icon} size={20} />
                </span>
                <span className="navsheet-item-label">{d.label}</span>
                {isCurrent && <span className="navsheet-dot" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
