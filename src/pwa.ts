import { registerSW } from 'virtual:pwa-register'

/** Safety net for a session that stays open for days. */
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000

/** Kept so the manual "Check for updates" button can reach the registration. */
let currentRegistration: ServiceWorkerRegistration | null = null

/**
 * Keep the installed app on the newest build.
 *
 * The service worker is built with `skipWaiting` + `clientsClaim`, so a new
 * version activates as soon as it is found rather than waiting for every tab
 * to close. The piece that makes "updates whenever I open it" actually true on
 * a phone is the visibility check: an installed PWA is usually *resumed* from
 * the background rather than freshly loaded, so registration alone would never
 * look for a new version again.
 *
 * iOS is the hard case: it is reluctant to re-fetch the service worker on
 * resume, so an installed app can keep serving a stale build for a long time.
 * `checkForAppUpdate()` below is the manual escape hatch for exactly that.
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

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      currentRegistration = registration

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
  })
}

export type UpdateOutcome = 'unsupported' | 'up-to-date' | 'updating' | 'offline'

/**
 * Force a check for a newer build, right now.
 *
 * Returns what happened so the caller can tell the user plainly:
 *  - `updating`   a new build was found; it activates and the page reloads
 *  - `up-to-date` the running build is already the newest
 *  - `offline`    could not reach the server to check
 *  - `unsupported`service workers are not available (e.g. a private window)
 *
 * When a new worker is found, `skipWaiting` + `clientsClaim` activate it and
 * the `controllerchange` handler above reloads the page. This also nudges any
 * worker that somehow ended up waiting, so a stuck update still goes through.
 */
export async function checkForAppUpdate(): Promise<UpdateOutcome> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported'
  if (navigator.onLine === false) return 'offline'

  const registration =
    currentRegistration ?? (await navigator.serviceWorker.getRegistration()) ?? null
  if (!registration) return 'unsupported'

  let foundUpdate = false
  const onUpdateFound = () => {
    foundUpdate = true
  }
  registration.addEventListener('updatefound', onUpdateFound)

  try {
    await registration.update()
  } catch {
    return 'offline'
  } finally {
    // A new worker installs asynchronously; give it a moment to appear before
    // deciding the app is already current.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    registration.removeEventListener('updatefound', onUpdateFound)
  }

  if (foundUpdate || registration.installing || registration.waiting) {
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
    return 'updating'
  }
  return 'up-to-date'
}
