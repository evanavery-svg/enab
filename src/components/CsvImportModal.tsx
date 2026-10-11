import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { Field } from './Fields'
import { Icon } from './Icon'
import { useData } from '../hooks/useData'
import { toast } from '../state/ui'
import { importTransactions } from '../db/actions'
import { guessCategory } from '../lib/categorize'
import { applyRules } from '../lib/rules'
import {
  analyzeCsv,
  decodeCsvBytes,
  findDuplicates,
  readRows,
  type ColumnRole,
  type CsvAnalysis,
} from '../lib/csvImport'
import { formatDate, friendlyDate } from '../lib/dates'
import type { Id } from '../types'

const ROLE_LABELS: Record<ColumnRole, string> = {
  ignore: 'Ignore',
  date: 'Date',
  payee: 'Payee',
  memo: 'Memo',
  amount: 'Amount',
  outflow: 'Outflow (money out)',
  inflow: 'Inflow (money in)',
  category: 'Category',
  direction: 'Debit / credit',
}

/** Names a file might use for money that should land in Ready to Assign. */
const INFLOW_ALIASES = ['ready to assign', 'inflow: ready to assign', 'income', 'to be budgeted', 'paycheck', 'salary']

const sectionLabel = {
  display: 'block',
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 650,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: 'var(--text-dim)',
} as const

