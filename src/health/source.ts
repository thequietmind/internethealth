import { loadReport, type Report } from './report.ts'
import { fromSnapshot, type Snapshot } from './snapshot.ts'

// `live` calls Atlas from the browser through the Vite dev proxy. `snapshot`
// reads the shared JSON the scheduled function writes, so visitors never touch
// Atlas. Dev defaults to live and builds to snapshot; VITE_DATA_SOURCE overrides.
export type DataSource = 'live' | 'snapshot'

function pickSource(): DataSource {
  const requested = import.meta.env.VITE_DATA_SOURCE
  if (requested === 'live' || requested === 'snapshot') return requested
  return import.meta.env.DEV ? 'live' : 'snapshot'
}

export const DATA_SOURCE = pickSource()
const SNAPSHOT_URL = `${import.meta.env.BASE_URL}snapshot.json`

async function loadSnapshot(signal?: AbortSignal): Promise<Report> {
  const response = await fetch(SNAPSHOT_URL, { signal, cache: 'no-cache' })
  if (!response.ok) throw new Error(`Snapshot unavailable (HTTP ${response.status})`)
  return fromSnapshot((await response.json()) as Snapshot)
}

export function loadLatest(signal?: AbortSignal): Promise<Report> {
  if (DATA_SOURCE === 'snapshot') return loadSnapshot(signal)
  return loadReport({ baseUrl: '/atlas' }, signal)
}
