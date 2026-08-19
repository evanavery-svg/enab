import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A popover anchored to `anchor`, flipped and nudged so it always lands
 * inside the viewport — which matters most on a phone.
 */
export function Popover({
  anchor,
  onClose,
  children,
  align = 'start',
  width,
}: {
  anchor: HTMLElement | null
  onClose: () => void
  children: ReactNode
  align?: 'start' | 'end'
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return
    const a = anchor.getBoundingClientRect()
    const el = ref.current.getBoundingClientRect()
    const margin = 8

    let top = a.bottom + 6
    if (top + el.height > window.innerHeight - margin) {
      top = Math.max(margin, a.top - el.height - 6)
    }

    let left = align === 'end' ? a.right - el.width : a.left
    left = Math.min(left, window.innerWidth - el.width - margin)
    left = Math.max(margin, left)

    setPos({ top, left })
  }, [anchor, align])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if (anchor?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      // The popover is portalled to <body>, but React still bubbles its events
      // up the React tree — into whatever row opened it. Stop them here so
      // choosing a menu item doesn't also trigger the row behind it.
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

/** Convenience wrapper: a trigger button that owns its own popover state. */
export function MenuButton({
  label,
  className = 'btn btn-sm',
  children,
  align = 'start',
  title,
}: {
  label: ReactNode
  className?: string
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={ref} className={className} title={title} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <Popover anchor={ref.current} align={align} onClose={() => setOpen(false)}>
          {children(() => setOpen(false))}
        </Popover>
      )}
    </>
  )
}
