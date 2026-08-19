/**
 * Keeps `--app-height` equal to the height that is actually on screen.
 *
 * Every CSS-only answer to this has a failure mode on a phone:
 *
 *  - `100vh` is the URL-bar-hidden height, so the bottom of the app sits below
 *    the fold whenever the bar is showing.
 *  - `position: fixed; inset: 0` is measured against the *layout* viewport,
 *    which is that same too-tall box — so the tab bar ends up somewhere other
 *    than the bottom of the screen.
 *  - `100dvh` is right, but it animates as browser chrome collapses, and
 *    Safari updates it late enough that a pinned bar visibly lags.
 *
 * `window.innerHeight` is simply the visible height, on every platform. It
 * tracks browser chrome collapsing, and on iOS it does *not* shrink when the
 * keyboard opens — the keyboard overlays the page rather than resizing it —
 * so the layout stays put while someone types an amount.
 */
export function installViewportHeightSync(): () => void {
  if (typeof window === 'undefined') return () => {}

  const apply = () => {
    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`)
  }

  apply()

  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  // Safari settles the viewport a beat after rotating, so measure again.
  window.addEventListener('orientationchange', () => window.setTimeout(apply, 250))
  window.visualViewport?.addEventListener('resize', apply)

  return () => {
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', apply)
    window.visualViewport?.removeEventListener('resize', apply)
  }
}
