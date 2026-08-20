import { Icon } from './Icon'
import { useUi } from '../state/ui'

/**
 * The hamburger that opens the navigation drawer. It lives at the leading edge
 * of every page's top bar, and is shown only on phones (CSS hides it on
 * desktop, where the sidebar is docked).
 */
export function NavMenuButton() {
  const openNav = useUi((s) => s.openNav)
  return (
    <button className="icon-btn nav-menu-btn" onClick={openNav} aria-label="Open menu">
      <Icon name="menu" size={22} />
    </button>
  )
}
