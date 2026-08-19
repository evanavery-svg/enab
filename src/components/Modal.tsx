import { useEffect, useRef, type ReactNode } from 'react'
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

export function Modal({ title, onClose, children, footer, wide, headerExtra }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    // Keep the page behind from scrolling under the sheet on iOS.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(
      'input:not([type=hidden]), select, textarea, button',
    )
    first?.focus()
  }, [])

  return createPortal(
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          {headerExtra}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <header className="drawer-head">
          <h2 className="truncate">{title}</h2>
          {headerExtra}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
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
