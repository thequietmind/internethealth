import { fetchLatest, mapWithConcurrency } from '../atlas/client.ts'
import type { BackboneAnchor, GeneratedConfig, HomeIsp, RootServer } from '../atlas/generatedConfig.ts'
import type { LatestResult } from '../atlas/types.ts'
import generated from '../config.generated.json'
import { BACKBONE, MAX_CONCURRENT_REQUESTS, ROOTS } from '../thresholds.ts'
import { rate, summarize, type CellStats, type Health, type LatencyLimits } from './stats.ts'

const config = generated as GeneratedConfig

export interface Axis {
  key: string
  label: string
  detail: string
  footnote?: string
}

export interface Cell {
  row: Axis
  column: Axis
  stats: CellStats
  health: Health
  limits: LatencyLimits
  metric: 'ping' | 'dns'
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
  fetchedAt: number // ms
  failedRequests: number
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

function errorText(fetched: Fetched): string | undefined {
  return fetched instanceof Error ? fetched.message : undefined
}

function buildBackbone(anchors: BackboneAnchor[], fetchedByTarget: Fetched[], nowSeconds: number): GridModel {
  const axes = anchors.map(anchorAxis)
  const cells = new Map<string, Cell>()

  anchors.forEach((target, columnIndex) => {
    const fetched = fetchedByTarget[columnIndex]
    const results = fetched instanceof Error ? [] : fetched
    anchors.forEach((source, rowIndex) => {
      if (source === target) return
      const expectedMinMs = (2 * distanceKm(source, target)) / FIBRE_KM_PER_MS
      const limits = backboneLimits(expectedMinMs)
      const stats = summarize(
        results.filter((result) => result.prb_id === source.probeId),
        nowSeconds,
        BACKBONE.maxAgeSeconds,
      )
      cells.set(cellKey(axes[rowIndex].key, axes[columnIndex].key), {
        row: axes[rowIndex],
        column: axes[columnIndex],
        stats,
        health: rate(stats, limits, BACKBONE.loss, BACKBONE.minSamples),
        limits,
        metric: 'ping',
        expectedMinMs,
        error: errorText(fetched),
      })
    })
  })

  return { rows: axes, columns: axes, cells }
}

function buildRoots(servers: RootServer[], isps: HomeIsp[], fetchedByServer: Fetched[], nowSeconds: number): GridModel {
  const rows = isps.map(ispAxis)
  const columns = servers.map(rootAxis)
  const ispByProbe = new Map(isps.flatMap((isp) => isp.probeIds.map((id) => [id, isp.key] as const)))
  const limits = ROOTS.latency
  const cells = new Map<string, Cell>()

  servers.forEach((server, columnIndex) => {
    const fetched = fetchedByServer[columnIndex]
    const results = fetched instanceof Error ? [] : fetched
    rows.forEach((row) => {
      const stats = summarize(
        results.filter((result) => ispByProbe.get(result.prb_id) === row.key),
        nowSeconds,
        ROOTS.maxAgeSeconds,
      )
      cells.set(cellKey(row.key, columns[columnIndex].key), {
        row,
        column: columns[columnIndex],
        stats,
        health: rate(stats, limits, ROOTS.loss, ROOTS.minSamples),
        limits,
        metric: server.kind,
        error: errorText(fetched),
      })
    })
  })

  return { rows, columns, cells }
}

// --- Loading -------------------------------------------------------------------

interface Job {
  measurementId: number
  probeIds: number[]
  versions: number
}

// One request per backbone target anchor and one per root server, all filtered
// to the probes we care about, with a small concurrency cap.
export async function loadReport(signal?: AbortSignal): Promise<Report> {
  const { anchors } = config.backbone
  const { servers, isps } = config.roots
  const anchorProbeIds = anchors.map((anchor) => anchor.probeId)
  const ispProbeIds = isps.flatMap((isp) => isp.probeIds)

  const jobs: Job[] = [
    ...anchors.map((anchor) => ({
      measurementId: anchor.pingMsmId,
      probeIds: anchorProbeIds,
      versions: BACKBONE.versions,
    })),
    ...servers.map((server) => ({
      measurementId: server.msmId,
      probeIds: ispProbeIds,
      versions: ROOTS.versions,
    })),
  ]

  const settled = await mapWithConcurrency(jobs, MAX_CONCURRENT_REQUESTS, (job) =>
    fetchLatest(job.measurementId, job.probeIds, job.versions, signal),
  )
  signal?.throwIfAborted()

  const fetched: Fetched[] = settled.map((outcome) =>
    outcome.status === 'fulfilled' ? outcome.value : toError(outcome.reason),
  )
  const nowSeconds = Date.now() / 1000

  return {
    backbone: buildBackbone(anchors, fetched.slice(0, anchors.length), nowSeconds),
    roots: buildRoots(servers, isps, fetched.slice(anchors.length), nowSeconds),
    fetchedAt: Date.now(),
    failedRequests: settled.filter((outcome) => outcome.status === 'rejected').length,
  }
}

export const generatedAt = config.generatedAt
