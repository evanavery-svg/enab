import { describe, expect, it } from 'vitest'
import { compareIso, daysBetween } from '../dates'

describe('daysBetween', () => {
  it('counts whole days, either direction', () => {
    expect(daysBetween('2026-10-01', '2026-10-11')).toBe(10)
    expect(daysBetween('2026-10-11', '2026-10-01')).toBe(-10)
    expect(daysBetween('2026-10-11', '2026-10-11')).toBe(0)
  })

  it('crosses month, year and leap-day boundaries', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1)
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetween('2025-10-11', '2026-10-11')).toBe(365)
  })

  it('is not thrown off by daylight saving changes', () => {
    // US clocks change on these dates; a local-time difference is 23 or 25 hours.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
  })
})

describe('compareIso', () => {
  it('orders dates and timestamps like a sort should', () => {
    const dates = ['2026-10-11', '2025-01-02', '2026-01-31', '2026-01-31']
    expect([...dates].sort(compareIso)).toEqual(['2025-01-02', '2026-01-31', '2026-01-31', '2026-10-11'])
    expect(compareIso('2026-10-11T08:00:00.000Z', '2026-10-11T09:00:00.000Z')).toBe(-1)
    expect(compareIso('x', 'x')).toBe(0)
  })
})
