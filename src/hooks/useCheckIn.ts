import { useMemo } from 'react'
import { useData } from './useData'
import { buildCheckIn, type CheckIn } from '../lib/today'
import { today } from '../lib/dates'

/** Today's check-in, recomputed only when the data it reads changes. */
export function useCheckIn(): CheckIn {
  const { budget, accounts, categories, payees, transactions, scheduled, subscriptions } = useData()
  const day = today()
  return useMemo(
    () => buildCheckIn({ today: day, budget, accounts, categories, payees, transactions, scheduled, subscriptions }),
    [day, budget, accounts, categories, payees, transactions, scheduled, subscriptions],
  )
}
