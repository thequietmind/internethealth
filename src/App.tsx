import { useCallback, useState } from 'react'
import { CellInspector } from './components/CellInspector.tsx'
import { HealthGrid } from './components/HealthGrid.tsx'
import { LoadingIndicator } from './components/LoadingIndicator.tsx'
import { RefreshSelect } from './components/RefreshSelect.tsx'
import { useRefreshMinutes } from './components/useRefreshMinutes.ts'
import { ThemeToggle } from './components/ThemeToggle.tsx'
import { formatClock, formatMs } from './components/format.ts'
import type { GridModel, Report } from './health/report.ts'
import type { Health } from './health/stats.ts'
import { useHealthReport } from './health/useHealthReport.ts'
import { BACKBONE, ROOTS } from './thresholds.ts'

type GridName = 'backbone' | 'roots'

interface Selection {
  grid: GridName
  key: string
}

const HEALTH_ORDER: Health[] = ['good', 'warn', 'bad', 'nodata']
const HEALTH_NAMES: Record<Health, string> = { good: 'ok', warn: 'degraded', bad: 'poor', nodata: 'no data' }

function countHealth(grids: GridModel[]): Record<Health, number> {
  const counts: Record<Health, number> = { good: 0, warn: 0, bad: 0, nodata: 0 }
  for (const grid of grids) for (const cell of grid.cells.values()) counts[cell.health]++
  return counts
}

function Summary({ report }: { report: Report }) {
  const counts = countHealth([report.backbone, report.roots])
  return (
    <div className="summary" aria-label="Cell status counts">
      {HEALTH_ORDER.map((health) => (
        <span key={health} className="summary-item">
          <span className={`swatch is-${health}`} />
          <strong>{counts[health]}</strong> {HEALTH_NAMES[health]}
        </span>
      ))}
    </div>
  )
}

function Dashboard() {
  const [refreshMinutes, setRefreshMinutes] = useRefreshMinutes()
  const { report, loading, error, refresh } = useHealthReport(refreshMinutes ? refreshMinutes * 60_000 : null)
  const cadence = refreshMinutes
    ? `Refreshes every ${refreshMinutes === 60 ? 'hour' : `${refreshMinutes} minutes`}.`
    : 'Auto-refresh is off.'

  return (
    <>
      <header className="masthead" data-loading={loading}>
        <div>
          <h1>
            Internet Health Report <span className="blink-dot" data-live={!loading && !error} />
          </h1>
          <p className="tagline">
            Latency and packet loss right now, from public RIPE Atlas measurements. {cadence}
          </p>
        </div>
        <div className="controls">
          <span className="updated">
            {loading && report ? (
              <LoadingIndicator label="Updating…" />
            ) : loading ? (
              '—' // the first load has its own indicator below
            ) : report ? (
              `Updated ${formatClock(report.fetchedAt)}`
            ) : (
              '—'
            )}
          </span>
          <button type="button" className="button" onClick={refresh} disabled={loading}>
            Refresh
          </button>
          <RefreshSelect value={refreshMinutes} onChange={setRefreshMinutes} />
          <ThemeToggle />
        </div>
      </header>

      {error && <div className="banner is-error">Could not load data: {error}</div>}
      {report && report.failedRequests > 0 && (
        <div className="banner">
          {report.failedRequests} Atlas request(s) failed; affected cells show as no data.
        </div>
      )}
      {report && <Summary report={report} />}

      {!report && !error && (
        <div className="loading">
          <LoadingIndicator size="large" label="Fetching latest results from RIPE Atlas…" />
        </div>
      )}
      {report && (
        <div className="grids" aria-busy={loading} data-refreshing={loading}>
          <Grids report={report} />
        </div>
      )}
    </>
  )
}

function Grids({ report }: { report: Report }) {
  // Store the key, not the cell, so the inspector follows refreshed data.
  const [selection, setSelection] = useState<Selection | null>(null)
  const close = useCallback(() => setSelection(null), [])
  const toggle = (grid: GridName) => (key: string) =>
    setSelection((current) => (current?.grid === grid && current.key === key ? null : { grid, key }))
  const selectedKey = (grid: GridName) => (selection?.grid === grid ? selection.key : null)
  const selectedCell = selection ? report[selection.grid].cells.get(selection.key) : undefined

  const backboneGood = BACKBONE.latency.good
  const backboneWarn = BACKBONE.latency.warn
  return (
    <main>
      <section className="panel">
        <header className="panel-head">
          <h2>Backbone matrix</h2>
          <p>
            Anchor-to-anchor ping across transit networks. Median RTT (ms) and loss over the last{' '}
            {BACKBONE.versions} rounds. Row = source, column = target.
          </p>
        </header>
        <HealthGrid
          caption="Backbone matrix"
          corner="from ↓ · to →"
          grid={report.backbone}
          selectedKey={selectedKey('backbone')}
          onSelect={toggle('backbone')}
        />
        <p className="legend">
          Green ≤ {backboneGood.factor}× fibre minimum + {backboneGood.slackMs} ms · yellow ≤{' '}
          {backboneWarn.factor}× + {backboneWarn.slackMs} ms · loss &gt; {BACKBONE.loss.warnPct}% yellow, &gt;{' '}
          {BACKBONE.loss.badPct}% red
        </p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Root servers from US home ISPs</h2>
          <p>
            Built-in pings from home probes to DNS roots A–M. Median RTT (ms) and loss across all probes in
            each network.
          </p>
        </header>
        <HealthGrid
          caption="Root servers by ISP"
          corner="ISP ↓ · root →"
          grid={report.roots}
          selectedKey={selectedKey('roots')}
          onSelect={toggle('roots')}
        />
        <p className="legend">
          Green ≤ {formatMs(ROOTS.latency.goodMs)} ms · yellow ≤ {formatMs(ROOTS.latency.warnMs)} ms · loss &gt;{' '}
          {ROOTS.loss.warnPct}% yellow, &gt; {ROOTS.loss.badPct}% red · gray = fewer than {ROOTS.minSamples}{' '}
          fresh probes · hatched “dns” = ping filtered, rated on DNS query time
        </p>
      </section>
      {selectedCell && <CellInspector cell={selectedCell} onClose={close} />}
    </main>
  )
}

export default function App() {
  return (
    <div className="page">
      <Dashboard />
      <footer className="colophon">
        Data: RIPE Atlas anchor mesh and built-in measurements. The backbone matrix is data centre to data
        centre; it is not what home users experience. Hover a cell for details; click it for the per-probe breakdown.
      </footer>
    </div>
  )
}
