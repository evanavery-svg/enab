/**
 * Reading a bank's CSV export without asking the person to understand it.
 *
 * Every bank lays its export out differently, so nothing here assumes a
 * layout. The file itself is read for: where the real header is (some put a
 * summary above it, some have none), which column holds what, whether dates
 * are month- or day-first, whether amounts use a decimal comma, and whether
 * spending is written as negative or — as most credit cards do — positive.
 * Everything detected stays overridable in the import screen.
 */
import { parseCsv } from './csv'
import { guessCategory } from './categorize'
import type { Cents, ISODate, Transaction } from '../types'

export type ColumnRole = 'ignore' | 'date' | 'payee' | 'memo' | 'amount' | 'outflow' | 'inflow' | 'category' | 'direction'

/** Payee wording that only ever describes money arriving. */
const INFLOW_HINT =
  /payroll|salary|paycheck|direct ?dep|dir ?dep|payment.{0,12}thank you|thank you.{0,12}payment|autopay payment|\brefund|interest paid|mobile deposit|\bdeposit\b/i

export interface CsvAnalysis {
  /** Index of the header row within `rows`, or null when the file has none. */
  headerRow: number | null
  /** Every non-empty row of the file. */
  rows: string[][]
  /** The rows holding transactions (everything after the header). */
  body: string[][]
  /** A label per column: the header text, or a sample value when headerless. */
  labels: string[]
  roles: ColumnRole[]
  dayFirst: boolean
  /** False when no date in the file could tell month-first from day-first. */
  dateOrderKnown: boolean
  decimalComma: boolean
  /** True when the file writes purchases as positive numbers. */
  spendingPositive: boolean
}

export interface ImportRow {
  date: ISODate
  amount: Cents
  payee: string
  memo: string
  category: string
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

/**
 * Most exports are UTF-8, but plenty of banks still write Windows-1252, where
 * "Café" would otherwise come through as "CafÃ©" or a replacement character.
 */
export function decodeCsvBytes(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12,
}

function iso(y: number, m: number, d: number): ISODate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, m - 1, d)
  // Rejects impossible dates like 31 February rather than rolling them over.
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

/** The `a/b/y` shape where the order of `a` and `b` is the open question. */
const NUMERIC_DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?![\d])/

/**
 * Read a date in any of the shapes banks use. `dayFirst` only decides the
 * genuinely ambiguous `01/02/2026` form; everything else is unambiguous.
 * Deliberately never falls back to `new Date(string)`, which happily reads
 * "12" or "5.75" as dates.
 */
export function readDate(raw: string, dayFirst: boolean): ISODate | null {
  const s = raw
    .trim()
    .replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '')
  if (!s) return null

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?![\d])/)
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))

  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))

  m = s.match(NUMERIC_DMY)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    const y = fullYear(m[3])
    // A first number above 12 can only be a day, whatever the file's order.
    if (a > 12) return iso(y, b, a)
    if (b > 12) return iso(y, a, b)
    return dayFirst ? iso(y, b, a) : iso(y, a, b)
  }

  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4}|\d{2})\b/)
  if (m && MONTHS[m[2].toLowerCase()]) return iso(fullYear(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]))

  m = s.match(/^([A-Za-z]{3,9})\.?[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s-]+(\d{4}|\d{2})\b/)
  if (m && MONTHS[m[1].toLowerCase()]) return iso(fullYear(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]))

  return null
}

/** What one date says about the file's order, if anything. */
function dateOrderVote(raw: string): 'dmy' | 'mdy' | null {
  const m = raw.trim().match(NUMERIC_DMY)
  if (!m) return null
  if (Number(m[1]) > 12) return 'dmy'
  if (Number(m[2]) > 12) return 'mdy'
  return null
}

const isDate = (raw: string) => readDate(raw, false) !== null

/* ------------------------------------------------------------------ */
/* Amounts                                                             */
/* ------------------------------------------------------------------ */

export interface Amount {
  cents: Cents
  /** The value carried its own CR/DR marker, so no convention may flip it. */
  explicit: boolean
}

/**
 * Read an amount however the bank wrote it: `-5.75`, `$2,400.00`, `(5.75)`,
 * `5.75-`, `15.00 CR`, `USD 5.75`, `2.400,00`, `-5.7500`.
 */
