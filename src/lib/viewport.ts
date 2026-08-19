/**
 * Keeps `--app-height` equal to the height that is actually on screen.
 *
 * The problem this solves, seen on an installed iOS app: for the first moment
 * after launch the system reports a viewport that is too short, and it does
 * not reliably fire a `resize` when it settles a beat later. So a shell sized
 * to the viewport comes up short, leaving a band of background under the tab
 * bar — until any interaction (opening a sheet, a tap) forces a reflow and the
 * layout snaps to the real height.
 *
 * `window.innerHeight` is the visible height on every platform, and it does
 * become correct within about a second of launch. The trick is simply to
 * read it again after that settle, without waiting for the user to tap. So we
 * re-measure on a short schedule after start, on every viewport event, and —
 * belt and braces — on the very first pointer interaction, which is the thing
 * that was fixing it by hand.
 */
export function installViewportHeightSync(): () => void {
  if (typeof window === 'undefined') return () => {}

  const root = document.documentElement
  let last = -1

  const apply = () => {
    const h = window.visualViewport?.height ?? window.innerHeight
    if (!h || Math.abs(h - last) < 1) return
    last = h
    root.style.setProperty('--app-height', `${Math.round(h)}px`)
  }

  const force = () => {
    last = -1
    apply()
  }

  apply()
  // Catch the post-launch settle without needing the user to interact.
  requestAnimationFrame(() => requestAnimationFrame(force))
  const timers = [60, 150, 300, 600, 1000, 1600].map((ms) => window.setTimeout(force, ms))

  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', force)
  window.addEventListener('pageshow', force)
  window.addEventListener('focus', apply)
  document.addEventListener('visibilitychange', apply)
  window.visualViewport?.addEventListener('resize', apply)
  window.visualViewport?.addEventListener('scroll', apply)

  // The first real interaction is precisely what used to fix it manually, so
  // re-measure then too and stop listening once it has fired.
  const onFirstInteraction = () => {
    force()
    window.removeEventListener('pointerdown', onFirstInteraction)
    window.removeEventListener('touchstart', onFirstInteraction)
  }
  window.addEventListener('pointerdown', onFirstInteraction, { once: true, passive: true })
  window.addEventListener('touchstart', onFirstInteraction, { once: true, passive: true })

  return () => {
    timers.forEach((t) => window.clearTimeout(t))
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', force)
    window.removeEventListener('pageshow', force)
    window.removeEventListener('focus', apply)
    document.removeEventListener('visibilitychange', apply)
    window.visualViewport?.removeEventListener('resize', apply)
    window.visualViewport?.removeEventListener('scroll', apply)
  }
}
