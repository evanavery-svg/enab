import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Logo } from '../components/Logo'
import { NavMenuButton } from '../components/NavMenuButton'
import { AccountFormModal } from '../components/AccountForm'
import { BringBudgetOver } from '../components/BringBudgetOver'
import { CsvImportModal } from '../components/CsvImportModal'
import { CategorySelect } from '../components/CategorySelect'
import { AmountInput, Field } from '../components/Fields'
import { useData } from '../hooks/useData'
import { toast, useUi } from '../state/ui'
import { createAccount, setPayeeCategory } from '../db/actions'
import type { AccountType, Cents, Id } from '../types'

/**
 * First run. The fastest way to a real budget is the bank's own export: a
 * few months of history, sorted into envelopes, becomes a suggested budget
 * you adjust rather than a blank one you fill in from memory.
 *
 *   welcome → your account + CSV → check the categories → suggested budget
 *
 * The last step is the Auto-Budget page itself, which already does that job.
 */
export function SetupPage() {
  const { accounts } = useData()
  const step = useUi((s) => s.setupStep)
  const setStep = useUi((s) => s.setSetupStep)

  if (step === 'import') return <ImportStep />
  if (step === 'review') return <ReviewStep />
  // Guard: the store can only reach 'none' here with no accounts, i.e. welcome.
  return <Welcome hasAccounts={accounts.length > 0} onStart={() => setStep('import')} />
}

function Welcome({ hasAccounts, onStart }: { hasAccounts: boolean; onStart: () => void }) {
  const [addingAccount, setAddingAccount] = useState(false)
  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <h1>Budget</h1>
      </header>
      <div className="content">
        <div className="onboarding card">
          <Logo size={58} className="onboarding-logo" />
          <h2>Give every dollar a job.</h2>
          <p className="dim" style={{ marginTop: 8 }}>
            ENAB is a zero-based budget: money comes in, you assign all of it to envelopes, and you spend from those.
            The quickest start is the file your bank already has.
          </p>

          <ol className="setup-steps">
            <li>
              <span className="n">1</span>
              <span>Import a few months from your bank's CSV</span>
            </li>
            <li>
              <span className="n">2</span>
              <span>ENAB sorts it into categories and suggests a budget</span>
            </li>
            <li>
              <span className="n">3</span>
              <span>Adjust anything, then assign</span>
            </li>
          </ol>

          <button className="btn btn-primary btn-lg btn-block" onClick={onStart}>
            <Icon name="upload" size={17} /> Start from my bank's CSV
          </button>
          <button className="btn btn-block" style={{ marginTop: 8 }} onClick={() => setAddingAccount(true)}>
            <Icon name="plus" size={16} /> {hasAccounts ? 'Add an account' : 'Add your first account'}
          </button>
          <div className="onboarding-alt">
            <BringBudgetOver />
          </div>
        </div>
      </div>
      {addingAccount && <AccountFormModal onClose={() => setAddingAccount(false)} />}
    </>
  )
}

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'creditCard', label: 'Credit card' },
]