export function readAmount(raw: string, decimalComma: boolean): Amount | null {
  let s = raw.trim()
  if (!s) return null

  let sign = 1
  let explicit = false
  const marker = s.match(/^(cr|dr)\b\.?\s*|\s*\b(cr|dr)\.?$/i)
  if (marker) {
    explicit = true
    if ((marker[1] ?? marker[2]).toLowerCase() === 'dr') sign = -1
    s = s.replace(marker[0], '')
  }

  s = s
    .replace(/^[A-Z]{3}\s*|\s*[A-Z]{3}$/g, '') // ISO currency codes: USD 5.75, 5.75 EUR
    .replace(/[$€£¥₹]/g, '')
    .replace(/[\s ']/g, '') // spaces, no-break spaces and apostrophes group digits

  if (/^\(.*\)$/.test(s)) {
    sign = -sign
    s = s.slice(1, -1)
  }
  if (/^[-−]/.test(s)) {
    sign = -sign
    s = s.slice(1)
  } else if (/-$/.test(s)) {
    sign = -sign
    s = s.slice(0, -1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }
  // A currency symbol can sit either side of the sign: "-$5" and "$-5".
  s = s.replace(/^[$€£¥₹]/, '')

  s = decimalComma ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null

  const cents = Math.round(Number(s) * 100)
  if (!Number.isFinite(cents)) return null
  return { cents: sign * cents || 0, explicit }
}

const isAmount = (raw: string) => readAmount(raw, false) !== null || readAmount(raw, true) !== null

/** Votes for the decimal mark from values whose last separator has two digits after it. */
function detectDecimalComma(cells: string[]): boolean {
  let comma = 0
  let dot = 0
  for (const cell of cells) {
    const m = cell.replace(/[^\d.,]/g, '').match(/([.,])\d{2}$/)
    if (!m) continue
    if (m[1] === ',') comma++
    else dot++
  }
  return comma > dot
}

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

const clean = (h: string) => h.toLowerCase().replace(/[^a-z0-9äöüß/ ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Columns that hold numbers but never the transaction's amount. */
const NOT_AMOUNT = /balance|\bbal\b|running|total|\bfee|card no|card number|account|check|cheque|slip|\bid\b|currency|waehrung|währung/

/** How strongly a header suggests each role. Higher wins; absent means no. */
function headerScores(raw: string): Partial<Record<ColumnRole, number>> {
  const h = clean(raw)
  const out: Partial<Record<ColumnRole, number>> = {}
  if (!h) return out

  if (/\bdate\b|^datum$|^fecha$|buchungstag|buchungsdatum|valutadatum|wertstellung/.test(h)) {
    out.date = /post|posting|clearing|valuta|value|completed|settle|wertstellung/.test(h) ? 2 : 3
  }

  if (h === 'payee') out.payee = 5
  else if (/merchant|counterparty|beguenstigter|begünstigter|empfänger|empfaenger|zahlungspflichtiger|auftraggeber/.test(h)) out.payee = 4
  else if (/\bname\b/.test(h) && !/account|card|member|holder|customer|bank|file/.test(h)) out.payee = 3
  else if (/description|narrative|beschreibung|libell|descripci/.test(h)) out.payee = /original|raw|full/.test(h) ? 1 : 2
  else if (/^(details|transaction details)$/.test(h)) out.payee = 1

  if (h === 'memo') out.memo = 3
  else if (/^notes?\b|verwendungszweck|reference|purpose/.test(h)) out.memo = 2

  if (!NOT_AMOUNT.test(h)) {
    if (/^(amount|transaction amount|betrag|montant|importe|bedrag|belopp|umsatz)\b/.test(h)) out.amount = 3
    else if (/amount|^value$/.test(h) && !/debit|credit/.test(h)) out.amount = 1

    const debit = /^(outflow|debits?|debit amount|withdrawals?|withdrawal amount|paid out|money out|amount debit|spent|charges?|soll)$/.test(h)
    const credit = /^(inflow|credits?|credit amount|deposits?|deposit amount|paid in|money in|amount credit|received|haben)$/.test(h)
    if (debit) out.outflow = 3
    if (credit) out.inflow = 3
  }

  if (/^category( name)?$/.test(h)) out.category = 3
  else if (/category/.test(h) && !/group|split/.test(h)) out.category = 1

  return out
}

const OUT_WORDS = new Set(['debit', 'dr', 'withdrawal', 'debit card'])
const IN_WORDS = new Set(['credit', 'cr', 'deposit'])

/** A column that says which way the money went, for files whose amounts are unsigned. */
function isDirectionColumn(values: string[]): boolean {
  const seen = values.map((v) => v.trim().toLowerCase()).filter(Boolean)
  return seen.length > 0 && seen.every((v) => OUT_WORDS.has(v) || IN_WORDS.has(v))
}

const share = (values: string[], test: (v: string) => boolean) => {
  const filled = values.filter((v) => v.trim())
  return filled.length ? filled.filter(test).length / filled.length : 0
}

function assignRoles(header: string[] | null, body: string[][], width: number): ColumnRole[] {
  const roles: ColumnRole[] = Array(width).fill('ignore')
  const column = (i: number) => body.map((r) => r[i] ?? '')
  const filled = (i: number) => (body.length ? column(i).filter((v) => v.trim()).length / body.length : 0)
  const free = (i: number) => roles[i] === 'ignore'

  // 1. Headers, strongest match per role.
  if (header) {
    const scores = header.map(headerScores)
    for (const role of ['date', 'amount', 'outflow', 'inflow', 'payee', 'category', 'memo'] as ColumnRole[]) {
      let best = -1
      let bestScore = 0
      scores.forEach((s, i) => {
        const score = s[role] ?? 0
        if (score > bestScore && free(i)) {
          best = i
          bestScore = score
        }
      })
      if (best >= 0) roles[best] = role
    }
  }

  // 2. Check the header's guesses against the data, and drop any that lie.
  roles.forEach((role, i) => {
    if (role === 'date' && share(column(i), isDate) < 0.6) roles[i] = 'ignore'
    if ((role === 'amount' || role === 'outflow' || role === 'inflow') && share(column(i), isAmount) < 0.6) {
      roles[i] = 'ignore'
    }
  })
  // A signed amount says everything a debit/credit pair would.
  if (roles.includes('amount')) roles.forEach((r, i) => (r === 'outflow' || r === 'inflow') && (roles[i] = 'ignore'))

  // 3. Fill what's still missing from the contents.
  if (!roles.includes('date')) {
    const i = [...Array(width).keys()].find((c) => free(c) && share(column(c), isDate) >= 0.6)
    if (i !== undefined) roles[i] = 'date'
  }
  if (!roles.some((r) => r === 'amount' || r === 'outflow' || r === 'inflow')) {
    const i = [...Array(width).keys()].find(
      (c) =>
        free(c) &&
        !(header && NOT_AMOUNT.test(clean(header[c] ?? ''))) &&
        filled(c) >= 0.5 &&
        share(column(c), isAmount) >= 0.8 &&
        share(column(c), (v) => /[.,]\d{1,4}\b|[()]|cr|dr/i.test(v)) >= 0.5,
    )
    if (i !== undefined) roles[i] = 'amount'
  }
  if (!roles.includes('payee')) {
    let best = -1
    let bestScore = 0
    for (let c = 0; c < width; c++) {
      if (!free(c)) continue
      const values = column(c).filter((v) => v.trim())
      if (!values.length || share(values, (v) => isAmount(v) || isDate(v)) > 0.3) continue
      const avgLength = values.reduce((n, v) => n + v.length, 0) / values.length
      const distinct = new Set(values).size / values.length
      const score = avgLength * distinct
      if (score > bestScore && avgLength > 2) {
        best = c
        bestScore = score
      }
    }
    if (best >= 0) roles[best] = 'payee'
  }

  // 4. Unsigned amounts with a debit/credit column beside them.
  const amountCol = roles.indexOf('amount')
  if (amountCol >= 0 && !column(amountCol).some((v) => (readAmount(v, false)?.cents ?? 0) < 0)) {
    const i = [...Array(width).keys()].find((c) => free(c) && isDirectionColumn(column(c)))
    if (i !== undefined) roles[i] = 'direction'
  }

  return roles
}

/* ------------------------------------------------------------------ */
/* The whole file                                                      */
/* ------------------------------------------------------------------ */

/** A row that holds a transaction: something that reads as a date and something else as an amount. */
function looksLikeData(row: string[]): boolean {
  const dateAt = row.findIndex(isDate)
  return dateAt >= 0 && row.some((cell, i) => i !== dateAt && /\d/.test(cell) && isAmount(cell))
}

/** Pick the delimiter that splits the most lines into the same number of fields. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30)
  const hint = lines[0]?.match(/^sep=(.)\s*$/i)
  if (hint) return hint[1]

  let best = ','
  let bestScore = 0
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((line) => {
      let n = 0
      let quoted = false
      let fieldStart = true
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') i++
          else if (ch === '"') quoted = false
        } else if (ch === '"' && fieldStart) {
          quoted = true
        } else if (ch === d) {
          n++
          fieldStart = true
          continue
        }
        if (ch !== ' ') fieldStart = false
      }
      return n
    })
    const tally = new Map<number, number>()
    for (const n of counts) if (n > 0) tally.set(n, (tally.get(n) ?? 0) + 1)
    for (const [fields, lineCount] of tally) {
      const score = lineCount * 100 + fields
      if (score > bestScore) {
        best = d
        bestScore = score
      }
    }
  }
  return best
}

export function analyzeCsv(text: string, opts: { preferDayFirst?: boolean } = {}): CsvAnalysis {
  let rows = parseCsv(text, detectDelimiter(text)).map((r) => r.map((c) => c.trim()))
  if (rows[0]?.length === 1 && /^sep=.$/i.test(rows[0][0])) rows = rows.slice(1)

  // The transactions start at the first run of data rows; whatever sits just
  // above them is the header, unless it's data too (a headerless file).
  let start = rows.findIndex((r, i) => looksLikeData(r) && (i + 1 >= rows.length || looksLikeData(rows[i + 1])))
  if (start < 0) start = rows.length > 1 ? 1 : 0
  const headerRow = start > 0 && !looksLikeData(rows[start - 1]) ? start - 1 : null
  const header = headerRow === null ? null : rows[headerRow]
  const body = rows.slice(start)

  const width = Math.max(header?.length ?? 0, ...body.slice(0, 50).map((r) => r.length), 0)
  const roles = assignRoles(header, body, width)

  const labels = [...Array(width).keys()].map((i) => {
    const h = header?.[i]
    if (h) return h
    const sample = body.find((r) => r[i])?.[i] ?? ''
    return sample ? `Column ${i + 1} (${sample.length > 18 ? `${sample.slice(0, 18)}…` : sample})` : `Column ${i + 1}`
  })

  const dateCol = roles.indexOf('date')
  const dates = dateCol >= 0 ? body.map((r) => r[dateCol] ?? '') : []
  const votes = dates.map(dateOrderVote)
  const dmy = votes.includes('dmy')
  const mdy = votes.includes('mdy')
  const dotted = dates.some((d) => /^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(d))
  const dayFirst = dmy && !mdy ? true : mdy ? false : dotted || !!opts.preferDayFirst

  const moneyCells = body.flatMap((r) =>
    roles.flatMap((role, i) => (role === 'amount' || role === 'outflow' || role === 'inflow' ? [r[i] ?? ''] : [])),
  )
  const decimalComma = detectDecimalComma(moneyCells)

  // Which sign is spending? The payees say it best: a paycheck, a deposit or
  // a "payment — thank you" is money coming in, and a known merchant is money
  // going out. Plain counting (most rows in any export are purchases) only
  // breaks the tie — on its own it flipped short files with a few paychecks.
  let spendingPositive = false
  const amountCol = roles.indexOf('amount')
  const payeeCol = roles.indexOf('payee')
  if (amountCol >= 0 && !roles.includes('direction')) {
    let score = 0
    for (const r of body) {
      const a = readAmount(r[amountCol] ?? '', decimalComma)
      if (!a || a.explicit || a.cents === 0) continue
      const sign = a.cents > 0 ? 1 : -1
      const payee = payeeCol >= 0 ? (r[payeeCol] ?? '') : ''
      if (INFLOW_HINT.test(payee)) score -= 3 * sign
      else if (payee && guessCategory(payee, -1).kind === 'spending') score += sign
      else score += 0.5 * sign
    }
    spendingPositive = score > 0
  }

  return {
    headerRow,
    rows,
    body,
    labels,
    roles,
    dayFirst,
    dateOrderKnown: dmy || mdy || dotted,
    decimalComma,
    spendingPositive,
  }
}

/** Turn the body into transactions, using the (possibly hand-adjusted) settings. */
export function readRows(
  body: string[][],
  s: Pick<CsvAnalysis, 'roles' | 'dayFirst' | 'decimalComma' | 'spendingPositive'>,
): { rows: ImportRow[]; skipped: number } {
  const col = (role: ColumnRole) => s.roles.indexOf(role)
  const [di, pi, mi, ai, oi, ii, ci, xi] = (
    ['date', 'payee', 'memo', 'amount', 'outflow', 'inflow', 'category', 'direction'] as ColumnRole[]
  ).map(col)

  const rows: ImportRow[] = []
  let skipped = 0
  for (const r of body) {
    const date = di >= 0 ? readDate(r[di] ?? '', s.dayFirst) : null

    let amount: Cents | null = null
    if (ai >= 0) {
      const a = readAmount(r[ai] ?? '', s.decimalComma)
      if (a) {
        amount = a.cents
        if (xi >= 0) {
          const way = (r[xi] ?? '').trim().toLowerCase()
          amount = IN_WORDS.has(way) ? Math.abs(a.cents) : OUT_WORDS.has(way) ? -Math.abs(a.cents) : a.cents
        } else if (s.spendingPositive && !a.explicit) {
          amount = -a.cents
        }
      }
    } else if (oi >= 0 || ii >= 0) {
      const out = oi >= 0 ? readAmount(r[oi] ?? '', s.decimalComma) : null
      const inn = ii >= 0 ? readAmount(r[ii] ?? '', s.decimalComma) : null
      // Debit and credit columns hold sizes, not signs — some banks write the
      // credit column negative, some the debit column; only the column counts.
      if (inn && inn.cents !== 0) amount = Math.abs(inn.cents)
      else if (out && out.cents !== 0) amount = -Math.abs(out.cents)
    }

    if (!date || amount === null || amount === 0) {
      skipped++
      continue
    }
    rows.push({
      date,
      amount: amount || 0,
      payee: pi >= 0 ? (r[pi] ?? '').replace(/\s+/g, ' ').trim() : '',
      memo: mi >= 0 ? (r[mi] ?? '').replace(/\s+/g, ' ').trim() : '',
      category: ci >= 0 ? (r[ci] ?? '').trim() : '',
    })
  }
  return { rows, skipped }
}

/* ------------------------------------------------------------------ */
/* Duplicates                                                          */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000
const dayNumber = (d: ISODate) => {
  const [y, m, dd] = d.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, dd) / DAY)
}

/**
 * Which rows the account already has: the same amount within three days
 * (banks post a day or two after you typed it in by hand), each existing
 * transaction claimed at most once. That last rule is what keeps two genuine
 * $5 coffees on the same day from being collapsed into one.
 */
export function findDuplicates(rows: ImportRow[], existing: Transaction[]): boolean[] {
  const pool = existing
    .filter((t) => !t.deleted && !t.isStartingBalance)
    .map((t) => ({ amount: t.amount, day: dayNumber(t.date), taken: false }))
  const byAmount = new Map<Cents, typeof pool>()
  for (const p of pool) {
    const list = byAmount.get(p.amount) ?? []
    list.push(p)
    byAmount.set(p.amount, list)
  }
  return rows.map((row) => {
    const day = dayNumber(row.date)
    let best: (typeof pool)[number] | null = null
    for (const p of byAmount.get(row.amount) ?? []) {
      if (p.taken || Math.abs(p.day - day) > 3) continue
      if (!best || Math.abs(p.day - day) < Math.abs(best.day - day)) best = p
    }
    if (best) best.taken = true
    return !!best
  })
}
