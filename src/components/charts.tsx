import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/* ------------------------------------------------------------------ *
 * Shared plumbing
 * ------------------------------------------------------------------ */

export const SERIES_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)']

export interface Series {
  name: string
  /** Defaults to the categorical slot for this series' index. */
  color?: string
}

export interface Point {
  label: string
  /** One value per series, in series order. */
  values: number[]
}

/** Track a container's width so the SVG can be laid out in real pixels. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** Axis ticks at 1/2/2.5/5 × 10ⁿ, extended to cover the data. */
function niceScale(min: number, max: number, targetTicks = 4) {
  if (min === max) {
    if (max === 0) return { min: 0, max: 1, ticks: [0, 1] }
    min = Math.min(0, max)
    max = Math.max(0, max)
  }
  const span = max - min || Math.abs(max) || 1
  const rough = span / targetTicks
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const norm = rough / magnitude
  const step = (norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 2 ? 2.5 : norm >= 1 ? 2 : 1) * magnitude
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v))
  return { min: lo, max: hi, ticks }
}

/** A rect with rounded top corners, flat on the baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, Math.abs(h)))
  if (h <= 0) return ''
  return [
    `M${x},${y + h}`,
    `V${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `H${x + w - radius}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `V${y + h}`,
    'Z',
  ].join(' ')
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Keep the bubble inside the plot however close to the edge the cursor is.
  const clampedLeft = Math.max(4, Math.min(x, width - 4))
  return (
    <div
      style={{
        position: 'absolute',
        left: clampedLeft,
        top: y,
        transform: `translate(-50%, -100%) translateY(-10px)`,
        background: 'var(--text)',
        color: 'var(--bg)',
        padding: '7px 10px',
        borderRadius: 8,
        fontSize: 12.5,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        boxShadow: 'var(--shadow-2)',
        zIndex: 3,
      }}
    >
      {children}
    </div>
  )
}

export function Legend({ series, values }: { series: Series[]; values?: string[] }) {
  if (series.length < 2) return null
  return (
    <div className="legend">
      {series.map((s, i) => (
        <span className="item" key={s.name}>
          <span className="swatch" style={{ background: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }} />
          <span>{s.name}</span>
          {values?.[i] && <span className="val">{values[i]}</span>}
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Grouped bar chart over a time axis
 * ------------------------------------------------------------------ */

