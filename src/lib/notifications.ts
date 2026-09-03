import { db } from '../db/db'
import { addDays, today } from './dates'
import { formatMoney } from './money'
import type { ScheduledTransaction } from '../types'

const NOTIFIED_KEY = 'enab-notified-schedules'
/** Plenty of history to stop repeats, small enough to stay a cheap localStorage write. */
const NOTIFIED_LIMIT = 200

function getNotified(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

function markNotified(keys: string[]) {
  // Re-adding a key moves it to the newest end, so a bill that keeps recurring
  // is never the one evicted by the cap.
  const fresh = new Set(keys)
  const kept = getNotified().filter((k) => !fresh.has(k))
  const next = [...kept, ...keys].slice(-NOTIFIED_LIMIT)
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(next))
  } catch {
    // A full or blocked localStorage costs us de-duplication, not correctness.
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export function notificationsSupported(): boolean {
  return 'Notification' in window
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}

/**
 * Notify once per scheduled transaction per due date. Safe to call on every
 * foreground — it returns early unless something new is actually due.
 */
export async function checkUpcomingBills(daysBefore = 1): Promise<number> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return 0

  const t = today()
  const horizon = addDays(t, Math.max(0, daysBefore))

  // The index does the filtering, so a long schedule history never gets loaded.
  const due = await db.scheduled.where('nextDate').belowOrEqual(horizon).toArray()
  const schedules = due.filter((s) => !s.deleted && !s.paused)
  if (schedules.length === 0) return 0

  const notified = new Set(getNotified())
  const keyOf = (s: ScheduledTransaction) => `${s.id}:${s.nextDate}`
  const toNotify = schedules.filter((s) => !notified.has(keyOf(s)))
  if (toNotify.length === 0) return 0

  const [payees, settings] = await Promise.all([db.payees.toArray(), db.settings.get('settings')])
  const payeeMap = new Map(payees.map((p) => [p.id, p.name]))

  for (const s of toNotify) {
    const payee = (s.payeeId ? payeeMap.get(s.payeeId) : null) ?? 'Scheduled transaction'
    const amount = formatMoney(Math.abs(s.amount), settings ?? {})
    const overdue = s.nextDate < t
    const when = s.nextDate === t ? 'today' : `on ${s.nextDate}`

    new Notification(overdue ? `Overdue: ${payee}` : `Upcoming: ${payee}`, {
      body: overdue ? `${amount} was due ${when}` : `${amount} due ${when}`,
      icon: './icons/icon-192.png',
      tag: `enab-bill-${s.id}`,
    })
  }

  markNotified(toNotify.map(keyOf))
  return toNotify.length
}