function ImportStep() {
  const setStep = useUi((s) => s.setSetupStep)
  const [name, setName] = useState('Checking')
  const [type, setType] = useState<AccountType>('checking')
  const [balance, setBalance] = useState<Cents>(0)
  const [accountId, setAccountId] = useState<Id | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const isDebt = type === 'creditCard'

  async function chooseFile() {
    setBusy(true)
    try {
      let id = accountId
      if (!id) {
        id = await createAccount({
          name: name.trim() || 'Checking',
          type,
          // A card balance is what you owe; the account holds it as negative.
          startingBalance: isDebt ? -Math.abs(balance) : balance,
        })
        setAccountId(id)
      }
      setImporting(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="topbar">
        <button className="icon-btn" onClick={() => setStep('none')} aria-label="Back">
          <Icon name="chevronLeft" />
        </button>
        <h1>Your account</h1>
      </header>
      <div className="content content-pad">
        <div className="content-narrow">
          <p className="setup-lead">
            Tell ENAB about the account the file comes from, then pick the file. A few months of history is
            plenty; six is ideal.
          </p>
          <div className="card card-pad">
            <Field label="Account name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!!accountId} />
            </Field>
            <div className="row">
              <Field label="Type">
                <select className="select" value={type} onChange={(e) => setType(e.target.value as AccountType)} disabled={!!accountId}>
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={isDebt ? 'Amount you owe today' : "Today's balance"} hint="As your bank shows it right now.">
                <AmountInput value={balance} onChange={setBalance} blankZero placeholder="0.00" disabled={!!accountId} />
              </Field>
            </div>
            <button className="btn btn-primary btn-lg btn-block" onClick={chooseFile} disabled={busy}>
              <Icon name="arrowRight" size={17} /> Next: pick the file
            </button>
            <p className="hint" style={{ marginTop: 10 }}>
              On your bank's website or app, look for <strong>Download</strong> or <strong>Export</strong> on the
              account and choose CSV. Any bank's layout works.
            </p>
          </div>

          <p className="dim" style={{ fontSize: 13.5, marginTop: 16, textAlign: 'center' }}>
            {accountId && `${name.trim() || 'Checking'} is set up. `}
            <button className="btn btn-ghost btn-sm" onClick={() => setStep('none')}>
              {accountId ? 'Skip the file for now' : "Skip — I'll add transactions by hand"}
            </button>
          </p>
        </div>
      </div>

      {importing && accountId && (
        <CsvImportModal
          accountId={accountId}
          onClose={() => setImporting(false)}
          onImported={() => setStep('review')}
        />
      )}
    </>
  )
}

function ReviewStep() {
  const { transactions, payeeById, categoryById, money } = useData()
  const setStep = useUi((s) => s.setSetupStep)
  const navigate = useNavigate()
  const [saving, setSaving] = useState<Id | null>(null)

  // One row per payee: how often, how much, and the category it landed in.
  const rows = useMemo(() => {
    const byPayee = new Map<Id, { count: number; total: Cents; categories: Map<Id | null, number> }>()
    for (const t of transactions) {
      if (!t.payeeId || t.isStartingBalance || t.transferAccountId || t.subtransactions?.length) continue
      let r = byPayee.get(t.payeeId)
      if (!r) byPayee.set(t.payeeId, (r = { count: 0, total: 0, categories: new Map() }))
      r.count++
      r.total += t.amount
      r.categories.set(t.categoryId, (r.categories.get(t.categoryId) ?? 0) + 1)
    }
    return [...byPayee]
      .map(([payeeId, r]) => {
        // The category most of its transactions carry — a payee can straddle two.
        const [categoryId] = [...r.categories].sort((a, b) => b[1] - a[1])[0] ?? [null]
        return { payeeId, name: payeeById.get(payeeId)?.name ?? 'Unknown', count: r.count, total: r.total, categoryId }
      })
      .sort((a, b) => Number(!!a.categoryId) - Number(!!b.categoryId) || Math.abs(b.total) - Math.abs(a.total))
  }, [transactions, payeeById])

  const unsorted = rows.filter((r) => !r.categoryId)
  const unsortedTotal = unsorted.reduce((s, r) => s + Math.min(0, r.total), 0)

  async function change(payeeId: Id, categoryId: Id | null) {
    setSaving(payeeId)
    try {
      const n = await setPayeeCategory(payeeId, categoryId)
      const name = categoryId ? (categoryById.get(categoryId)?.name ?? 'that category') : 'no category'
      toast(`${n} transaction${n === 1 ? '' : 's'} moved to ${name}`)
    } finally {
      setSaving(null)
    }
  }

  function next() {
    setStep('none')
    navigate('/plan')
  }

  return (
    <>
      <header className="topbar">
        <button className="icon-btn" onClick={() => setStep('import')} aria-label="Back">
          <Icon name="chevronLeft" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>Check the categories</h1>
          <div className="subtitle">
            {rows.length - unsorted.length} of {rows.length} payees sorted
          </div>
        </div>
      </header>
      <div className="content content-pad">
        <div className="content-narrow">
          <p className="setup-lead">
            ENAB guessed an envelope for each payee from its name. Fix any that are wrong — the choice applies to
            every transaction from that payee, now and in future imports.
            {unsorted.length > 0 && (
              <>
                {' '}
                <strong>
                  {unsorted.length} {unsorted.length === 1 ? 'needs' : 'need'} your pick
                </strong>{' '}
                ({money(-unsortedTotal)} of spending).
              </>
            )}
          </p>
          <div className="card" style={{ marginBottom: 100 }}>
            {rows.length === 0 ? (
              <p className="dim" style={{ padding: 16 }}>No transactions were imported.</p>
            ) : (
              <ul className="review-list">
                {rows.map((r) => (
                  <li key={r.payeeId} className={`review-row${r.categoryId ? '' : ' needs'}`}>
                    <div className="who">
                      <div className="name truncate">{r.name}</div>
                      <div className="meta">
                        {r.count} transaction{r.count === 1 ? '' : 's'} · {money(r.total)}
                      </div>
                    </div>
                    <CategorySelect
                      value={r.categoryId}
                      onChange={(id) => change(r.payeeId, id)}
                      noneLabel="Pick a category"
                      disabled={saving === r.payeeId}
                      className="review-select"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <div className="bulk-bar">
        <span className="count">{rows.length - unsorted.length} sorted</span>
        <button className="btn btn-primary" onClick={next}>
          Next: suggest my budget <Icon name="arrowRight" size={15} />
        </button>
      </div>
    </>
  )
}