export function BarChart({
  data,
  series,
  format,
  height = 220,
  onSelect,
}: {
  data: Point[]
  series: Series[]
  format: (v: number) => string
  height?: number
  onSelect?: (index: number) => void
}) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)

  const padding = { top: 12, right: 8, bottom: 26, left: 54 }
  const plotW = Math.max(0, width - padding.left - padding.right)
  const plotH = height - padding.top - padding.bottom

  const scale = useMemo(() => {
    const all = data.flatMap((d) => d.values)
    return niceScale(Math.min(0, ...all), Math.max(0, ...all))
  }, [data])

  if (width === 0) return <div ref={ref} style={{ height }} />

  const y = (v: number) => padding.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH
  const zeroY = y(0)
  const slotW = plotW / Math.max(1, data.length)
  // 2px of surface between adjacent fills keeps them from reading as one mark,
  // and a cap stops a single month from rendering as a full-width slab.
  const MAX_BAR = 56
  const groupW = Math.min(Math.max(2, slotW - 8), MAX_BAR * series.length)
  const barW = Math.max(2, groupW / Math.max(1, series.length) - 2)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img">
        {scale.ticks.map((t) => (
          <g key={t}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text x={padding.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-faint)">
              {format(t)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const groupX = padding.left + i * slotW + (slotW - groupW) / 2
          return (
            <g key={d.label}>
              <rect
                x={padding.left + i * slotW}
                y={padding.top}
                width={slotW}
                height={plotH}
                fill={hover === i ? 'var(--surface-2)' : 'transparent'}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(i)}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
              />
              {d.values.map((v, s) => {
                const top = v >= 0 ? y(v) : zeroY
                const h = Math.abs(zeroY - y(v))
                const x = groupX + s * (barW + 2)
                return (
                  <path
                    key={s}
                    d={barPath(x, top, barW, h, 4)}
                    fill={series[s]?.color ?? SERIES_COLORS[s % SERIES_COLORS.length]}
                    pointerEvents="none"
                  />
                )
              })}
            </g>
          )
        })}

        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />

        {data.map((d, i) =>
          // Thin out labels so they never collide on a narrow phone screen.
          data.length > 8 && i % Math.ceil(data.length / 6) !== 0 ? null : (
            <text
              key={d.label}
              x={padding.left + i * slotW + slotW / 2}
              y={height - 8}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-faint)"
            >
              {d.label}
            </text>
          ),
        )}
      </svg>

      {hover !== null && data[hover] && (
        <Tooltip x={padding.left + hover * slotW + slotW / 2} y={padding.top + 4} width={width}>
          <strong>{data[hover].label}</strong>
          {data[hover].values.map((v, s) => (
            <div key={s} style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
              <span>{series[s]?.name}</span>
              <span>{format(v)}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Line chart with a crosshair
 * ------------------------------------------------------------------ */

export function LineChart({
  data,
  series,
  format,
  height = 220,
  area = false,
}: {
  data: Point[]
  series: Series[]
  format: (v: number) => string
  height?: number
  area?: boolean
}) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)

  const padding = { top: 12, right: 12, bottom: 26, left: 58 }
  const plotW = Math.max(0, width - padding.left - padding.right)
  const plotH = height - padding.top - padding.bottom

  const scale = useMemo(() => {
    const all = data.flatMap((d) => d.values)
    return niceScale(Math.min(0, ...all), Math.max(0, ...all))
  }, [data])

  if (width === 0) return <div ref={ref} style={{ height }} />

  const x = (i: number) => padding.left + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW)
  const y = (v: number) => padding.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        width={width}
        height={height}
        role="img"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const rel = e.clientX - rect.left - padding.left
          const i = Math.round((rel / Math.max(1, plotW)) * (data.length - 1))
          setHover(Math.max(0, Math.min(data.length - 1, i)))
        }}
      >
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={padding.left} x2={width - padding.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={padding.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-faint)">
              {format(t)}
            </text>
          </g>
        ))}

        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={padding.top} y2={padding.top + plotH} stroke="var(--border-strong)" strokeWidth={1} />
        )}

        {series.map((s, si) => {
          const color = s.color ?? SERIES_COLORS[si % SERIES_COLORS.length]
          const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.values[si] ?? 0)}`).join(' ')
          return (
            <g key={s.name}>
              {area && data.length > 1 && (
                <path
                  d={`${path} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
                  fill={color}
                  opacity={0.12}
                />
              )}
              <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {data.length === 1 && (
                <circle cx={x(0)} cy={y(data[0].values[si] ?? 0)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
              )}
              {hover !== null && data[hover] && (
                <circle
                  cx={x(hover)}
                  cy={y(data[hover].values[si] ?? 0)}
                  r={4.5}
                  fill={color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              )}
            </g>
          )
        })}

        {data.map((d, i) =>
          data.length > 8 && i % Math.ceil(data.length / 6) !== 0 ? null : (
            <text key={d.label + i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--text-faint)">
              {d.label}
            </text>
          ),
        )}
      </svg>

      {hover !== null && data[hover] && (
        <Tooltip x={x(hover)} y={padding.top + 4} width={width}>
          <strong>{data[hover].label}</strong>
          {data[hover].values.map((v, s) => (
            <div key={s} style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
              <span>{series[s]?.name}</span>
              <span>{format(v)}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Sparkline — a shape, not a chart. No axes, no tooltip.
 * ------------------------------------------------------------------ */

export function Sparkline({ values, height = 40, color = 'var(--c1)' }: { values: number[]; height?: number; color?: string }) {
  const [ref, width] = useWidth()
  if (width === 0 || values.length < 2) return <div ref={ref} style={{ height }} />

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (i: number) => (i / (values.length - 1)) * width
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6)
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ')

  return (
    <div ref={ref}>
      <svg width={width} height={height} aria-hidden="true">
        <path d={`${path} L${width},${height} L0,${height} Z`} fill={color} opacity={0.1} />
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}
