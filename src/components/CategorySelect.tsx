import { useMemo } from 'react'
import { useData } from '../hooks/useData'
import type { Id } from '../types'

/**
 * Native grouped select for categories — deliberately native so phones get
 * their own picker wheel rather than a cramped custom dropdown.
 */
export function CategorySelect({
  value,
  onChange,
  includeInflow = true,
  includeNone = true,
  noneLabel = 'Needs a category',
  id,
  disabled,
  className,
}: {
  value: Id | null
  onChange: (id: Id | null) => void
  includeInflow?: boolean
  includeNone?: boolean
  noneLabel?: string
  id?: string
  disabled?: boolean
  className?: string
}) {
  const { groups, categories } = useData()

  const options = useMemo(() => {
    const visibleGroups = groups
      .filter((g) => !g.isInternal && !g.hidden)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    return visibleGroups
      .map((g) => ({
        group: g,
        items: categories
          .filter((c) => c.groupId === g.id && (!c.hidden || c.id === value))
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .filter((entry) => entry.items.length > 0)
  }, [groups, categories, value])

  const inflow = categories.find((c) => c.isInflow)

  return (
    <select
      id={id}
      disabled={disabled}
      className={`select${className ? ` ${className}` : ''}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {includeNone && <option value="">{noneLabel}</option>}
      {includeInflow && inflow && (
        <optgroup label="Inflow">
          <option value={inflow.id}>Ready to Assign</option>
        </optgroup>
      )}
      {options.map(({ group, items }) => (
        <optgroup key={group.id} label={group.name}>
          {items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.hidden ? ' (hidden)' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
