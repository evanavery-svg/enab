import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** Rendered to the left of the close button in the header. */
  headerExtra?: ReactNode
}

/** Matches the exit animations in components.css and layout.css. */
const EXIT_MS = 170

/**
 * Close with a short exit animation instead of vanishing. `onClose` still
 * runs, just once the sheet has slid away. Reduced-motion users get it at once.
 */
function useDismiss(onClose: () => void) {
  const latest = useRef(onClose)
  latest.current = onClose
  const [closing, setClosing] = useState(false)
  const timer = useRef<number>()
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const dismiss = useCallback(() => {
    if (timer.current !== undefined) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      latest.current()
      return
    }
    setClosing(true)
    timer.current = window.setTimeout(() => latest.current(), EXIT_MS)
  }, [])
  return { closing, dismiss }
}

/**
 * Hold the page still while a sheet is open, and listen for Escape. Runs once
 * per sheet: re-applying the lock on every render (every keystroke in a
 * field) restyled the whole document each time.
 */
function useSheetEffects(dismiss: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        dismiss()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [dismiss])
}

export function Modal({ title, onClose, children, footer, wide, headerExtra }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { closing, dismiss } = useDismiss(onClose)
  useSheetEffects(dismiss)

  useEffect(() => {
    // Send focus to the first field so typing starts where it should. With no
    // fields, focus the dialog itself rather than the close button — landing
    // on the X makes dismissing look like the intended action.
    const field = ref.current?.querySelector<HTMLElement>(
      'input:not([type=hidden]), select, textarea',
    )
    if (field) field.focus()
    else ref.current?.focus()
  }, [])

  return createPortal(
    <div
      className={`scrim${closing ? ' closing' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss()
      }}
    >
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={ref}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          {headerExtra}
          <button className="icon-btn" onClick={dismiss} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

interface DrawerProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  headerExtra?: ReactNode
}

export function Drawer({ title, onClose, children, footer, headerExtra }: DrawerProps) {
  const { closing, dismiss } = useDismiss(onClose)
  useSheetEffects(dismiss)

  return createPortal(
    <>
      <div className={`drawer-scrim${closing ? ' closing' : ''}`} onClick={dismiss} />
      <aside className={`drawer${closing ? ' closing' : ''}`} role="dialog" aria-modal="true">
        <header className="drawer-head">
          <h2 className="truncate">{title}</h2>
          {headerExtra}
          <button className="icon-btn" onClick={dismiss} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </>,
    document.body,
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  destructive = true,
  onConfirm,
  onCancel,
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className={destructive ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 14.5 }}>{message}</div>
    </Modal>
  )
}
