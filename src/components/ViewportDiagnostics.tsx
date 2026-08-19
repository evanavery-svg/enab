import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { nudgeLayoutNow, readViewport, type ViewportReport } from '../lib/viewport'
import { APP_VERSION } from '../lib/version'

/**
 * Live readout of the numbers that decide where the tab bar sits.
 *
 * This exists because the layout problem it diagnoses only appears in an iOS
 * app launched from the Home Screen — an environment that cannot be reproduced
 * in a desktop browser. Rather than guessing across releases, this makes the
 * device state screenshot-able.
 */
export function ViewportDiagnostics() {
  const [report, setReport] = useState<ViewportReport | null>(null)

  useEffect(() => {
    const update = () => setReport(readViewport())
    update()
    const id = window.setInterval(update, 500)
    return () => window.clearInterval(id)
  }, [])

  if (!report) return null

  const gap = report.gapBelowNav
  // Two separate things can go wrong, and the first one hid the second for a
  // long time: the bar can sit above the bottom of the *viewport*, or the
  // viewport itself can fall short of the *screen*. Only checking the former
  // reported "flush" while a band of background sat under the tab bar.
  const barFlush = gap !== null && Math.abs(gap) <= 1
  const viewportFillsScreen = report.screenShortfall <= 2
  const healthy = barFlush && viewportFillsScreen

  const rows: [string, string][] = [
    ['Version', `v${APP_VERSION}`],
    ['Display mode', report.mode],
    ['Gap below tab bar', gap === null ? '—' : `${gap}px`],
    ['Screen minus viewport', `${report.screenShortfall}px`],
    ['Tab bar position', report.navPosition ?? '—'],
    ['Tab bar bottom edge', report.navBottom === null ? '—' : `${report.navBottom}px`],
    ['window.innerHeight', `${report.innerHeight}px`],
    ['document clientHeight', `${report.clientHeight}px`],
    ['visualViewport', report.visualViewport === null ? 'n/a' : `${report.visualViewport}px`],
    ['screen.height', `${report.screenHeight}px`],
    ['Safe area top', report.safeAreaTop],
    ['Safe area bottom', report.safeAreaBottom],
    ['Pixel ratio', String(report.devicePixelRatio)],
  ]

  return (
    <div className="diagnostics">
      <div className={`diagnostics-verdict ${healthy ? 'ok' : 'bad'}`}>
        <Icon name={healthy ? 'check' : 'alert'} size={16} />
        <span>
          {gap === null
            ? 'Tab bar not on screen (desktop layout)'
            : !viewportFillsScreen
              ? `The viewport is ${report.screenShortfall}px shorter than the screen — iOS is not giving the app the full height`
              : barFlush
                ? 'Tab bar is flush with the bottom of the screen'
                : `Tab bar is ${gap}px above the bottom of the viewport`}
        </span>
      </div>

      <dl className="diagnostics-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <button
        className="btn btn-sm"
        style={{ marginTop: 10 }}
        onClick={() => {
          nudgeLayoutNow()
          setReport(readViewport())
        }}
      >
        <Icon name="refresh" size={14} /> Force re-layout
      </button>
    </div>
  )
}
