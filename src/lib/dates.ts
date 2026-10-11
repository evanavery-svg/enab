import type { ISODate, MonthKey, Settings } from '../types'

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3))
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Local-time `YYYY-MM-DD` for a Date (never UTC — budgets are lived locally). */
export function toISODate(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse `YYYY-MM-DD` into a local-midnight Date. */
export function fromISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export const today = (): ISODate => toISODate(new Date())

export const monthOf = (date: ISODate): MonthKey => date.slice(0, 7)

export const currentMonth = (): MonthKey => monthOf(today())

/** First day of a month key. */
export const monthStart = (month: MonthKey): ISODate => `${month}-01`

/** Last day of a month key. */
export function monthEnd(month: MonthKey): ISODate {
  const [y, m] = month.split('-').map(Number)
  return toISODate(new Date(y, m, 0))
}

export function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = total % 12
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}`
}

/** Signed count of months from `a` to `b`. */
export function monthDiff(a: MonthKey, b: MonthKey): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

/** Inclusive list of month keys from `from` to `to`. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = []
  const n = monthDiff(from, to)
  for (let i = 0; i <= n; i++) out.push(addMonths(from, i))
  return out
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = fromISODate(date)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** Add months to a date, clamping the day to the end of the target month. */
export function addMonthsToDate(date: ISODate, months: number): ISODate {
  const d = fromISODate(date)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return toISODate(d)
}

/** Whole days since the epoch for a `YYYY-MM-DD` date. UTC, so DST never shifts it. */
function dayNumber(date: ISODate): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000
}

/**
 * Days from `a` to `b`. Runs over whole histories (recurring-charge detection,
 * age of money), so it does plain arithmetic instead of building Dates.
 */
export function daysBetween(a: ISODate, b: ISODate): number {
  return dayNumber(b) - dayNumber(a)
}

/**
 * Order ISO dates and timestamps. They sort correctly as plain strings, and a
 * plain comparison is many times faster than `localeCompare`, which runs full
 * locale collation on every call.
 */
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function monthLabel(month: MonthKey, opts: { short?: boolean; withYear?: boolean } = {}): string {
  const [y, m] = month.split('-').map(Number)
  const name = (opts.short ? MONTH_SHORT : MONTH_NAMES)[m - 1] ?? month
  const showYear = opts.withYear ?? true
  return showYear ? `${name} ${y}` : name
}

export function formatDate(date: ISODate, format: Settings['dateFormat'] = 'MM/dd/yyyy'): string {
  const [y, m, d] = date.split('-')
  switch (format) {
    case 'dd/MM/yyyy':
      return `${d}/${m}/${y}`
    case 'yyyy-MM-dd':
      return `${y}-${m}-${d}`
    case 'dd.MM.yyyy':
      return `${d}.${m}.${y}`
    default:
      return `${m}/${d}/${y}`
  }
}

/** "Today", "Yesterday", "Aug 4" — for register rows and upcoming lists. */
export function friendlyDate(date: ISODate, format: Settings['dateFormat'] = 'MM/dd/yyyy'): string {
  const t = today()
  if (date === t) return 'Today'
  if (date === addDays(t, -1)) return 'Yesterday'
  if (date === addDays(t, 1)) return 'Tomorrow'
  const d = fromISODate(date)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  if (sameYear) return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
  return formatDate(date, format)
}

/** Number of times `dayOfWeek` (0=Sun) occurs in the given month. */
export function weekdayOccurrencesInMonth(month: MonthKey, dayOfWeek: number): number {
  const [y, m] = month.split('-').map(Number)
  const total = daysInMonth(month)
  let count = 0
  for (let day = 1; day <= total; day++) {
    if (new Date(y, m - 1, day).getDay() === dayOfWeek) count++
  }
  return count
}
