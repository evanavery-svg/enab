import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import { AmountInput, Field } from './Fields'
import { ACCOUNT_TYPE_LABELS, accountClassFor, createAccount, updateAccount } from '../db/actions'
import { today } from '../lib/dates'
import { toast } from '../state/ui'
import type { Account, AccountType, Cents } from '../types'

const TYPE_GROUPS: { label: string; types: AccountType[] }[] = [
  { label: 'Budget', types: ['checking', 'savings', 'cash'] },
  { label: 'Credit', types: ['creditCard', 'lineOfCredit'] },
  { label: 'Loans (tracking)', types: ['mortgage', 'autoLoan', 'studentLoan', 'personalLoan', 'medicalDebt', 'otherDebt'] },
  { label: 'Tracking', types: ['investment', 'asset', 'otherLiability'] },
]

export function AccountFormModal({ account, onClose }: { account?: Account; onClose: () => void }) {
  const editing = !!account
  const navigate = useNavigate()
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking')
  const [balance, setBalance] = useState<Cents>(0)
  const [note, setNote] = useState(account?.note ?? '')
  const [saving, setSaving] = useState(false)

  const cls = accountClassFor(type)
  // Debt accounts hold a negative balance; asking for "how much you owe" and
  // negating it is far less error-prone than asking for a signed number.
  const isDebt = cls === 'credit' || ['mortgage', 'autoLoan', 'studentLoan', 'personalLoan', 'medicalDebt', 'otherDebt', 'otherLiability'].includes(type)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    try {
      if (editing) {
        await updateAccount(account.id, { name: name.trim(), note })
        toast('Account updated')
        onClose()
      } else {
        const id = await createAccount({
          name,
          type,
          startingBalance: isDebt ? -Math.abs(balance) : balance,
          date: today(),
          note,
        })
        toast(`${name.trim()} added`)
        onClose()
        navigate(`/accounts/${id}`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Edit Account' : 'Add Account'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim() || saving}>
            {editing ? 'Save' : 'Create Account'}
          </button>
        </>
      }
    >
      <Field label="Account name">
        <input
          className="input"
          value={name}
          placeholder="e.g. Everyday Checking"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      {!editing && (
        <>
          <Field
            label="Account type"
            hint={
              cls === 'tracking'
                ? 'Tracking accounts sit outside the budget — they count toward net worth only.'
                : cls === 'credit'
                  ? 'Gets its own payment category so the money to pay the bill is budgeted.'
                  : 'On budget: money here is available to assign.'
            }
          >
            <select className="select" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {TYPE_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.types.map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field
            label={isDebt ? "Amount you currently owe" : "Today's balance"}
            hint={isDebt ? 'Enter it as a positive number — ENAB records it as debt.' : undefined}
          >
            <AmountInput value={balance} onChange={setBalance} blankZero placeholder="0.00" />
          </Field>
        </>
      )}

      <Field label="Notes">
        <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}
