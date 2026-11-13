import { HealthGrid } from './components/HealthGrid.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'
import { formatClock, formatMs } from './components/format.ts'
import type { GridModel, Report } from './health/report.ts'
import type { Health } from './health/stats.ts'
import { useHealthReport } from './health/useHealthReport.ts'
import { BACKBONE, REFRESH_INTERVAL_MS, ROOTS } from './thresholds.ts'

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
  const { report, loading, error, refresh } = useHealthReport()
  const minutes = REFRESH_INTERVAL_MS / 60_000

  return (
    <>
      <header className="masthead">
        <div>
          <h1>
            Internet Health Report <span className="blink-dot" data-live={!loading && !error} />
          </h1>
          <p className="tagline">
            Latency and packet loss right now, from public RIPE Atlas measurements. Refreshes every {minutes}{' '}
            minutes.
          </p>
        </div>
        <div className="controls">
          <span className="updated">
            {loading ? 'Updating…' : report ? `Updated ${formatClock(report.fetchedAt)}` : '—'}
          </span>
          <button type="button" className="button" onClick={refresh} disabled={loading}>
            Refresh
          </button>
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

      {!report && !error && <div className="loading">Fetching latest results from RIPE Atlas…</div>}
      {report && <Grids report={report} />}
    </>
  )
}

function Grids({ report }: { report: Report }) {
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
        <HealthGrid caption="Backbone matrix" corner="from ↓ · to →" grid={report.backbone} />
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
        <HealthGrid caption="Root servers by ISP" corner="ISP ↓ · root →" grid={report.roots} />
        <p className="legend">
          Green ≤ {formatMs(ROOTS.latency.goodMs)} ms · yellow ≤ {formatMs(ROOTS.latency.warnMs)} ms · loss &gt;{' '}
          {ROOTS.loss.warnPct}% yellow, &gt; {ROOTS.loss.badPct}% red · gray = fewer than {ROOTS.minSamples}{' '}
          fresh probes
        </p>
      </section>
    </main>
  )
}

export default function App() {
  return (
    <div className="page">
      <Dashboard />
      <footer className="colophon">
        Data: RIPE Atlas anchor mesh and built-in measurements. The backbone matrix is data centre to data
        centre; it is not what home users experience. Hover a cell for details.
      </footer>
    </div>
  )
}
