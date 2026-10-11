import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { formatMoney, parseMoney, type MoneyFormat } from '../lib/money'
import { useData } from '../hooks/useData'
import type { Cents } from '../types'

/**
 * A labelled form control.
 *
 * The label is associated by `htmlFor` rather than by wrapping the control:
 * a `<label>` that wraps a `<select>` folds every option's text into the
 * field's accessible name, so screen readers announce the whole list as the
 * label. The id is generated and pushed onto the child unless it has one.
 */
export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label?: ReactNode
  hint?: ReactNode
  children: ReactNode
  htmlFor?: string
}) {
  const generated = useId()
  const id = htmlFor ?? generated
  const child =
    isValidElement(children) && !(children.props as { id?: string }).id
      ? cloneElement(children as ReactElement<{ id?: string }>, { id })
      : children

  return (
    <div className="field">
      {label && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      {child}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

/**
 * A settings row: visible text on the left, control on the right.
 *
 * The label is a plain span rather than a `<label>` because the row also
 * carries explanatory text, so the control is pointed at just the title via
 * `aria-labelledby` — the control is never left nameless.
 */
export function SettingsRow({
  label,
  hint,
  children,
  compact,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  /** Let the control size to its content (buttons, checkboxes). */
  compact?: boolean
}) {
  const id = useId()
  // Only nameless form controls borrow the row's title. A button's own text
  // is already its name, and overriding it would make it read wrong.
  const needsName =
    isValidElement(children) &&
    typeof children.type === 'string' &&
    ['input', 'select', 'textarea'].includes(children.type) &&
    !(children.props as { 'aria-label'?: string })['aria-label']
  const child = needsName
    ? cloneElement(children as ReactElement<{ 'aria-labelledby'?: string }>, {
        'aria-labelledby': `${id}-label`,
      })
    : children

  return (
    <div className="settings-row">
      <span className="k">
        <span id={`${id}-label`}>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <span className="ctl" style={compact ? { width: 'auto' } : undefined}>
        {child}
      </span>
    </div>
  )
}

/**
 * Money input that accepts what people actually type: `12.50`, `$1,200`,
 * `(25)`, and arithmetic like `40+12.99`. It keeps the raw text while
 * focused and re-formats on blur, so editing never fights the formatter.
 */
export const AmountInput = forwardRef<
  HTMLInputElement,
  {
    value: Cents
    onChange: (cents: Cents) => void
    format?: MoneyFormat
    placeholder?: string
    className?: string
    id?: string
    autoFocus?: boolean
    selectOnFocus?: boolean
    onEnter?: () => void
    onEscape?: () => void
    /** Show blank instead of a formatted zero. */
    blankZero?: boolean
    disabled?: boolean
    'aria-label'?: string
  }
>(function AmountInput(
  { value, onChange, format, placeholder, className, id, autoFocus, selectOnFocus = true, onEnter, onEscape, blankZero, disabled, ...rest },
  ref,
) {
  const ctx = useData()
  const fmt = format ?? ctx.format
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)

  // While focused the raw text stands so editing isn't fought by the
  // formatter; at rest it reads like every other amount on screen.
  const display = editing
    ? text
    : blankZero && value === 0
      ? ''
      : formatMoney(value, fmt)

  return (
    <input
      {...rest}
      ref={ref}
      id={id}
      disabled={disabled}
      className={`input amount${className ? ` ${className}` : ''}${invalid ? ' invalid' : ''}`}
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      value={display}
      autoFocus={autoFocus}
      onFocus={(e) => {
        const field = e.currentTarget
        setEditing(true)
        // Keep the text exactly as displayed. Swapping to a symbol-less form
        // here changed the field's value under a keystroke that arrived in
        // the same frame, merging the two into something unparseable — and
        // the edit was silently lost. The parser accepts the symbol anyway.
        setText(value === 0 ? '' : formatMoney(value, fmt))
        if (selectOnFocus) requestAnimationFrame(() => field.select())
        // The app shell is pinned to the viewport, so the browser will not
        // scroll the page to lift a field clear of the on-screen keyboard.
        // Nudge the surrounding scroller once the keyboard has animated in.
        if (window.matchMedia('(pointer: coarse)').matches) {
          window.setTimeout(() => field.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
        }
      }}
      onChange={(e) => {
        const next = e.target.value
        setText(next)
        const parsed = next.trim() === '' ? 0 : parseMoney(next, fmt)
        setInvalid(next.trim() !== '' && parsed === null)
        // Commit as they type so totals stay live and Save buttons don't sit
        // disabled next to an amount the user can plainly see.
        if (parsed !== null && parsed !== value) onChange(parsed)
      }}
      onBlur={() => {
        const parsed = text.trim() === '' ? 0 : parseMoney(text, fmt)
        setEditing(false)
        setInvalid(false)
        if (parsed !== null && parsed !== value) onChange(parsed)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const parsed = text.trim() === '' ? 0 : parseMoney(text, fmt)
          if (parsed !== null && parsed !== value) onChange(parsed)
          setEditing(false)
          onEnter?.()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setEditing(false)
          setText('')
          onEscape?.()
          e.currentTarget.blur()
        }
      }}
    />
  )
})

/**
 * A text input with a filtered dropdown of suggestions. Used for payees,
 * where the answer is usually one you've typed before but not always.
 */
export function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  id,
  allowFreeText = true,
  emptyLabel,
}: {
  value: string
  onChange: (value: string, id?: string) => void
  options: { id: string; label: string; group?: string }[]
  placeholder?: string
  id?: string
  allowFreeText?: boolean
  emptyLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => setQuery(value), [value])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 40)
    : options.slice(0, 40)

  const commit = (option?: { id: string; label: string }) => {
    if (option) onChange(option.label, option.id)
    else if (allowFreeText) onChange(query.trim())
    setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        id={id}
        className="input"
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          const next = e.target.value
          setQuery(next)
          setHighlight(0)
          setOpen(true)
          // Commit as they type. Waiting for blur meant that typing a new
          // payee and clicking Save straight away threw the payee away.
          if (allowFreeText && next.trim() !== value) onChange(next.trim())
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHighlight((h) => Math.min(h + 1, filtered.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(0, h - 1))
          } else if (e.key === 'Enter') {
            if (open && filtered[highlight]) {
              e.preventDefault()
              commit(filtered[highlight])
            }
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && (filtered.length > 0 || emptyLabel) && (
        <div
          className="menu"
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 260, overflowY: 'auto', minWidth: 0 }}
        >
          {filtered.length === 0 && <div className="menu-label">{emptyLabel}</div>}
          {filtered.map((o, i) => (
            <button
              key={o.id}
              type="button"
              style={i === highlight ? { background: 'var(--surface-2)' } : undefined}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(o)}
            >
              <span className="truncate">{o.label}</span>
              {o.group && <span className="amount">{o.group}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
