import { useRef, useState } from 'react'
import { Icon } from './Icon'
import { Popover } from './Menu'
import { useUi } from '../state/ui'
import { MONTH_SHORT, currentMonth, monthLabel } from '../lib/dates'

export function MonthNav() {
  const month = useUi((s) => s.month)
  const setMonth = useUi((s) => s.setMonth)
  const step = useUi((s) => s.stepMonth)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const [pickerYear, setPickerYear] = useState(Number(month.slice(0, 4)))

  return (
    <div className="month-nav">
      <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous month">
        <Icon name="chevronLeft" />
      </button>
      <button
        ref={ref}
        className="month-label"
        onClick={() => {
          setPickerYear(Number(month.slice(0, 4)))
          setOpen((v) => !v)
        }}
      >
        {monthLabel(month)}
      </button>
      <button className="icon-btn" onClick={() => step(1)} aria-label="Next month">
        <Icon name="chevronRight" />
      </button>

      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} width={252}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '2px 4px 8px' }}>
            <button className="icon-btn" onClick={() => setPickerYear((y) => y - 1)} aria-label="Previous year">
              <Icon name="chevronLeft" size={16} />
            </button>
            <strong style={{ flex: 1, textAlign: 'center' }}>{pickerYear}</strong>
            <button className="icon-btn" onClick={() => setPickerYear((y) => y + 1)} aria-label="Next year">
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            {MONTH_SHORT.map((name, i) => {
              const key = `${pickerYear}-${String(i + 1).padStart(2, '0')}`
              const isCurrent = key === currentMonth()
              const isSelected = key === month
              return (
                <button
                  key={key}
                  style={{
                    justifyContent: 'center',
                    fontWeight: isCurrent ? 700 : 500,
                    background: isSelected ? 'var(--accent-soft)' : undefined,
                    color: isSelected ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => {
                    setMonth(key)
                    setOpen(false)
                  }}
                >
                  {name}
                </button>
              )
            })}
          </div>
          <div className="menu-sep" />
          <button
            onClick={() => {
              setMonth(currentMonth())
              setOpen(false)
            }}
          >
            <Icon name="calendar" size={15} /> Jump to this month
          </button>
        </Popover>
      )}
    </div>
  )
}
