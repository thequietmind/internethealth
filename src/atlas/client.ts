import type { LatestResult } from './types.ts'

export const ATLAS_API = 'https://atlas.ripe.net/api/v2'

// Where requests go and how they are sent. The browser uses the Vite dev proxy
// (`/atlas`); the snapshot function calls Atlas directly with its own fetch,
// which adds a User-Agent and stops the run on throttling.
export interface AtlasOptions {
  baseUrl: string
  fetch?: typeof fetch
}

export function latestUrl(baseUrl: string, measurementId: number, probeIds: number[], versions: number): string {
  const params = new URLSearchParams({ probe_ids: probeIds.join(',') })
  if (versions > 1) params.set('versions', String(versions))
  return `${baseUrl}/measurements/${measurementId}/latest/?${params}`
}

export async function fetchLatest(
  atlas: AtlasOptions,
  measurementId: number,
  probeIds: number[],
  versions: number,
  signal?: AbortSignal,
): Promise<LatestResult[]> {
  const send = atlas.fetch ?? fetch
  const response = await send(latestUrl(atlas.baseUrl, measurementId, probeIds, versions), { signal })
  if (!response.ok) throw new Error(`Atlas ${response.status} for measurement ${measurementId}`)
  return (await response.json()) as LatestResult[]
}

// Runs `task` over `items` with at most `limit` in flight. Never rejects:
// each slot holds either the value or the error.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const settled: PromiseSettledResult<R>[] = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      try {
        settled[index] = { status: 'fulfilled', value: await task(items[index]) }
      } catch (reason) {
        settled[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return settled
}
