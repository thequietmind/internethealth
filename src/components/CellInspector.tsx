import { useEffect, useRef } from 'react'
import type { Cell, MeasurementRef } from '../health/report.ts'
import type { ProbeStatus } from '../health/stats.ts'
import { formatAge, formatLoss, formatMs } from './format.ts'

const ATLAS_SITE = 'https://atlas.ripe.net'

const STATUS_TEXT: Record<ProbeStatus, string> = {
  'no-reply': 'no reply',
  loss: 'loss',
  ok: 'ok',
  excluded: 'error/intercepted (excluded)',
  stale: 'stale (excluded)',
  'no-result': 'no result (excluded)',
}

function rawLatestUrl(measurement: MeasurementRef): string {
  const { id, probeIds, versions } = measurement
  const params = new URLSearchParams({ probe_ids: probeIds.join(',') })
  if (versions > 1) params.set('versions', String(versions))
  return `/atlas/measurements/${id}/latest/?${params}`
}

function MeasurementLinks({ measurement }: { measurement: MeasurementRef }) {
  return (
    <>
      <a href={`${ATLAS_SITE}/measurements/${measurement.id}/`} target="_blank" rel="noreferrer">
        #{measurement.id} ↗
      </a>{' '}
      <a href={rawLatestUrl(measurement)} target="_blank" rel="noreferrer" className="muted">
        raw /latest/ JSON
      </a>
    </>
  )
}

function MeasurementFacts({ cell }: { cell: Cell }) {
  const { measurement, stats } = cell
  return (
    <dl className="inspector-facts">
      <dt>Measurement</dt>
      <dd>
        <MeasurementLinks measurement={measurement} />
      </dd>
      {cell.alternate && (
        <>
          <dt>Ping (filtered)</dt>
          <dd>
            <MeasurementLinks measurement={cell.alternate} />
          </dd>
        </>
      )}
      <dt>Type</dt>
      <dd>
        {measurement.type} · IPv{measurement.af}
      </dd>
      <dt>Target</dt>
      <dd>
        {measurement.target} ({measurement.targetIp})
      </dd>
      <dt>Window</dt>
      <dd>
        last {measurement.versions} result{measurement.versions > 1 ? 's' : ''} per probe, ≤{' '}
        {Math.round(measurement.maxAgeSeconds / 60)} min old
      </dd>
      <dt>Cell</dt>
      <dd>
        median {formatMs(stats.medianMs)} ms · min {formatMs(stats.minMs)} · max {formatMs(stats.maxMs)} · loss{' '}
        {formatLoss(stats.lossPct)} ({stats.sent - stats.received}/{stats.sent})
      </dd>
      <dt>Probes</dt>
      <dd>
        {stats.probes} fresh of {measurement.probeIds.length} requested · {stats.results} results
        {stats.excluded > 0 && ` · ${stats.excluded} excluded`}
      </dd>
    </dl>
  )
}

function ProbeTable({ cell }: { cell: Cell }) {
  const showInstance = cell.metric === 'dns'
  return (
    <table className="probe-table">
      <thead>
        <tr>
          <th scope="col">Probe</th>
          <th scope="col">ASN</th>
          <th scope="col">Status</th>
          {showInstance && <th scope="col">Instance</th>}
          <th scope="col" className="num">
            Median
          </th>
          <th scope="col" className="num">
            Min/max
          </th>
          <th scope="col" className="num">
            Recv
          </th>
          <th scope="col" className="num">
            Age
          </th>
        </tr>
      </thead>
      <tbody>
        {cell.probes.map((probe) => (
          <tr key={probe.probeId} className={`probe-${probe.status}`}>
            <td>
              <a href={`${ATLAS_SITE}/probes/${probe.probeId}/`} target="_blank" rel="noreferrer">
                {probe.probeId}
              </a>
            </td>
            <td>{probe.asn ? `AS${probe.asn}` : '—'}</td>
            <td>{STATUS_TEXT[probe.status]}</td>
            {showInstance && <td className="instance">{probe.instance ?? '—'}</td>}
            <td className="num">{formatMs(probe.stats.medianMs)}</td>
            <td className="num">
              {formatMs(probe.stats.minMs)}/{formatMs(probe.stats.maxMs)}
            </td>
            <td className="num">
              {probe.stats.received}/{probe.stats.sent}
            </td>
            <td className="num">{formatAge(probe.lastSeen).replace(' ago', '')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PingFilteredNote({ cell }: { cell: Cell }) {
  const { probes, of } = cell.pingFiltered!
  return (
    <div className="banner">
      Ping filtered: {probes} of {of} probes get no ICMP echo reply, but the root answers their hostname.bind
      query. This cell is rated on DNS query time and DNS loss instead.
    </div>
  )
}

export function CellInspector({ cell, onClose }: { cell: Cell; onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="inspector" ref={panelRef} tabIndex={-1} aria-label="Cell details">
      <header className="inspector-head">
        <h2>
          {cell.row.label} → {cell.column.label}
          <span className={`inspector-health is-${cell.health}`}>{cell.health}</span>
        </h2>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </header>
      {cell.error && <div className="banner is-error">Request failed: {cell.error}</div>}
      {cell.pingFiltered && <PingFilteredNote cell={cell} />}
      <MeasurementFacts cell={cell} />
      <div className="probe-scroll">
        <ProbeTable cell={cell} />
      </div>
    </aside>
  )
}
