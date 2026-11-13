import { SNAPSHOT } from '../thresholds.ts'
import { loadReport, type Report } from './report.ts'
import { fromSnapshot, type Snapshot } from './snapshot.ts'

// `live` calls Atlas from the browser through the Vite dev proxy. `snapshot`
// reads the shared JSON the scheduled function writes, so visitors never touch
// Atlas. Dev defaults to live and builds to snapshot; VITE_DATA_SOURCE overrides
// (`yarn dev:snapshot` sets it through .env.snapshot).
export type DataSource = 'live' | 'snapshot'

function pickSource(): DataSource {
  const requested = import.meta.env.VITE_DATA_SOURCE
  if (requested === 'live' || requested === 'snapshot') return requested
  return import.meta.env.DEV ? 'live' : 'snapshot'
}

export const DATA_SOURCE = pickSource()
const SNAPSHOT_URL = `${import.meta.env.BASE_URL}snapshot.json`

// When the browser revalidates and gets a 304, fetch still hands back the
// cached 200 with the same ETag; reuse the parsed report instead of parsing
// ~1.7 MB of JSON again (and the same object means React skips the re-render).
let lastSnapshot: { etag: string; report: Report } | null = null

async function loadSnapshot(signal?: AbortSignal): Promise<Report> {
  const response = await fetch(SNAPSHOT_URL, { signal, cache: 'no-cache' })
  if (!response.ok) throw new Error(`Snapshot unavailable (HTTP ${response.status})`)
  const etag = response.headers.get('etag')
  if (etag && lastSnapshot?.etag === etag) return lastSnapshot.report
  const report = fromSnapshot((await response.json()) as Snapshot)
  lastSnapshot = etag ? { etag, report } : null
  return report
}

export function loadLatest(signal?: AbortSignal): Promise<Report> {
  if (DATA_SOURCE === 'snapshot') return loadSnapshot(signal)
  return loadReport({ baseUrl: '/atlas' }, signal)
}

// --- Refresh schedules ------------------------------------------------------

// When to fetch next, given the last fetch time and the current report.
// null = never (manual refresh only).
export type RefreshSchedule = (lastFetchMs: number, report: Report | null) => number | null

const MINUTE_MS = 60_000
// A new snapshot can take up to a minute past its run to clear the CDN cache.
const SNAPSHOT_PUBLISH_DELAY_MS = 75_000
const SNAPSHOT_RECHECK_MS = MINUTE_MS

export const nextSnapshotAt = (report: Report) => report.fetchedAt + SNAPSHOT.intervalMinutes * MINUTE_MS

// Check shortly after the next snapshot should be visible; if it isn't there
// yet (or the last check failed), look again every minute. With the ETag, an
// unchanged check is a tiny 304.
export const followSnapshots: RefreshSchedule = (lastFetchMs, report) => {
  const recheckAt = lastFetchMs + SNAPSHOT_RECHECK_MS
  if (!report) return recheckAt
  return Math.max(nextSnapshotAt(report) + SNAPSHOT_PUBLISH_DELAY_MS, recheckAt)
}

export const everyInterval =
  (intervalMs: number | null): RefreshSchedule =>
  (lastFetchMs) =>
    intervalMs === null ? null : lastFetchMs + intervalMs
