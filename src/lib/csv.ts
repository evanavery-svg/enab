/** Minimal RFC 4180 parser — handles quoted fields, embedded commas, CRLF. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // A BOM at the start of a bank export would otherwise poison the first header.
  if (text.charCodeAt(0) === 0xfeff) i = 1

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/** Guess the delimiter from the header line — commas, semicolons, or tabs. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const counts: [string, number][] = [
    [',', (firstLine.match(/,/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

export function toCsv(rows: (string | number)[][]): string {
  const escape = (value: string | number) => {
    const s = String(value ?? '')
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(escape).join(',')).join('\r\n')
}

/**
 * Normalise the many date shapes a bank export can use into `YYYY-MM-DD`.
 * Returns null when the value can't be read as a date at all.
 */
export function normalizeDate(input: string, preferDayFirst = false): string | null {
  const s = input.trim()
  if (!s) return null

  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (iso) {
    const [, y, m, d] = iso
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const parts = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (parts) {
    let [, a, b, y] = parts
    if (y.length === 2) y = `20${y}`
    // Anything above 12 in the first slot can only be a day.
    const dayFirst = preferDayFirst || Number(a) > 12
    const day = dayFirst ? a : b
    const monthPart = dayFirst ? b : a
    return `${y}-${monthPart.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const parsed = new Date(s)
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
  }
  return null
}

export type ColumnRole = 'ignore' | 'date' | 'payee' | 'memo' | 'amount' | 'outflow' | 'inflow' | 'category'

/** Best-effort header matching so the common exports need no manual mapping. */
export function guessColumnRoles(header: string[]): ColumnRole[] {
  return header.map((raw) => {
    const h = raw.trim().toLowerCase()
    if (/(^|\b)(date|posted|transaction date)/.test(h)) return 'date'
    if (/payee|description|name|merchant|details/.test(h)) return 'payee'
    if (/memo|note|reference/.test(h)) return 'memo'
    if (/outflow|debit|withdrawal|paid out|spent/.test(h)) return 'outflow'
    if (/inflow|credit|deposit|paid in|received/.test(h)) return 'inflow'
    if (/amount|value/.test(h)) return 'amount'
    if (/category/.test(h)) return 'category'
    return 'ignore'
  })
}
