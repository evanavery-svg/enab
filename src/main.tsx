import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { DataProvider } from './hooks/useData'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ensureInitialized, runAutoEnter } from './db/actions'
import { registerServiceWorker } from './pwa'
import { installLayoutSettleFix } from './lib/viewport'
import { checkUpcomingBills } from './lib/notifications'
import { db } from './db/db'
// Imported for its side effect: it must be listening before the browser
// fires `beforeinstallprompt`, which happens early.
import './lib/install'
import './styles/index.css'

// iOS standalone launches with a stale layout; nudge it until it settles.
installLayoutSettleFix()

const container = document.getElementById('root')!

/** Replace the boot screen with a readable failure instead of a blank page. */
function renderBootFailure(message: string) {
  container.innerHTML = ''
  const wrap = document.createElement('div')
  wrap.style.cssText =
    'min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px 24px;text-align:center'
  wrap.innerHTML = `
    <div style="display:grid;place-items:center;width:54px;height:54px;border-radius:14px;background:#16161a;color:#fff;font-size:24px;font-weight:800">E</div>
    <h1 style="margin:0;font-size:19px">ENAB couldn't start</h1>
    <p style="margin:0;max-width:440px;font-size:14.5px;line-height:1.5;opacity:.75">${message}</p>
  `
  const button = document.createElement('button')
  button.textContent = 'Try again'
  button.className = 'btn btn-primary'
  button.onclick = () => window.location.reload()
  wrap.appendChild(button)
  container.appendChild(wrap)
}

async function boot() {
  try {
    await ensureInitialized()
  } catch (error) {
    // Almost always a blocked IndexedDB: private windows and some hardened
    // privacy settings refuse it outright.
    console.error('ENAB failed to open its database:', error)
    renderBootFailure(
      'ENAB stores your budget in this browser, and the browser refused access to its database. ' +
        'Private or incognito windows block this — try a normal window.',
    )
    return
  }

  // Catch up on scheduled transactions that came due while the app was closed.
  // A failure here must never stop the app from opening.
  await runAutoEnter().catch((error) => {
    console.error('Could not enter scheduled transactions:', error)
    return 0
  })

  // Check for upcoming bills, now and whenever the app comes back to the
  // foreground. Settings are re-read each time so toggling the reminders off
  // (or changing the lead time) takes effect without a reload.
  const checkBills = async () => {
    const s = await db.settings.get('settings')
    if (!s?.notificationsEnabled) return
    await checkUpcomingBills(s.notifyDaysBefore ?? 1)
  }
  checkBills().catch(() => {})
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkBills().catch(() => {})
  })

  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <HashRouter>
          <DataProvider>
            <App />
          </DataProvider>
        </HashRouter>
      </ErrorBoundary>
    </StrictMode>,
  )
}

boot().catch((error) => {
  console.error('ENAB failed to start:', error)
  renderBootFailure('An unexpected error stopped ENAB from starting. Reloading usually clears it.')
})

registerServiceWorker()
