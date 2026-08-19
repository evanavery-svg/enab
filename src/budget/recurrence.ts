import type { Frequency, ISODate } from '../types'
import { addDays, addMonthsToDate, fromISODate, toISODate } from '../lib/dates'

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  once: 'Never (one time)',
  daily: 'Daily',
  weekly: 'Weekly',
  everyOtherWeek: 'Every other week',
  twiceAMonth: 'Twice a month',
  every4Weeks: 'Every 4 weeks',
  monthly: 'Monthly',
  everyOtherMonth: 'Every other month',
  every3Months: 'Every 3 months',
  every4Months: 'Every 4 months',
  every6Months: 'Every 6 months',
  yearly: 'Yearly',
  everyOtherYear: 'Every other year',
}

export const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as Frequency[]

/**
 * The next date a schedule fires after `date`, or null for one-time entries.
 *
 * "Twice a month" follows the common bill pattern: if the date is on or before
 * the 15th it jumps to 15 days later, otherwise it lands on the same day of
 * the next month.
 */
export function nextOccurrence(date: ISODate, frequency: Frequency): ISODate | null {
  switch (frequency) {
    case 'once':
      return null
    case 'daily':
      return addDays(date, 1)
    case 'weekly':
      return addDays(date, 7)
    case 'everyOtherWeek':
      return addDays(date, 14)
    case 'every4Weeks':
      return addDays(date, 28)
    case 'twiceAMonth': {
      const day = fromISODate(date).getDate()
      if (day <= 15) return addDays(date, 15)
      const d = fromISODate(date)
      d.setDate(1)
      d.setMonth(d.getMonth() + 1)
      const target = day - 15
      d.setDate(target)
      return toISODate(d)
    }
    case 'monthly':
      return addMonthsToDate(date, 1)
    case 'everyOtherMonth':
      return addMonthsToDate(date, 2)
    case 'every3Months':
      return addMonthsToDate(date, 3)
    case 'every4Months':
      return addMonthsToDate(date, 4)
    case 'every6Months':
      return addMonthsToDate(date, 6)
    case 'yearly':
      return addMonthsToDate(date, 12)
    case 'everyOtherYear':
      return addMonthsToDate(date, 24)
    default:
      return null
  }
}

/** Every date a schedule fires between `from` and `to`, inclusive. */
export function occurrencesBetween(
  start: ISODate,
  frequency: Frequency,
  from: ISODate,
  to: ISODate,
  limit = 500,
): ISODate[] {
  const out: ISODate[] = []
  let cursor = start
  let guard = 0
  while (cursor <= to && guard++ < limit) {
    if (cursor >= from) out.push(cursor)
    const next = nextOccurrence(cursor, frequency)
    if (!next) break
    cursor = next
  }
  return out
}
