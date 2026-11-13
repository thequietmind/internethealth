import type { Cell } from '../health/report.ts'
import { formatAge, formatLoss, formatMs } from './format.ts'

export interface TooltipAnchor {
  cell: Cell
  rect: DOMRect
}

const TOOLTIP_WIDTH = 264
const TOOLTIP_HEIGHT_ESTIMATE = 220
const GAP = 6

const HEALTH_TEXT = { good: 'Healthy', warn: 'Degraded', bad: 'Poor', nodata: 'No data' } as const

function position(rect: DOMRect) {
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2),
    window.innerWidth - TOOLTIP_WIDTH - 8,
  )
  const fitsBelow = rect.bottom + GAP + TOOLTIP_HEIGHT_ESTIMATE < window.innerHeight
  return fitsBelow
    ? { left, top: rect.bottom + GAP }
    : { left, bottom: window.innerHeight - rect.top + GAP }
}

export function CellTooltip({ anchor }: { anchor: TooltipAnchor }) {
  const { cell, rect } = anchor
  const { stats } = cell
  const rttLabel = cell.metric === 'dns' ? 'DNS RTT' : 'RTT'
  const sampleLabel = cell.metric === 'dns' ? 'queries' : 'packets'

  return (
    <div className="tooltip" role="tooltip" style={{ ...position(rect), width: TOOLTIP_WIDTH }}>
      <div className="tooltip-path">
        <span>{cell.row.label}</span>
        <span className="tooltip-arrow">→</span>
        <span>{cell.column.label}</span>
      </div>
      <div className="tooltip-sub">
        {cell.row.detail} → {cell.column.detail}
      </div>
      <dl>
        <dt>Status</dt>
        <dd className={`tooltip-status is-${cell.health}`}>{HEALTH_TEXT[cell.health]}</dd>
        <dt>Median {rttLabel}</dt>
        <dd>{formatMs(stats.medianMs)} ms</dd>
        <dt>Min / max</dt>
        <dd>
          {formatMs(stats.minMs)} / {formatMs(stats.maxMs)} ms
        </dd>
        <dt>Loss</dt>
        <dd>
          {formatLoss(stats.lossPct)}{' '}
          <span className="muted">
            ({stats.sent - stats.received}/{stats.sent} {sampleLabel})
          </span>
        </dd>
        <dt>Probes</dt>
        <dd>
          {stats.probes} <span className="muted">({stats.results} results)</span>
        </dd>
        <dt>Newest result</dt>
        <dd>{formatAge(stats.newestTimestamp)}</dd>
        {cell.expectedMinMs !== undefined && (
          <>
            <dt>Fibre minimum</dt>
            <dd>{formatMs(cell.expectedMinMs)} ms</dd>
          </>
        )}
        <dt>Green / yellow</dt>
        <dd>
          ≤ {formatMs(cell.limits.goodMs)} / ≤ {formatMs(cell.limits.warnMs)} ms
        </dd>
      </dl>
      {cell.error && <div className="tooltip-error">Request failed: {cell.error}</div>}
    </div>
  )
}
