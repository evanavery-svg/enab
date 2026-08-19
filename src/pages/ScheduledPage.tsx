import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { ConfirmDialog } from '../components/Modal'
import { useData } from '../hooks/useData'
import { toast, useUi } from '../state/ui'
import { deleteScheduled, enterScheduled, skipScheduled, updateScheduled } from '../db/actions'
import { FREQUENCY_LABELS, occurrencesBetween } from '../budget/recurrence'
import { addDays, friendlyDate, today } from '../lib/dates'
import type { Id } from '../types'

export default function ScheduledPage() {
  const { scheduled, payeeById, categoryById, accountById, money, settings } = useData()
  const openTxn = useUi((s) => s.openTxnModal)
  const [confirmDelete, setConfirmDelete] = useState<Id | null>(null)

  const rows = useMemo(
    () => [...scheduled].sort((a, b) => a.nextDate.localeCompare(b.nextDate)),
    [scheduled],
  )

  /** What the next 30 days will cost, so surprises are visible in advance. */
  const upcomingTotal = useMemo(() => {
    const horizon = addDays(today(), 30)
    let total = 0
    for (const s of scheduled) {
      if (s.paused) continue
      const hits = occurrencesBetween(s.nextDate, s.frequency, today(), horizon)
      total += hits.length * s.amount
    }
    return total
  }, [scheduled])

  return (
    <>
      <header className="topbar">
        <h1>Scheduled</h1>
        <span className="spacer" />
        <button className="btn btn-sm btn-primary" onClick={() => openTxn()}>
          <Icon name="plus" size={15} /> New
        </button>
      </header>

      <div className="content content-pad">
        <div className="content-narrow">
          {rows.length === 0 ? (
            <div className="card empty">
              <h3>Nothing scheduled</h3>
              <p>
                Add a transaction and pick a repeat frequency — ENAB will enter it for you when the date
                arrives, even if the app was closed.
              </p>
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => openTxn()}>
                <Icon name="plus" size={16} /> Add transaction
              </button>
            </div>
          ) : (
            <>
              <div className="card card-pad" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="calendar" size={18} />
                <span style={{ fontSize: 14 }}>
                  Next 30 days:{' '}
                  <strong className={upcomingTotal < 0 ? 'neg' : 'pos'}>{money(upcomingTotal)}</strong>
                </span>
              </div>

              <div className="card">
                {rows.map((s) => {
                  const payee = s.transferAccountId
                    ? `Transfer : ${accountById.get(s.transferAccountId)?.name ?? '—'}`
                    : s.payeeId
                      ? (payeeById.get(s.payeeId)?.name ?? 'No payee')
                      : 'No payee'
                  const overdue = s.nextDate <= today()
                  return (
                    <div className="list-row" key={s.id}>
                      <div className="grow">
                        <div className="truncate" style={{ fontWeight: 600 }}>
                          {payee}
                          {s.paused && <span className="pill" style={{ marginLeft: 8 }}>Paused</span>}
                        </div>
                        <div className="sub truncate">
                          {FREQUENCY_LABELS[s.frequency]} · next {friendlyDate(s.nextDate, settings.dateFormat)} ·{' '}
                          {accountById.get(s.accountId)?.name ?? '—'}
                          {s.categoryId && ` · ${categoryById.get(s.categoryId)?.name ?? ''}`}
                        </div>
                      </div>
                      <span className={`num ${s.amount > 0 ? 'pos' : ''}`} style={{ fontFamily: 'var(--font-num)', fontWeight: 650 }}>
                        {money(s.amount)}
                      </span>
                      <button
                        className="btn btn-sm"
                        disabled={!overdue}
                        title={overdue ? 'Enter now' : 'Not due yet'}
                        onClick={async () => {
                          await enterScheduled(s.id)
                          toast('Transaction entered')
                        }}
                      >
                        Enter
                      </button>
                      <button
                        className="icon-btn"
                        title={s.paused ? 'Resume' : 'Pause'}
                        onClick={() => updateScheduled(s.id, { paused: !s.paused })}
                      >
                        <Icon name={s.paused ? 'refresh' : 'clock'} size={16} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Skip this one"
                        onClick={async () => {
                          await skipScheduled(s.id)
                          toast('Skipped to the next date')
                        }}
                      >
                        <Icon name="arrowRight" size={16} />
                      </button>
                      <button className="icon-btn" title="Delete" onClick={() => setConfirmDelete(s.id)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this schedule?"
          message="Transactions it already created are kept — only future ones stop."
          onConfirm={async () => {
            await deleteScheduled(confirmDelete)
            toast('Schedule deleted')
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}
