import { registerSW } from 'virtual:pwa-register'

/** Safety net for a session that stays open for days. */
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000

/**
 * Keep the installed app on the newest build.
 *
 * The service worker is built with `skipWaiting` + `clientsClaim`, so a new
 * version activates as soon as it is found rather than waiting for every tab
 * to close. The piece that makes "updates whenever I open it" actually true on
 * a phone is the visibility check: an installed PWA is usually *resumed* from
 * the background rather than freshly loaded, so registration alone would never
 * look for a new version again.
 */
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  // Whether this page was already controlled when it loaded. On a first
  // install it is not, and taking over a previously uncontrolled page is not
  // an update — reloading there would loop.
  const wasControlled = !!navigator.serviceWorker.controller
  let reloading = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wasControlled || reloading) return
    reloading = true
    // Everything is already persisted in IndexedDB, so a reload loses nothing.
    window.location.reload()
  })

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return

      const checkForUpdate = () => {
        if (document.visibilityState !== 'visible') return
        if (navigator.onLine === false) return
        registration.update().catch(() => {
          /* offline or the server is unreachable — try again next time */
        })
      }

      document.addEventListener('visibilitychange', checkForUpdate)
      window.addEventListener('focus', checkForUpdate)
      window.addEventListener('online', checkForUpdate)
      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL)
    },
    onNeedRefresh() {
      // autoUpdate applies new builds on its own; this covers the case where
      // a worker is left waiting anyway.
      updateSW(true).catch(() => {})
    },
  })
}