export function CsvImportModal({
  onClose,
  accountId: initialAccountId,
  onImported,
}: {
  onClose: () => void
  accountId?: Id
  /** Called after a successful import, before the modal closes. */
  onImported?: (result: { imported: number; categorized: number }) => void
}) {
  const { openAccounts, categories, transactions, balances, settings, money, payeeRules } = useData()
  const [accountId, setAccountId] = useState<Id>(initialAccountId ?? openAccounts[0]?.id ?? '')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [analysis, setAnalysis] = useState<CsvAnalysis | null>(null)
  // Everything below starts as detected and can be corrected by hand.
  const [roles, setRoles] = useState<ColumnRole[]>([])
  const [dayFirst, setDayFirst] = useState(false)
  const [spendingPositive, setSpendingPositive] = useState(false)
  const [hasHeader, setHasHeader] = useState(true)
  const [keepBalance, setKeepBalance] = useState(true)
  const [showColumns, setShowColumns] = useState(false)
  const [importing, setImporting] = useState(false)

  function load(next: string, name = '') {
    setText(next)
    setFileName(name)
    if (!next.trim()) {
      setAnalysis(null)
      return
    }
    const a = analyzeCsv(next, { preferDayFirst: settings.dateFormat.startsWith('dd') })
    setAnalysis(a)
    setRoles(a.roles)
    setDayFirst(a.dayFirst)
    setSpendingPositive(a.spendingPositive)
    setHasHeader(a.headerRow !== null)
    // Only make someone look at columns when detection came up short.
    setShowColumns(!a.roles.includes('date') || !a.roles.some((r) => r === 'amount' || r === 'outflow' || r === 'inflow'))
  }

  const body = useMemo(() => {
    if (!analysis) return []
    const start = analysis.headerRow ?? -1
    // The header toggle moves the line between header and data, nothing more.
    if (hasHeader) return analysis.headerRow === null ? analysis.body.slice(1) : analysis.body
    return start >= 0 ? analysis.rows.slice(start) : analysis.body
  }, [analysis, hasHeader])

  const { rows, skipped } = useMemo(
    () =>
      analysis
        ? readRows(body, { roles, dayFirst, spendingPositive, decimalComma: analysis.decimalComma })
        : { rows: [], skipped: 0 },
    [analysis, body, roles, dayFirst, spendingPositive],
  )

  const accountTxns = useMemo(() => transactions.filter((t) => t.accountId === accountId), [transactions, accountId])
  const duplicate = useMemo(() => findDuplicates(rows, accountTxns), [rows, accountTxns])
  const fresh = rows.filter((_, i) => !duplicate[i])
  const dupeCount = rows.length - fresh.length

  const opening = accountTxns.find((t) => t.isStartingBalance)
  const predating = opening ? fresh.filter((r) => r.date <= opening.date) : []
  const offerKeepBalance = predating.length > 0
  const currentBalance = balances.get(accountId)?.working ?? 0
  const added = fresh.reduce((sum, r) => sum + r.amount, 0)
  const balanceAfter =
    currentBalance + added - (offerKeepBalance && keepBalance ? predating.reduce((sum, r) => sum + r.amount, 0) : 0)

  const amountCol = roles.indexOf('amount')
  const showSign = amountCol >= 0 && !roles.includes('direction')
  const account = openAccounts.find((a) => a.id === accountId)
  const span = fresh.length
    ? [fresh.reduce((m, r) => (r.date < m ? r.date : m), fresh[0].date), fresh.reduce((m, r) => (r.date > m ? r.date : m), fresh[0].date)]
    : null

  async function runImport() {
    if (!accountId || fresh.length === 0) return
    setImporting(true)
    try {
      const byName = new Map(categories.filter((c) => !c.hidden).map((c) => [c.name.toLowerCase(), c.id]))
      const inflow = categories.find((c) => c.isInflow)
      if (inflow) for (const alias of INFLOW_ALIASES) if (!byName.has(alias)) byName.set(alias, inflow.id)

      const result = await importTransactions(
        accountId,
        fresh.map((r) => {
          // A guess from the merchant name fills in behind anything better:
          // the file's own category, or what this payee got last time.
          const guess = guessCategory(r.payee, r.amount)
          const guessedCategoryId =
            guess.kind === 'income' ? (inflow?.id ?? null) : guess.name ? (byName.get(guess.name.toLowerCase()) ?? null) : null
          return {
            date: r.date,
            amount: r.amount,
            payee: r.payee,
            memo: r.memo,
            // Only names that already exist match; importing never invents categories.
            categoryId: r.category ? (byName.get(r.category.toLowerCase()) ?? null) : null,
            guessedCategoryId,
          }
        }),
        { keepBalance: offerKeepBalance && keepBalance },
      )
      const parts = [`Imported ${result.imported} transaction${result.imported === 1 ? '' : 's'}`]
      if (result.categorized) parts.push(`${result.categorized} sorted into categories`)
      if (result.tidied) parts.push(`${result.tidied} tidied by your rules`)
      if (dupeCount) parts.push(`${dupeCount} duplicate${dupeCount === 1 ? '' : 's'} skipped`)
      toast(parts.join(' · '))
      onImported?.(result)
      onClose()
    } catch {
      toast('Import failed — nothing was changed', { tone: 'danger' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal
      title="Import transactions"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={runImport}
            disabled={importing || fresh.length === 0 || !accountId}
          >
            {importing
              ? 'Importing…'
              : rows.length > 0 && fresh.length === 0
                ? 'Nothing new'
                : `Import ${fresh.length || ''}`}
          </button>
        </>
      }
    >
      {openAccounts.length === 0 ? (
        <p className="dim">Add the account these transactions belong to first, then import into it.</p>
      ) : (
        <Field label="Import into">
          <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {openAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="CSV file from your bank" hint={fileName ? undefined : 'Download it from your bank’s website or app — any bank’s layout works.'}>
        <input
          className="input"
          type="file"
          accept=".csv,text/csv,text/plain,.txt"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) load(decodeCsvBytes(await file.arrayBuffer()), file.name)
          }}
        />
      </Field>

      <details style={{ marginBottom: 14 }}>
        <summary className="dim" style={{ cursor: 'pointer', fontSize: 13.5, marginBottom: 8 }}>
          Or paste the rows instead
        </summary>
        <Field label="…or paste the rows">
          <textarea
            className="textarea"
            style={{ fontFamily: 'var(--font-num)' }}
            placeholder={'Date,Description,Amount\n10/02/2026,Grocer,-42.10'}
            value={fileName ? '' : text}
            onChange={(e) => load(e.target.value)}
          />
        </Field>
      </details>

      {analysis && (
        <>
          <div className="card card-pad" style={{ marginBottom: 14, fontSize: 14, display: 'grid', gap: 8 }}>
            {rows.length === 0 ? (
              <div>
                <strong>No transactions found yet.</strong>{' '}
                <span className="dim">
                  {!roles.includes('date')
                    ? 'Pick which column holds the date below.'
                    : 'Pick which column holds the amount below.'}
                </span>
              </div>
            ) : (
              <div>
                <strong>
                  {rows.length} transaction{rows.length === 1 ? '' : 's'}
                </strong>
                {span && (
                  <span className="dim">
                    {' '}
                    from {friendlyDate(span[0], settings.dateFormat)} to {friendlyDate(span[1], settings.dateFormat)}
                  </span>
                )}
                {dupeCount > 0 && (
                  <div className="dim" style={{ marginTop: 4 }}>
                    {dupeCount === rows.length ? 'All of them are' : `${dupeCount} of them are`} already in {account?.name ?? 'this account'} and
                    will be skipped.
                  </div>
                )}
                {skipped > 0 && (
                  <div className="dim" style={{ marginTop: 4 }}>
                    {skipped} line{skipped === 1 ? '' : 's'} without a date or amount (like totals or an opening-balance line)
                    left out.
                  </div>
                )}
              </div>
            )}

            {showSign && rows.length > 0 && (
              <div>
                <div className="dim" style={{ fontSize: 12.5, marginBottom: 5 }}>
                  In this file, purchases are written as
                </div>
                <div className="segmented" style={{ maxWidth: 360 }}>
                  <button aria-pressed={!spendingPositive} onClick={() => setSpendingPositive(false)}>
                    Negative (−5.00)
                  </button>
                  <button aria-pressed={spendingPositive} onClick={() => setSpendingPositive(true)}>
                    Positive (5.00)
                  </button>
                </div>
              </div>
            )}

            {(!analysis.dateOrderKnown || dayFirst !== analysis.dayFirst) && rows.length > 0 && (
              <label className="checkbox">
                <input type="checkbox" checked={dayFirst} onChange={(e) => setDayFirst(e.target.checked)} />
                Dates are day/month/year (e.g. 02/10 is 2 October)
              </label>
            )}

            {offerKeepBalance && (
              <label className="checkbox" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" checked={keepBalance} onChange={(e) => setKeepBalance(e.target.checked)} />
                <span>
                  Keep {account?.name}’s balance at {money(currentBalance)}
                  <span className="dim" style={{ display: 'block', fontSize: 12.5 }}>
                    {predating.length} of these are from before you added the account, so they’re already part of the
                    balance you entered.
                  </span>
                </span>
              </label>
            )}

            {fresh.length > 0 && (
              <div className="dim" style={{ fontSize: 13 }}>
                {account?.name} balance after import: <strong style={{ color: 'var(--text)' }}>{money(balanceAfter)}</strong>
              </div>
            )}
          </div>

          {rows.length > 0 && (
            <>
              <span style={sectionLabel}>Preview</span>
              <div className="card" style={{ overflow: 'hidden', marginBottom: 6 }}>
                {rows.slice(0, 6).map((r, i) => (
                  <div className="list-row" key={i} style={duplicate[i] ? { opacity: 0.45 } : undefined}>
                    <span className="faint" style={{ fontFamily: 'var(--font-num)', fontSize: 12.5, width: 88, flex: 'none' }}>
                      {formatDate(r.date, settings.dateFormat)}
                    </span>
                    <span className="grow truncate" style={duplicate[i] ? { textDecoration: 'line-through' } : undefined}>
                      {(() => {
                        const ruled = r.payee ? applyRules(payeeRules, r.payee) : null
                        return ruled?.rule ? (
                          <>
                            {ruled.payee} <span className="rule-tag" title={`Bank name: ${r.payee}`}>rule</span>
                          </>
                        ) : (
                          r.payee || 'No payee'
                        )
                      })()}
                    </span>
                    <span className={`num ${r.amount > 0 ? 'pos' : ''}`} style={{ fontFamily: 'var(--font-num)' }}>
                      {money(r.amount, { forceSign: r.amount > 0 })}
                    </span>
                  </div>
                ))}
              </div>
              {rows.length > 6 && (
                <p className="hint" style={{ marginBottom: 14 }}>
                  <Icon name="info" size={13} /> …and {rows.length - 6} more.
                </p>
              )}
            </>
          )}

          <details open={showColumns} onToggle={(e) => setShowColumns((e.target as HTMLDetailsElement).open)}>
            <summary className="dim" style={{ cursor: 'pointer', fontSize: 13.5, marginBottom: 8 }}>
              Columns {showColumns ? '' : '(detected automatically — change if something looks wrong)'}
            </summary>
            <label className="checkbox" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              The file has a header row
            </label>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
              {analysis.labels.map((label, i) => (
                <div key={i}>
                  <div className="truncate faint" style={{ fontSize: 12, marginBottom: 3 }} title={label}>
                    {label}
                  </div>
                  <select
                    className="select"
                    value={roles[i] ?? 'ignore'}
                    onChange={(e) => {
                      const role = e.target.value as ColumnRole
                      // One column per role: choosing it here frees it elsewhere.
                      setRoles(analysis.labels.map((_, j) => (j === i ? role : roles[j] === role && role !== 'ignore' ? 'ignore' : (roles[j] ?? 'ignore'))))
                    }}
                  >
                    {(Object.keys(ROLE_LABELS) as ColumnRole[]).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </Modal>
  )
}
