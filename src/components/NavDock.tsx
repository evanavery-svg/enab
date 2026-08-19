import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import { useUi } from '../state/ui'

interface Destination {
  to: string
  label: string
  icon: IconName
  /** Match this route exactly rather than by prefix. */
  exact?: boolean
}

const DESTINATIONS: Destination[] = [
  { to: '/', label: 'Budget', icon: 'layers', exact: true },
  { to: '/accounts', label: 'Accounts', icon: 'wallet' },
  { to: '/plan', label: 'Auto-Budget', icon: 'target' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/scheduled', label: 'Scheduled', icon: 'repeat' },
  { to: '/payees', label: 'Payees', icon: 'users' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

function activeDestination(pathname: string): Destination {
  // Longest matching prefix wins, so /accounts/123 still resolves to Accounts.
  const match = DESTINATIONS.filter((d) =>
    d.exact ? pathname === d.to : pathname === d.to || pathname.startsWith(d.to + '/'),
  ).sort((a, b) => b.to.length - a.to.length)[0]
  return match ?? DESTINATIONS[0]
}

/**
 * The mobile navigation: a floating pill that names the current section and
 * opens a menu, plus a dedicated add button. It floats above the bottom with
 * margin, so it never depends on the screen's true bottom edge — which is the
 * measurement iOS gets wrong in a standalone app, and the reason the old
 * flush tab bar could not sit right.
 */
export function NavDock() {
  const location = useLocation()
  const navigate = useNavigate()
  const openTxnModal = useUi((s) => s.openTxnModal)
  const [menuOpen, setMenuOpen] = useState(false)

  const current = activeDestination(location.pathname)

  // Close the menu whenever the route changes.
  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <>
      <div className="navdock" role="navigation" aria-label="Primary">
        <button className="navdock-menu" onClick={() => setMenuOpen(true)} aria-haspopup="menu">
          <span className="navdock-menu-icon">
            <Icon name={current.icon} size={19} />
          </span>
          <span className="navdock-menu-label">{current.label}</span>
          <Icon name="chevronUp" size={16} className="navdock-menu-chev" />
        </button>
        <button className="navdock-add" onClick={() => openTxnModal()} aria-label="Add transaction">
          <Icon name="plus" size={24} strokeWidth={2.4} />
        </button>
      </div>

      {menuOpen && (
        <NavSheet
          current={current}
          onClose={() => setMenuOpen(false)}
          onNavigate={(to) => {
            setMenuOpen(false)
            navigate(to)
          }}
          onAdd={() => {
            setMenuOpen(false)
            openTxnModal()
          }}
        />
      )}
    </>
  )
}

function NavSheet({
  current,
  onClose,
  onNavigate,
  onAdd,
}: {
  current: Destination
  onClose: () => void
  onNavigate: (to: string) => void
  onAdd: () => void
}) {
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

        <button className="navsheet-add" onClick={onAdd}>
          <Icon name="plus" size={20} strokeWidth={2.4} />
          <span>New Transaction</span>
        </button>

        <div className="navsheet-list">
          {DESTINATIONS.map((d) => {
            const isCurrent = d.to === current.to
            return (
              <button
                key={d.to}
                className={`navsheet-item${isCurrent ? ' current' : ''}`}
                onClick={() => onNavigate(d.to)}
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
