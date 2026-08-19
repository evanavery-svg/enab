import { describe, expect, it } from 'vitest'
import { formatMoney, parseMoney, splitEvenly } from '../money'

describe('formatMoney', () => {
  it('formats cents with a symbol and grouping', () => {
    expect(formatMoney(123_456)).toBe('$1,234.56')
    expect(formatMoney(-500)).toBe('-$5.00')
    expect(formatMoney(0)).toBe('$0.00')
  })

  it('honours European conventions', () => {
    expect(
      formatMoney(123_456, { currencySymbol: '€', symbolPosition: 'after', decimalSeparator: ',', groupSeparator: '.' }),
    ).toBe('1.234,56 €')
  })

  it('still shows a non-zero remainder when decimals are hidden', () => {
    expect(formatMoney(1_040, { hideDecimals: true })).toBe('$10.40')
    expect(formatMoney(1_000, { hideDecimals: true })).toBe('$10')
  })
})

describe('parseMoney', () => {
  it('reads plain amounts', () => {
    expect(parseMoney('12.34')).toBe(1_234)
    expect(parseMoney('$1,234.56')).toBe(123_456)
    expect(parseMoney('7')).toBe(700)
  })

  it('reads parentheses as negative', () => {
    expect(parseMoney('(25.00)')).toBe(-2_500)
  })

  it('evaluates arithmetic typed into the amount box', () => {
    expect(parseMoney('12.50+3')).toBe(1_550)
    expect(parseMoney('20*3')).toBe(6_000)
    expect(parseMoney('100/4')).toBe(2_500)
    expect(parseMoney('10+2*3')).toBe(1_600)
    expect(parseMoney('(10+2)*3')).toBe(3_600)
  })

  it('rejects nonsense', () => {
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('12..34')).toBeNull()
  })
})

describe('splitEvenly', () => {
  it('distributes remainder cents without losing any', () => {
    const parts = splitEvenly(1_000, 3)
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_000)
    expect(parts).toEqual([334, 333, 333])
  })

  it('works for negative totals', () => {
    const parts = splitEvenly(-1_000, 3)
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-1_000)
  })
})
