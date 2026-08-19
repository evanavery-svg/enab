/**
 * Home-screen install support.
 *
 * Chromium fires `beforeinstallprompt` once, early, and only if the page is
 * installable — so the listener is registered at module load (imported from
 * main.tsx) rather than when some component happens to mount. Safari fires
 * nothing at all, which is why the guide also carries written steps.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type Platform = 'ios' | 'android' | 'desktop'

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Holding onto the event is what lets us show our own button instead of
    // the browser's mini-infobar.
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    notify()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

/** True when the browser can install the app with one tap. */
export const canPromptInstall = () => deferredPrompt !== null

export function subscribeToInstallability(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable'
  const event = deferredPrompt
  // A saved prompt can only be used once, whatever the outcome.
  deferredPrompt = null
  notify()
  await event.prompt()
  const { outcome } = await event.userChoice
  return outcome
}

/** True when the app is already running as an installed app. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true
  // Safari on iOS predates display-mode and uses its own flag.
  if ((navigator as { standalone?: boolean }).standalone === true) return true
  return document.referrer.startsWith('android-app://')
}

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac, so touch points are the giveaway.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  if (/iPad|iPhone|iPod/.test(ua) || iPadOS) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

/** On iOS, only Safari can add to the Home Screen on older versions. */
export function isIosNonSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  return detectPlatform() === 'ios' && /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent)
}
