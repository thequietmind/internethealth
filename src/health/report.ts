import { fetchLatest, mapWithConcurrency, type AtlasOptions } from '../atlas/client.ts'
import type { BackboneAnchor, GeneratedConfig, HomeIsp, RootServer } from '../atlas/generatedConfig.ts'
import type { LatestResult } from '../atlas/types.ts'
import generated from '../config.generated.json'
import { BACKBONE, FRESH_SLACK_SECONDS, MAX_CONCURRENT_REQUESTS, ROOTS } from '../thresholds.ts'
import {
  probeRows,
  rate,
  summarize,
  type CellStats,
  type Health,
  type LatencyLimits,
  type ProbeRow,
} from './stats.ts'

// JSON imports widen literal types (af: number), so assert the generated shape.
const config = generated as unknown as GeneratedConfig

export interface Axis {
  key: string
  label: string
  detail: string
  footnote?: string
}

export interface MeasurementRef {
  id: number
  af: 4 | 6
  type: 'ping' | 'dns'
  target: string
  targetIp: string
  versions: number // results per probe requested from /latest/
  maxAgeSeconds: number
  probeIds: number[] // the probe filter sent to Atlas for this cell
}

export interface Cell {
  row: Axis
  column: Axis
  stats: CellStats
  health: Health
  limits: LatencyLimits
  metric: 'ping' | 'dns'
  measurement: MeasurementRef // the measurement the cell is rated on
  alternate?: MeasurementRef // the ping measurement, when the cell fell back to DNS
  pingFiltered?: { probes: number; of: number } // set when rated on DNS because ping is filtered
  probes: ProbeRow[] // per-probe breakdown, worst first
  expectedMinMs?: number // backbone only: speed-of-light floor for the pair
  error?: string
}

export interface GridModel {
  rows: Axis[]
  columns: Axis[]
  cells: Map<string, Cell> // keyed by cellKey(row, column)
}

export interface Report {
  backbone: GridModel
  roots: GridModel
  fetchedAt: number // ms: when the Atlas results were read (snapshot time for snapshots)
  failedRequests: number
  source: 'live' | 'snapshot'
}

export const cellKey = (rowKey: string, columnKey: string) => `${rowKey}|${columnKey}`

// --- Axes ------------------------------------------------------------------

function anchorAxis(anchor: BackboneAnchor): Axis {
  return {
    key: String(anchor.anchorId),
    label: anchor.label,
    detail: `AS${anchor.asn} · ${anchor.city}`,
    footnote: anchor.substitute ? `Stand-in for ${anchor.wanted} (no live anchor)` : undefined,
  }
}

const ROOT_OPERATORS: Record<string, string> = {
  A: 'Verisign',
  B: 'USC-ISI',
  C: 'Cogent',
  D: 'UMD',
  E: 'NASA',
  F: 'ISC',
  G: 'DISA',
  H: 'US Army',
  I: 'Netnod',
  J: 'Verisign',
  K: 'RIPE NCC',
  L: 'ICANN',
  M: 'WIDE',
}

function rootAxis(server: RootServer): Axis {
  return {
    key: server.letter,
    label: server.letter,
    detail: ROOT_OPERATORS[server.letter] ?? server.host,
    footnote: server.kind === 'dns' ? 'DNS query time: G-root does not answer ping' : undefined,
  }
}

function ispAxis(isp: HomeIsp): Axis {
  const asns = isp.asns.length === 1 ? `AS${isp.asns[0]}` : `${isp.asns.length} ASNs`
  return { key: isp.key, label: isp.name, detail: `${asns} · ${isp.probeIds.length} probes` }
}

// --- Backbone thresholds from distance ---------------------------------------

const EARTH_RADIUS_KM = 6371
const FIBRE_KM_PER_MS = 200

