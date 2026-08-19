import { describe, expect, it } from 'vitest'
import { nextOccurrence, occurrencesBetween } from '../recurrence'

describe('nextOccurrence', () => {
  it('steps by days and weeks', () => {
    expect(nextOccurrence('2026-01-01', 'daily')).toBe('2026-01-02')
    expect(nextOccurrence('2026-01-01', 'weekly')).toBe('2026-01-08')
    expect(nextOccurrence('2026-01-01', 'everyOtherWeek')).toBe('2026-01-15')
    expect(nextOccurrence('2026-01-01', 'every4Weeks')).toBe('2026-01-29')
  })

  it('keeps the day of month when stepping months', () => {
    expect(nextOccurrence('2026-01-15', 'monthly')).toBe('2026-02-15')
    expect(nextOccurrence('2026-01-15', 'every3Months')).toBe('2026-04-15')
    expect(nextOccurrence('2026-01-15', 'yearly')).toBe('2027-01-15')
  })

  it('clamps to the end of a shorter month', () => {
    expect(nextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(nextOccurrence('2028-01-31', 'monthly')).toBe('2028-02-29')
  })

  it('splits a twice-monthly bill across the month', () => {
    expect(nextOccurrence('2026-01-01', 'twiceAMonth')).toBe('2026-01-16')
    expect(nextOccurrence('2026-01-16', 'twiceAMonth')).toBe('2026-02-01')
  })

  it('has no next date for a one-off', () => {
    expect(nextOccurrence('2026-01-01', 'once')).toBeNull()
  })
})

describe('occurrencesBetween', () => {
  it('lists the dates inside a window', () => {
    expect(occurrencesBetween('2026-01-01', 'weekly', '2026-01-01', '2026-01-31')).toEqual([
      '2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22', '2026-01-29',
    ])
  })

  it('skips occurrences before the window opens', () => {
    expect(occurrencesBetween('2026-01-01', 'monthly', '2026-03-01', '2026-05-31')).toEqual([
      '2026-03-01', '2026-04-01', '2026-05-01',
    ])
  })

  it('returns a single date for a one-off in range', () => {
    expect(occurrencesBetween('2026-02-10', 'once', '2026-01-01', '2026-12-31')).toEqual(['2026-02-10'])
  })
})
