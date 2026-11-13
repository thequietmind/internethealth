import { useEffect, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { cellKey, type Axis, type Cell, type GridModel } from '../health/report.ts'
import { CellTooltip, type TooltipAnchor } from './CellTooltip.tsx'
import { formatLoss, formatMs } from './format.ts'

interface HealthGridProps {
  caption: string
  corner: string // label for the top-left cell, e.g. "from ↓ to →"
  grid: GridModel
  selectedKey: string | null
  onSelect: (key: string) => void // click or Enter/Space opens the inspector
}

function AxisLabel({ axis, marker }: { axis: Axis; marker?: string }) {
  return (
    <>
      <span className="axis-label">
        {axis.label}
        {marker && <sup className="axis-marker">{marker}</sup>}
      </span>
      <span className="axis-detail">{axis.detail}</span>
    </>
  )
}

// Footnoted axes get *, †, ‡, … in order of appearance.
function footnoteMarkers(axes: Axis[]): Map<string, string> {
  const symbols = ['*', '†', '‡', '§', '¶']
  const markers = new Map<string, string>()
  for (const axis of axes) {
    if (axis.footnote && !markers.has(axis.key)) markers.set(axis.key, symbols[markers.size] ?? '#')
  }
  return markers
}

function CellContent({ cell }: { cell: Cell }) {
  if (cell.health === 'nodata') return <span className="cell-rtt">··</span>
  return (
    <>
      <span className="cell-rtt">{formatMs(cell.stats.medianMs)}</span>
      <span className="cell-loss">
        {cell.pingFiltered && 'dns · '}
        {formatLoss(cell.stats.lossPct)}
      </span>
    </>
  )
}

export function HealthGrid({ caption, corner, grid, selectedKey, onSelect }: HealthGridProps) {
  const [tooltip, setTooltip] = useState<TooltipAnchor | null>(null)
  const uniqueAxes = [...grid.rows, ...grid.columns].filter(
    (axis, index, all) => all.findIndex((other) => other.key === axis.key) === index,
  )
  const markers = footnoteMarkers(uniqueAxes)

  const show = (cell: Cell) => (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) =>
    setTooltip({ cell, rect: event.currentTarget.getBoundingClientRect() })
  const hide = () => setTooltip(null)
  const selectOnKey = (key: string) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect(key)
  }

  // The tooltip is fixed-positioned from a measured rect, so drop it on scroll.
  useEffect(() => {
    if (!tooltip) return
    const close = () => setTooltip(null)
    window.addEventListener('scroll', close, { capture: true, passive: true, once: true })
    return () => window.removeEventListener('scroll', close, { capture: true })
  }, [tooltip])

  return (
    <div className="grid-wrap">
      <div className="grid-scroll">
        <table className="grid">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th className="corner" scope="col">
                {corner}
              </th>
              {grid.columns.map((column) => (
                <th key={column.key} scope="col" className="column-head">
                  <AxisLabel axis={column} marker={markers.get(column.key)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="row-head">
                  <AxisLabel axis={row} marker={markers.get(row.key)} />
                </th>
                {grid.columns.map((column) => {
                  const key = cellKey(row.key, column.key)
                  const cell = grid.cells.get(key)
                  if (!cell) return <td key={column.key} className="cell is-self" aria-hidden />
                  return (
                    <td
                      key={column.key}
                      className={`cell is-${cell.health}${cell.pingFiltered ? ' is-filtered' : ''}${key === selectedKey ? ' is-selected' : ''}`}
                      tabIndex={0}
                      aria-pressed={key === selectedKey}
                      onClick={() => onSelect(key)}
                      onKeyDown={selectOnKey(key)}
                      aria-label={`${row.label} to ${column.label}: ${formatMs(cell.stats.medianMs)} ms, ${formatLoss(cell.stats.lossPct)} loss`}
                      onMouseEnter={show(cell)}
                      onMouseLeave={hide}
                      onFocus={show(cell)}
                      onBlur={hide}
                    >
                      <CellContent cell={cell} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {markers.size > 0 && (
        <ul className="footnotes">
          {uniqueAxes
            .filter((axis) => markers.has(axis.key))
            .map((axis) => (
              <li key={axis.key}>
                <span className="axis-marker">{markers.get(axis.key)}</span> {axis.label}: {axis.footnote}
              </li>
            ))}
        </ul>
      )}
      {tooltip && <CellTooltip anchor={tooltip} />}
    </div>
  )
}
