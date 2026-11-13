import type { LatestResult } from './types.ts'

// Proxied to https://atlas.ripe.net/api/v2 by the Vite dev server.
const API_BASE = '/atlas'

export async function fetchLatest(
  measurementId: number,
  probeIds: number[],
  versions: number,
  signal?: AbortSignal,
): Promise<LatestResult[]> {
  const params = new URLSearchParams({ probe_ids: probeIds.join(',') })
  if (versions > 1) params.set('versions', String(versions))
  const url = `${API_BASE}/measurements/${measurementId}/latest/?${params}`
  const response = await fetch(url, { signal })
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
