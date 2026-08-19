import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { Field } from './Fields'
import { Icon } from './Icon'
import { useData } from '../hooks/useData'
import { toast } from '../state/ui'
import { createTransaction, findOrCreatePayeeId } from '../db/actions'
import { detectDelimiter, guessColumnRoles, normalizeDate, parseCsv, type ColumnRole } from '../lib/csv'
import { parseMoney } from '../lib/money'
import type { Cents, Id } from '../types'

const ROLE_LABELS: Record<ColumnRole, string> = {
  ignore: 'Ignore',
  date: 'Date',
  payee: 'Payee',
  memo: 'Memo',
  amount: 'Amount (signed)',
  outflow: 'Outflow',
  inflow: 'Inflow',
  category: 'Category',
}

interface Draft {
  date: string
  payee: string
  memo: string
  amount: Cents
  categoryName: string
}

export function CsvImportModal({ onClose }: { onClose: () => void }) {
  const { openAccounts, categories, money, format } = useData()
  const [accountId, setAccountId] = useState<Id>(openAccounts[0]?.id ?? '')
  const [text, setText] = useState('')
  const [hasHeader, setHasHeader] = useState(true)
  const [roles, setRoles] = useState<ColumnRole[]>([])
  const [dayFirst, setDayFirst] = useState(false)
  const [importing, setImporting] = useState(false)

  const rows = useMemo(() => (text.trim() ? parseCsv(text, detectDelimiter(text)) : []), [text])
  const header = hasHeader ? (rows[0] ?? []) : rows[0]?.map((_, i) => `Column ${i + 1}`) ?? []
  const bodyRows = hasHeader ? rows.slice(1) : rows

  function loadText(next: string) {
    setText(next)
    const parsed = parseCsv(next, detectDelimiter(next))
    if (parsed[0]) setRoles(guessColumnRoles(parsed[0]))
  }

  const drafts = useMemo<Draft[]>(() => {
    if (bodyRows.length === 0) return []
    const roleIndex = (role: ColumnRole) => roles.indexOf(role)
    const di = roleIndex('date')
    const pi = roleIndex('payee')
    const mi = roleIndex('memo')
    const ai = roleIndex('amount')
    const oi = roleIndex('outflow')
    const ii = roleIndex('inflow')
    const ci = roleIndex('category')

    const out: Draft[] = []
    for (const row of bodyRows) {
      const date = di >= 0 ? normalizeDate(row[di] ?? '', dayFirst) : null
      if (!date) continue

      let amount: Cents | null = null
      if (ai >= 0) {
        amount = parseMoney(row[ai] ?? '', format)
      } else {
        const outflow = oi >= 0 ? (parseMoney(row[oi] ?? '', format) ?? 0) : 0
        const inflow = ii >= 0 ? (parseMoney(row[ii] ?? '', format) ?? 0) : 0
        // Bank exports write outflows as positive numbers in their own column.
        amount = inflow !== 0 ? Math.abs(inflow) : -Math.abs(outflow)
      }
      if (amount === null) continue

      out.push({
        date,
        payee: pi >= 0 ? (row[pi] ?? '').trim() : '',
        memo: mi >= 0 ? (row[mi] ?? '').trim() : '',
        amount,
        categoryName: ci >= 0 ? (row[ci] ?? '').trim() : '',
      })
    }
    return out
  }, [bodyRows, roles, dayFirst, format])

  const skipped = bodyRows.length - drafts.length

  async function runImport() {
    if (!accountId || drafts.length === 0) return
    setImporting(true)
    try {
      const byName = new Map(categories.filter((c) => !c.hidden).map((c) => [c.name.toLowerCase(), c.id]))
      // Exports write the inflow category under several names; accept them all
      // so income doesn't silently land as uncategorised.
      const inflow = categories.find((c) => c.isInflow)
      if (inflow) {
        for (const alias of ['ready to assign', 'inflow: ready to assign', 'income', 'to be budgeted']) {
          if (!byName.has(alias)) byName.set(alias, inflow.id)
        }
      }
      for (const draft of drafts) {
        const payeeId = draft.payee ? await findOrCreatePayeeId(draft.payee) : null
        await createTransaction({
          accountId,
          date: draft.date,
          amount: draft.amount,
          payeeId,
          // Only match categories that already exist; importing never invents them.
          categoryId: byName.get(draft.categoryName.toLowerCase()) ?? null,
          memo: draft.memo,
          cleared: 'cleared',
        })
      }
      toast(`Imported ${drafts.length} transaction${drafts.length === 1 ? '' : 's'}`)
      onClose()
    } catch {
      toast('Import failed — nothing else was changed', { tone: 'danger' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal
      title="Import transactions from CSV"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="dim" style={{ marginRight: 'auto', fontSize: 13 }}>
            {drafts.length} ready{skipped > 0 ? ` · ${skipped} skipped` : ''}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={runImport} disabled={importing || drafts.length === 0 || !accountId}>
            Import {drafts.length || ''}
          </button>
        </>
      }
    >
      <Field label="Import into">
        <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {openAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="CSV file">
        <input
          className="input"
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) loadText(await file.text())
          }}
        />
      </Field>

      <Field label="…or paste the rows">
        <textarea
          className="textarea"
          style={{ fontFamily: 'var(--font-num)', fontSize: 12.5 }}
          placeholder={'Date,Payee,Memo,Outflow,Inflow\n2026-08-01,Grocer,,42.10,'}
          value={text}
          onChange={(e) => loadText(e.target.value)}
        />
      </Field>

      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
            <label className="checkbox">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              First row is a header
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={dayFirst} onChange={(e) => setDayFirst(e.target.checked)} />
              Dates are day/month/year
            </label>
          </div>

          <span className="label" style={{ display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-dim)' }}>
            Match the columns
          </span>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', marginBottom: 16 }}>
            {header.map((h, i) => (
              <div key={i}>
                <div className="truncate faint" style={{ fontSize: 12, marginBottom: 3 }}>
                  {h || `Column ${i + 1}`}
                </div>
                <select
                  className="select"
                  value={roles[i] ?? 'ignore'}
                  onChange={(e) => setRoles(roles.map((r, j) => (i === j ? (e.target.value as ColumnRole) : r)))}
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

          {drafts.length > 0 && (
            <>
              <span className="label" style={{ display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-dim)' }}>
                Preview
              </span>
              <div className="card" style={{ overflow: 'hidden' }}>
                {drafts.slice(0, 5).map((d, i) => (
                  <div className="list-row" key={i}>
                    <span className="faint" style={{ fontFamily: 'var(--font-num)', fontSize: 12.5, width: 88, flex: 'none' }}>
                      {d.date}
                    </span>
                    <span className="grow truncate">{d.payee || 'No payee'}</span>
                    <span className={`num ${d.amount > 0 ? 'pos' : ''}`} style={{ fontFamily: 'var(--font-num)' }}>
                      {money(d.amount)}
                    </span>
                  </div>
                ))}
              </div>
              {drafts.length > 5 && (
                <p className="hint" style={{ marginTop: 6 }}>
                  <Icon name="info" size={13} /> …and {drafts.length - 5} more.
                </p>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  )
}
