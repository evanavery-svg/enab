import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { DataProvider } from './hooks/useData'
import { ensureInitialized, runAutoEnter } from './db/actions'
import './styles/index.css'

async function boot() {
  await ensureInitialized()
  // Catch up on any scheduled transactions that came due while the app was
  // closed, before the first render reads the data.
  await runAutoEnter().catch(() => 0)

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <DataProvider>
          <App />
        </DataProvider>
      </HashRouter>
    </StrictMode>,
  )
}

boot()

registerSW({ immediate: true })
