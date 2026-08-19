import { useState } from 'react'
import { Modal } from './Modal'
import { AmountInput, Field } from './Fields'
import { Icon } from './Icon'
import { useData } from '../hooks/useData'
import { reconcileAccount } from '../db/actions'
import { toast } from '../state/ui'
import { today } from '../lib/dates'
import type { Account } from '../types'

/**
 * Reconciliation in two steps: confirm the balance the bank shows, then let
 * ENAB record any difference as a visible adjustment rather than a silent
 * edit to history.
 */
export function ReconcileModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const { balances, money } = useData()
  const current = balances.get(account.id)
  const clearedBalance = current?.cleared ?? 0

  const [actual, setActual] = useState(clearedBalance)
  const [step, setStep] = useState<'ask' | 'confirm'>('ask')
  const [working, setWorking] = useState(false)

  const difference = actual - clearedBalance

  async function finish() {
    setWorking(true)
    try {
      const result = await reconcileAccount(account.id, actual, today())
      toast(
        result.adjustment === 0
          ? `${account.name} reconciled — ${result.reconciledCount} transactions locked`
          : `Reconciled with a ${money(result.adjustment)} adjustment`,
      )
      onClose()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal
      title={`Reconcile ${account.name}`}
      onClose={onClose}
      footer={
        step === 'ask' ? (
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => setStep('confirm')}>
              Continue
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setStep('ask')}>
              Back
            </button>
            <button className="btn btn-primary" onClick={finish} disabled={working}>
              Finish reconciling
            </button>
          </>
        )
      }
    >
      {step === 'ask' ? (
        <>
          <p className="dim" style={{ fontSize: 14 }}>
            What balance does your bank or statement show right now? ENAB currently has{' '}
            <strong>{money(clearedBalance)}</strong> cleared here.
          </p>
          <Field label="Balance from your bank">
            <AmountInput value={actual} onChange={setActual} autoFocus />
          </Field>
          <p className="hint">
            Before you continue, mark anything that has actually posted as cleared in the register.
          </p>
        </>
      ) : (
        <>
          <div className="detail-amounts">
            <div>
              <div className="k">In ENAB</div>
              <div className="v">{money(clearedBalance)}</div>
            </div>
            <div>
              <div className="k">At the bank</div>
              <div className="v">{money(actual)}</div>
            </div>
            <div>
              <div className="k">Difference</div>
              <div className={`v ${difference === 0 ? 'pos' : 'neg'}`}>{money(difference)}</div>
            </div>
          </div>

          {difference === 0 ? (
            <p style={{ fontSize: 14 }}>
              <Icon name="check" size={16} /> Everything matches. All cleared transactions will be locked
              as reconciled.
            </p>
          ) : (
            <p style={{ fontSize: 14 }}>
              ENAB will add a <strong>{money(difference)}</strong> adjustment transaction so your register
              matches the bank, then lock everything cleared as reconciled.
              {account.onBudget && ' The adjustment lands in Ready to Assign, where you can recategorise it.'}
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