function distanceKm(a: BackboneAnchor, b: BackboneAnchor): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const deltaLat = toRadians(b.latitude - a.latitude)
  const deltaLon = toRadians(b.longitude - a.longitude)
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(deltaLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

function backboneLimits(expectedMinMs: number): LatencyLimits {
  const { good, warn } = BACKBONE.latency
  return {
    goodMs: expectedMinMs * good.factor + good.slackMs,
    warnMs: expectedMinMs * warn.factor + warn.slackMs,
  }
}

// --- Grid builders -----------------------------------------------------------

type Fetched = LatestResult[] | Error

const toError = (reason: unknown) => (reason instanceof Error ? reason : new Error(String(reason)))

function errorText(fetched: Fetched | undefined): string | undefined {
  return fetched instanceof Error ? fetched.message : undefined
}

const resultsOf = (fetched: Fetched | undefined): LatestResult[] =>
  fetched === undefined || fetched instanceof Error ? [] : fetched

const freshWindow = (intervalSeconds: number, rounds: number) => rounds * intervalSeconds + FRESH_SLACK_SECONDS

function buildBackbone(anchors: BackboneAnchor[], fetchedByTarget: Fetched[], nowSeconds: number): GridModel {
  const axes = anchors.map(anchorAxis)
  const cells = new Map<string, Cell>()

  anchors.forEach((target, columnIndex) => {
    const fetched = fetchedByTarget[columnIndex]
    const results = resultsOf(fetched)
    const maxAgeSeconds = freshWindow(target.pingInterval, BACKBONE.freshRounds)
    anchors.forEach((source, rowIndex) => {
      if (source === target) return
      const expectedMinMs = (2 * distanceKm(source, target)) / FIBRE_KM_PER_MS
      const limits = backboneLimits(expectedMinMs)
      const stats = summarize(
        results.filter((result) => result.prb_id === source.probeId),
        nowSeconds,
        maxAgeSeconds,
      )
      cells.set(cellKey(axes[rowIndex].key, axes[columnIndex].key), {
        row: axes[rowIndex],
        column: axes[columnIndex],
        stats,
        health: rate(stats, limits, BACKBONE.loss, BACKBONE.minSamples),
        limits,
        metric: 'ping',
        measurement: {
          id: target.pingMsmId,
          af: target.af,
          type: 'ping',
          target: target.fqdn,
          targetIp: target.ipv4,
          versions: BACKBONE.versions,
          maxAgeSeconds,
          probeIds: [source.probeId],
        },
        probes: probeRows([source.probeId], () => source.asn, results, nowSeconds, maxAgeSeconds),
        expectedMinMs,
        error: errorText(fetched),
      })
    })
  })

  return { rows: axes, columns: axes, cells }
}

interface RootColumnData {
  server: RootServer
  ping: Fetched
  dns?: Fetched // hostname.bind results; only fetched for columns with ping loss
}

function rootRef(server: RootServer, id: number, type: 'ping' | 'dns', interval: number, isp: HomeIsp): MeasurementRef {
  return {
    id,
    af: server.af,
    type,
    target: server.host,
    targetIp: server.targetIp,
    versions: ROOTS.versions,
    maxAgeSeconds: freshWindow(interval, ROOTS.freshRounds),
    probeIds: isp.probeIds,
  }
}

// Probes whose pings get no reply at all while the root answers their
// hostname.bind query (with an identity) in the same window.
function countPingFiltered(pingRows: ProbeRow[], dnsRows: ProbeRow[]): number {
  const dnsAnswered = new Set(dnsRows.filter((row) => row.stats.received > 0).map((row) => row.probeId))
  return pingRows.filter((row) => row.status === 'no-reply' && dnsAnswered.has(row.probeId)).length
}

function rootCell(column: RootColumnData, isp: HomeIsp, row: Axis, columnAxis: Axis, nowSeconds: number): Cell {
  const { server } = column
  const asnOf = (probeId: number) => isp.probeAsns[probeId] ?? null
  const ownProbes = new Set(isp.probeIds)
  const own = (fetched: Fetched | undefined) => resultsOf(fetched).filter((result) => ownProbes.has(result.prb_id))

  const pingRef = rootRef(server, server.msmId, server.kind, server.interval, isp)
  const pingRows = probeRows(isp.probeIds, asnOf, own(column.ping), nowSeconds, pingRef.maxAgeSeconds)

  const dnsRef = server.dnsMsmId ? rootRef(server, server.dnsMsmId, 'dns', server.dnsInterval, isp) : undefined
  const dnsRows =
    dnsRef && column.dns ? probeRows(isp.probeIds, asnOf, own(column.dns), nowSeconds, dnsRef.maxAgeSeconds) : []
  const filtered = countPingFiltered(pingRows, dnsRows)
  const freshPingProbes = pingRows.filter((probe) => probe.stats.results > 0).length
  const useDns =
    server.kind === 'ping' && dnsRef !== undefined && filtered > 0 && filtered >= ROOTS.pingFilteredShare * freshPingProbes

  const measurement = useDns ? dnsRef : pingRef
  const fetched = useDns ? column.dns : column.ping
  const stats = summarize(own(fetched), nowSeconds, measurement.maxAgeSeconds)
  return {
    row,
    column: columnAxis,
    stats,
    health: rate(stats, ROOTS.latency, ROOTS.loss, ROOTS.minSamples),
    limits: ROOTS.latency,
    metric: measurement.type,
    measurement,
    alternate: useDns ? pingRef : undefined,
    pingFiltered: useDns ? { probes: filtered, of: freshPingProbes } : undefined,
    probes: useDns ? dnsRows : pingRows,
    error: errorText(fetched),
  }
}

function buildRoots(columnsData: RootColumnData[], isps: HomeIsp[], nowSeconds: number): GridModel {
  const rows = isps.map(ispAxis)
  const columns = columnsData.map((column) => rootAxis(column.server))
  const cells = new Map<string, Cell>()
  columnsData.forEach((column, columnIndex) => {
    isps.forEach((isp, rowIndex) => {
      const cell = rootCell(column, isp, rows[rowIndex], columns[columnIndex], nowSeconds)
      cells.set(cellKey(rows[rowIndex].key, columns[columnIndex].key), cell)
    })
  })
  return { rows, columns, cells }
}

// A ping column needs its hostname.bind results only if some ISP sees loss.
function needsDnsCheck(server: RootServer, ping: Fetched, isps: HomeIsp[], nowSeconds: number): boolean {
  if (server.kind !== 'ping' || !server.dnsMsmId || ping instanceof Error) return false
  const maxAgeSeconds = freshWindow(server.interval, ROOTS.freshRounds)
  return isps.some((isp) => {
    const ownProbes = new Set(isp.probeIds)
    const stats = summarize(
      ping.filter((result) => ownProbes.has(result.prb_id)),
      nowSeconds,
      maxAgeSeconds,
    )
    return (stats.lossPct ?? 0) > ROOTS.loss.warnPct
  })
}

// --- Loading -------------------------------------------------------------------

interface Job {
  measurementId: number
  probeIds: number[]
  versions: number
}

async function runJobs(jobs: Job[], atlas: AtlasOptions, signal?: AbortSignal) {
  const settled = await mapWithConcurrency(jobs, MAX_CONCURRENT_REQUESTS, (job) =>
    fetchLatest(atlas, job.measurementId, job.probeIds, job.versions, signal),
  )
  signal?.throwIfAborted()
  const fetched: Fetched[] = settled.map((outcome) =>
    outcome.status === 'fulfilled' ? outcome.value : toError(outcome.reason),
  )
  return { fetched, failed: settled.filter((outcome) => outcome.status === 'rejected').length }
}

// Phase 1: one request per backbone target anchor and one per root server.
// Phase 2: hostname.bind results, only for root columns that showed ping loss,
// to tell real loss from ICMP filtering. All filtered to our probes.
export async function loadReport(atlas: AtlasOptions, signal?: AbortSignal): Promise<Report> {
  const { anchors } = config.backbone
  const { servers, isps } = config.roots
  const anchorProbeIds = anchors.map((anchor) => anchor.probeId)
  const ispProbeIds = isps.flatMap((isp) => isp.probeIds)

  const phase1 = await runJobs(
    [
      ...anchors.map((anchor) => ({ measurementId: anchor.pingMsmId, probeIds: anchorProbeIds, versions: BACKBONE.versions })),
      ...servers.map((server) => ({ measurementId: server.msmId, probeIds: ispProbeIds, versions: ROOTS.versions })),
    ],
    atlas,
    signal,
  )
  const pingByServer = phase1.fetched.slice(anchors.length)
  const nowSeconds = Date.now() / 1000

  const dnsServers = servers.filter((server, index) => needsDnsCheck(server, pingByServer[index], isps, nowSeconds))
  const phase2 = await runJobs(
    dnsServers.map((server) => ({ measurementId: server.dnsMsmId!, probeIds: ispProbeIds, versions: ROOTS.versions })),
    atlas,
    signal,
  )
  const dnsByLetter = new Map(dnsServers.map((server, index) => [server.letter, phase2.fetched[index]]))

  const columns: RootColumnData[] = servers.map((server, index) => ({
    server,
    ping: pingByServer[index],
    dns: dnsByLetter.get(server.letter),
  }))
  const builtAt = Date.now() / 1000

  return {
    backbone: buildBackbone(anchors, phase1.fetched.slice(0, anchors.length), builtAt),
    roots: buildRoots(columns, isps, builtAt),
    fetchedAt: Date.now(),
    failedRequests: phase1.failed + phase2.failed,
    source: 'live',
  }
}

export const generatedAt = config.generatedAt
