/**
 * Work around a stale layout after an iOS standalone launch.
 *
 * Symptom: opening the app from the Home Screen lays the page out against a
 * viewport that is briefly shorter than the screen. Safari then settles to the
 * real height but does *not* re-run layout, so anything anchored to the bottom
 * of the viewport — the tab bar — sits above the true bottom edge with a band
 * of background beneath it. It snaps into place the moment a sheet is opened,
 * because that mutates a style on <body> and dirties the layout.
 *
 * The value iOS reports is not the problem; the missing re-layout is. So dirty
 * the layout ourselves a few times over the first second, and again whenever
 * the app is resumed. `position: fixed` bars then resolve against the settled
 * viewport and land on the real bottom edge.
 */

/** Mutate a harmless property and force a synchronous layout flush. */
function forceReflow(): void {
  const body = document.body
  if (!body) return
  // A hundredth of a pixel of padding is invisible, and body has
  // `overflow: hidden`, so nothing can shift or scroll as a result.
  body.style.paddingBottom = '0.01px'
  void body.offsetHeight
  body.style.paddingBottom = ''
  void body.offsetHeight
}

export function installLayoutSettleFix(): () => void {
  if (typeof window === 'undefined') return () => {}

  // Spread across the first second: iOS settles the viewport at an
  // unpredictable moment, and a reflow is cheap.
  const timers = [0, 50, 150, 350, 700, 1200].map((ms) => window.setTimeout(forceReflow, ms))
  const raf = requestAnimationFrame(() => requestAnimationFrame(forceReflow))

  // Returning from the background is a fresh launch as far as layout goes.
  const onResume = () => {
    if (document.visibilityState === 'visible') forceReflow()
  }
  document.addEventListener('visibilitychange', onResume)
  window.addEventListener('pageshow', forceReflow)
  window.addEventListener('orientationchange', () => window.setTimeout(forceReflow, 250))

  return () => {
    timers.forEach((t) => window.clearTimeout(t))
    cancelAnimationFrame(raf)
    document.removeEventListener('visibilitychange', onResume)
    window.removeEventListener('pageshow', forceReflow)
  }
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

export interface ViewportReport {
  mode: string
  innerHeight: number
  clientHeight: number
  visualViewport: number | null
  screenHeight: number
  navBottom: number | null
  /** Space between the bottom of the tab bar and the bottom of the screen. */
  gapBelowNav: number | null
  navPosition: string | null
  safeAreaBottom: string
  safeAreaTop: string
  devicePixelRatio: number
  /**
   * Screen height minus viewport height. In a standalone app this should be
   * ~0: anything larger means iOS handed the web view a viewport that does not
   * reach the bottom of the screen, and no CSS inside it can fill the
   * remainder. This is the measurement that exposed the black-translucent bug.
   */
  screenShortfall: number
}

/**
 * A live readout of everything that decides where the tab bar sits. Surfaced
 * in Settings so a layout problem on a device we cannot debug directly can be
 * diagnosed from a single screenshot rather than another round of guessing.
 */
export function readViewport(): ViewportReport {
  const nav = document.querySelector('.bottom-nav') as HTMLElement | null
  const navRect = nav?.getBoundingClientRect() ?? null
  const styles = getComputedStyle(document.documentElement)

  const modes = ['standalone', 'fullscreen', 'minimal-ui', 'browser']
  const mode =
    modes.find((m) => window.matchMedia(`(display-mode: ${m})`).matches) ??
    ((navigator as { standalone?: boolean }).standalone ? 'standalone (ios)' : 'unknown')

  return {
    mode,
    innerHeight: Math.round(window.innerHeight),
    clientHeight: Math.round(document.documentElement.clientHeight),
    visualViewport: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    screenHeight: Math.round(window.screen?.height ?? 0),
    navBottom: navRect ? Math.round(navRect.bottom) : null,
    gapBelowNav: navRect ? Math.round(window.innerHeight - navRect.bottom) : null,
    navPosition: nav ? getComputedStyle(nav).position : null,
    safeAreaBottom: styles.getPropertyValue('--probe-safe-bottom').trim() || 'n/a',
    safeAreaTop: styles.getPropertyValue('--probe-safe-top').trim() || 'n/a',
    devicePixelRatio: window.devicePixelRatio,
    screenShortfall: Math.round((window.screen?.height ?? 0) - window.innerHeight),
  }
}

/** Force a re-layout on demand — wired to a button in the diagnostics panel. */
export const nudgeLayoutNow = forceReflow
