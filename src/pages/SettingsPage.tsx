import { useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { ConfirmDialog } from '../components/Modal'
import { CsvImportModal } from '../components/CsvImportModal'
import { InstallGuide } from '../components/InstallGuide'
import { isInstalled } from '../lib/install'
import { checkForAppUpdate } from '../pwa'
import { APP_VERSION } from '../lib/version'
import { SettingsRow } from '../components/Fields'
import { useData } from '../hooks/useData'
import { toast } from '../state/ui'
import { ensureInitialized, updateSettings } from '../db/actions'
import { clearAllTables } from '../db/db'
import { downloadFile, exportBackup, exportTransactionsCsv, importBackup } from '../lib/backup'
import { today } from '../lib/dates'
import type { Settings } from '../types'

const DATE_FORMATS: { value: Settings['dateFormat']; label: string }[] = [
  { value: 'MM/dd/yyyy', label: '08/19/2026' },
  { value: 'dd/MM/yyyy', label: '19/08/2026' },
  { value: 'yyyy-MM-dd', label: '2026-08-19' },
  { value: 'dd.MM.yyyy', label: '19.08.2026' },
]

const CURRENCIES: { symbol: string; code: string; label: string }[] = [
  { symbol: '$', code: 'USD', label: 'US Dollar' },
  { symbol: '£', code: 'GBP', label: 'British Pound' },
  { symbol: '€', code: 'EUR', label: 'Euro' },
  { symbol: 'C$', code: 'CAD', label: 'Canadian Dollar' },
  { symbol: 'A$', code: 'AUD', label: 'Australian Dollar' },
  { symbol: '¥', code: 'JPY', label: 'Japanese Yen' },
  { symbol: '₹', code: 'INR', label: 'Indian Rupee' },
  { symbol: 'kr', code: 'SEK', label: 'Swedish Krona' },
  { symbol: 'R$', code: 'BRL', label: 'Brazilian Real' },
]

export default function SettingsPage() {
  const { settings, money, transactions, accounts } = useData()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importingCsv, setImportingCsv] = useState(false)
  const [confirmFreshStart, setConfirmFreshStart] = useState(false)
  const [showInstallGuide, setShowInstallGuide] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  async function checkUpdates() {
    setCheckingUpdate(true)
    try {
      const outcome = await checkForAppUpdate()
      if (outcome === 'updating') {
        toast('New version found — updating now…')
        // The service worker reloads the page once it takes over; if it hasn't
        // within a few seconds, reload anyway so the user is never left waiting.
        setTimeout(() => window.location.reload(), 4000)
      } else if (outcome === 'up-to-date') {
        toast(`You're on the latest version (${APP_VERSION})`)
      } else if (outcome === 'offline') {
        toast('Could not check — you appear to be offline', { tone: 'danger' })
      } else {
        toast('Updates are managed by your browser here')
      }
    } finally {
      setCheckingUpdate(false)
    }
  }
  const [pendingRestore, setPendingRestore] = useState<string | null>(null)

  const set = (patch: Partial<Settings>) => updateSettings(patch)

  async function doExport() {
    const backup = await exportBackup()
    downloadFile(`enab-backup-${today()}.json`, JSON.stringify(backup, null, 2))
    toast('Backup downloaded')
  }

  async function doExportCsv() {
    downloadFile(`enab-transactions-${today()}.csv`, await exportTransactionsCsv(), 'text/csv')
    toast('Transactions exported')
  }

  async function doRestore(raw: string) {
    try {
      const result = await importBackup(raw)
      toast(`Restored ${result.accounts} accounts and ${result.transactions} transactions`)
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Restore failed', { tone: 'danger' })
    } finally {
      setPendingRestore(null)
    }
  }

  async function freshStart() {
    await clearAllTables()
    await ensureInitialized()
    toast('Fresh start — everything cleared')
    setConfirmFreshStart(false)
  }

  return (
    <>
      <header className="topbar">
        <h1>Settings</h1>
      </header>

      <div className="content content-pad">
        <div className="content-narrow">
          <div className="settings-group">
            <h3>Budget</h3>
            <div className="card">
              <SettingsRow label="Budget name">
                <input
                  className="input"
                  value={settings.budgetName}
                  onChange={(e) => set({ budgetName: e.target.value })}
                />
              </SettingsRow>
              <SettingsRow label="Currency" hint={`Example: ${money(-123456)}`}>
                <select
                  className="select"
                  value={settings.currencyCode}
                  onChange={(e) => {
                    const c = CURRENCIES.find((x) => x.code === e.target.value)
                    if (c) set({ currencyCode: c.code, currencySymbol: c.symbol })
                  }}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.symbol} {c.label}
                    </option>
                  ))}
                </select>
              </SettingsRow>
              <SettingsRow label="Symbol position">
                <select
                  className="select"
                  value={settings.symbolPosition}
                  onChange={(e) => set({ symbolPosition: e.target.value as Settings['symbolPosition'] })}
                >
                  <option value="before">Before ({settings.currencySymbol}100)</option>
                  <option value="after">After (100 {settings.currencySymbol})</option>
                </select>
              </SettingsRow>
              <SettingsRow label="Number format">
                <select
                  className="select"
                  value={`${settings.groupSeparator}|${settings.decimalSeparator}`}
                  onChange={(e) => {
                    const [group, decimal] = e.target.value.split('|')
                    set({
                      groupSeparator: group as Settings['groupSeparator'],
                      decimalSeparator: decimal as Settings['decimalSeparator'],
                    })
                  }}
                >
                  <option value=",|.">1,234.56</option>
                  <option value=".|,">1.234,56</option>
                  <option value=" |,">1 234,56</option>
                  <option value="|.">1234.56</option>
                </select>
              </SettingsRow>
              <SettingsRow label="Hide decimals" hint="Amounts with cents still show them" compact>
                <input
                  type="checkbox"
                  className="toggle"
                  checked={settings.hideDecimals}
                  onChange={(e) => set({ hideDecimals: e.target.checked })}
                />
              </SettingsRow>
              <SettingsRow label="Date format">
                <select
                  className="select"
                  value={settings.dateFormat}
                  onChange={(e) => set({ dateFormat: e.target.value as Settings['dateFormat'] })}
                >
                  {DATE_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </SettingsRow>
            </div>
          </div>

          <div className="settings-group">
            <h3>On your phone</h3>
            <div className="card">
              <SettingsRow
                label={isInstalled() ? 'Installed' : 'Add to your Home Screen'}
                hint={
                  isInstalled()
                    ? 'You are running the installed app. It works offline and updates itself when you open it.'
                    : 'Open ENAB full screen, with its own icon, working offline.'
                }
                compact
              >
                <button className="btn btn-sm" onClick={() => setShowInstallGuide(true)}>
                  <Icon name="download" size={15} /> Show me how
                </button>
              </SettingsRow>
              <SettingsRow
                label={`Version ${APP_VERSION}`}
                hint="Force a check for the newest build. Handy when an installed app is slow to update itself."
                compact
              >
                <button className="btn btn-sm" onClick={checkUpdates} disabled={checkingUpdate}>
                  <Icon name="refresh" size={15} /> {checkingUpdate ? 'Checking…' : 'Check for updates'}
                </button>
              </SettingsRow>
            </div>
          </div>

          <div className="settings-group">
            <h3>Appearance & behaviour</h3>
            <div className="card">
              <SettingsRow label="Theme">
                <select
                  className="select"
                  value={settings.theme}
                  onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}
                >
                  <option value="system">Match device</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </SettingsRow>
              <SettingsRow label="Running balance" hint="Show the balance after each transaction" compact>
                <input
                  type="checkbox"
                  className="toggle"
                  checked={settings.showRunningBalance}
                  onChange={(e) => set({ showRunningBalance: e.target.checked })}
                />
              </SettingsRow>
              <SettingsRow
                label="Lock reconciled transactions"
                hint="Warn before changing anything already reconciled"
                compact
              >
                <input
                  type="checkbox"
                  className="toggle"
                  checked={settings.lockReconciled}
                  onChange={(e) => set({ lockReconciled: e.target.checked })}
                />
              </SettingsRow>
            </div>
          </div>

          <div className="settings-group">
            <h3>Your data</h3>
            <div className="card">
              <SettingsRow
                label="Back up"
                hint={`${accounts.length} accounts · ${transactions.length} transactions. Everything lives on this device only, so keep a copy somewhere else.`}
                compact
              >
                <button className="btn btn-sm" onClick={doExport}>
                  <Icon name="download" size={15} /> Download
                </button>
              </SettingsRow>
              <SettingsRow label="Restore" hint="Replaces everything currently in ENAB" compact>
                <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={15} /> Choose file
                </button>
              </SettingsRow>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (file) setPendingRestore(await file.text())
                  e.target.value = ''
                }}
              />
              <SettingsRow label="Import transactions" hint="From a CSV your bank exports" compact>
                <button className="btn btn-sm" onClick={() => setImportingCsv(true)}>
                  <Icon name="upload" size={15} /> Import CSV
                </button>
              </SettingsRow>
              <SettingsRow label="Export transactions as CSV" compact>
                <button className="btn btn-sm" onClick={doExportCsv}>
                  <Icon name="download" size={15} /> Export CSV
                </button>
              </SettingsRow>
              <SettingsRow label="Fresh start" hint="Delete everything and begin again" compact>
                <button className="btn btn-sm btn-danger" onClick={() => setConfirmFreshStart(true)}>
                  <Icon name="trash" size={15} /> Fresh start
                </button>
              </SettingsRow>
            </div>
          </div>

          <div className="settings-group">
            <h3>About</h3>
            <div className="card card-pad" style={{ fontSize: 14 }}>
              <p>
                <strong>ENAB</strong> is a zero-based envelope budget. Every dollar you have gets a job before
                you spend it, and overspending is settled month by month rather than swept away.
              </p>
              <p className="dim" style={{ marginBottom: 0 }}>
                All of your data is stored locally in this browser and never leaves your device. Install it to
                your home screen and it works offline.
              </p>
            </div>
          </div>
        </div>
      </div>

      {importingCsv && <CsvImportModal onClose={() => setImportingCsv(false)} />}
      {showInstallGuide && <InstallGuide onClose={() => setShowInstallGuide(false)} />}
      {pendingRestore !== null && (
        <ConfirmDialog
          title="Restore from backup?"
          message="This replaces every account, transaction and budget entry currently in ENAB. Consider downloading a backup first."
          confirmLabel="Restore"
          onConfirm={() => doRestore(pendingRestore)}
          onCancel={() => setPendingRestore(null)}
        />
      )}
      {confirmFreshStart && (
        <ConfirmDialog
          title="Delete everything?"
          message="Every account, transaction, category and budget entry will be permanently removed, and you'll start with a fresh set of categories."
          confirmLabel="Delete everything"
          onConfirm={freshStart}
          onCancel={() => setConfirmFreshStart(false)}
        />
      )}
    </>
  )
}
