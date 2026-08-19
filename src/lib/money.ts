import type { Cents, Settings } from '../types'

export const DEFAULT_FORMAT: Pick<
  Settings,
  'currencySymbol' | 'currencyCode' | 'symbolPosition' | 'decimalSeparator' | 'groupSeparator' | 'hideDecimals'
> = {
  currencySymbol: '$',
  currencyCode: 'USD',
  symbolPosition: 'before',
  decimalSeparator: '.',
  groupSeparator: ',',
  hideDecimals: false,
}

export type MoneyFormat = typeof DEFAULT_FORMAT

/** Format cents for display, e.g. `-1234` -> `-$12.34`. */
export function formatMoney(
  cents: Cents,
  fmt: Partial<MoneyFormat> = {},
  opts: { showZero?: boolean; forceSign?: boolean; noSymbol?: boolean } = {},
): string {
  const f = { ...DEFAULT_FORMAT, ...fmt }
  if (cents === 0 && opts.showZero === false) return ''

  const negative = cents < 0
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100

  let intPart = String(whole)
  if (f.groupSeparator) {
    intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, f.groupSeparator)
  }

  // Hiding decimals is a display choice only; a non-zero remainder still shows
  // so the user is never told $10 when they have $10.40.
  const showFrac = !f.hideDecimals || frac !== 0
  const body = showFrac ? `${intPart}${f.decimalSeparator}${String(frac).padStart(2, '0')}` : intPart

  const withSymbol = opts.noSymbol
    ? body
    : f.symbolPosition === 'before'
      ? `${f.currencySymbol}${body}`
      : `${body} ${f.currencySymbol}`

  if (negative) return `-${withSymbol}`
  if (opts.forceSign) return `+${withSymbol}`
  return withSymbol
}

/** Compact form for charts and tight spaces: `$1.2k`, `$3.4M`. */
export function formatCompact(cents: Cents, fmt: Partial<MoneyFormat> = {}): string {
  const f = { ...DEFAULT_FORMAT, ...fmt }
  const abs = Math.abs(cents) / 100
  const sign = cents < 0 ? '-' : ''
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ]
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const v = abs / size
      const s = v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')
      return `${sign}${f.currencySymbol}${s}${suffix}`
    }
  }
  return `${sign}${f.currencySymbol}${abs.toFixed(abs % 1 === 0 ? 0 : 2)}`
}

/**
 * Parse an amount the way a budgeting app should: tolerate currency symbols,
 * thousands separators, parentheses for negatives, and arithmetic expressions
 * like `12.50+3*2` typed straight into the amount field.
 *
 * Returns null when the input isn't a valid amount.
 */
export function parseMoney(input: string, fmt: Partial<MoneyFormat> = {}): Cents | null {
  const f = { ...DEFAULT_FORMAT, ...fmt }
  let s = String(input).trim()
  if (!s) return null

  // (12.34) is accountant-speak for -12.34, but only when it wraps everything.
  let parenNegative = false
  if (/^\(.*\)$/.test(s) && !s.slice(1, -1).includes('(')) {
    parenNegative = true
    s = s.slice(1, -1)
  }

  s = s.split(f.currencySymbol).join('')
  if (f.groupSeparator) s = s.split(f.groupSeparator).join('')
  if (f.decimalSeparator !== '.') s = s.split(f.decimalSeparator).join('.')
  s = s.replace(/\s/g, '')
  if (!s) return null

  // Only digits and arithmetic survive; anything else is a typo, not an amount.
  if (!/^[-+*/().\d]+$/.test(s)) return null

  let value: number
  if (/[-+*/()]/.test(s.slice(1))) {
    value = evaluateExpression(s)
  } else {
    value = Number(s)
  }
  if (!Number.isFinite(value)) return null

  const cents = Math.round(value * 100)
  return parenNegative ? -Math.abs(cents) : cents
}

/**
 * A tiny recursive-descent evaluator for `+ - * / ( )`.
 * Deliberately hand-written: no `eval`, no `new Function`.
 */
export function evaluateExpression(src: string): number {
  let i = 0
  const peek = () => src[i]

  function parseExpr(): number {
    let left = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = src[i++]
      const right = parseTerm()
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  function parseTerm(): number {
    let left = parseFactor()
    while (peek() === '*' || peek() === '/') {
      const op = src[i++]
      const right = parseFactor()
      left = op === '*' ? left * right : right === 0 ? NaN : left / right
    }
    return left
  }

  function parseFactor(): number {
    if (peek() === '+') {
      i++
      return parseFactor()
    }
    if (peek() === '-') {
      i++
      return -parseFactor()
    }
    if (peek() === '(') {
      i++
      const v = parseExpr()
      if (peek() === ')') i++
      return v
    }
    const start = i
    while (i < src.length && /[\d.]/.test(src[i])) i++
    if (i === start) return NaN
    return Number(src.slice(start, i))
  }

  const result = parseExpr()
  return i === src.length ? result : NaN
}

/** Split `total` into `parts` whole cents, distributing the remainder. */
export function splitEvenly(total: Cents, parts: number): Cents[] {
  if (parts <= 0) return []
  const base = Math.trunc(total / parts)
  let remainder = total - base * parts
  const step = remainder >= 0 ? 1 : -1
  return Array.from({ length: parts }, () => {
    let v = base
    if (remainder !== 0) {
      v += step
      remainder -= step
    }
    return v
  })
}

export const clampPositive = (n: Cents): Cents => (n > 0 ? n : 0)
