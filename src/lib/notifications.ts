import { db } from '../db/db'
import type { ScheduledTransaction } from '../types'

const NOTIFIED_KEY = 'enab-notified-schedules'

function getNotified(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

function markNotified(keys: string[]) {
  const set = getNotified()
  for (const k of keys) set.add(k)
  // Keep only the most recent 200 entries to avoid unbounded growth.
  const arr = [...set]
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(arr.slice(-200)))
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
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

export async function checkUpcomingBills(daysBefore = 1): Promise<number> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return 0

  const t = todayStr()
  const horizon = addDays(t, daysBefore)
  const schedules = (await db.scheduled.toArray()).filter(
    (s) => !s.deleted && !s.paused && s.nextDate <= horizon,
  )

  if (schedules.length === 0) return 0

  const notified = getNotified()
  const toNotify: ScheduledTransaction[] = []

  for (const s of schedules) {
    const key = `${s.id}:${s.nextDate}`
    if (notified.has(key)) continue
    toNotify.push(s)
  }

  if (toNotify.length === 0) return 0

  const payees = await db.payees.toArray()
  const payeeMap = new Map(payees.map((p) => [p.id, p.name]))

  for (const s of toNotify) {
    const payee = s.payeeId ? payeeMap.get(s.payeeId) ?? 'Unknown' : 'Scheduled transaction'
    const amount = Math.abs(s.amount / 100).toFixed(2)
    const isOverdue = s.nextDate <= t
    const title = isOverdue ? `Overdue: ${payee}` : `Upcoming: ${payee}`
    const body = isOverdue
      ? `$${amount} was due on ${s.nextDate}`
      : `$${amount} due on ${s.nextDate}`

    new Notification(title, {
      body,
      icon: './icons/icon-192.png',
      tag: `enab-bill-${s.id}`,
    })
  }

  markNotified(toNotify.map((s) => `${s.id}:${s.nextDate}`))
  return toNotify.length
}
