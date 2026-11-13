import { ATLAS_API } from '../../src/atlas/client.ts'
import { loadReport } from '../../src/health/report.ts'
import { toSnapshot, type Snapshot } from '../../src/health/snapshot.ts'
import { SNAPSHOT } from '../../src/thresholds.ts'
import { afterFailure, NO_BACKOFF, parseRetryAfter, shouldSkip, type BackoffState } from './backoff.ts'

export interface SnapshotStore {
  readBackoff(): Promise<BackoffState>
  writeBackoff(state: BackoffState): Promise<void>
  writeSnapshot(snapshot: Snapshot): Promise<void>
}

export type RunOutcome =
  | { status: 'written'; failedRequests: number; requests: number }
  | { status: 'skipped'; until: string; lastError: string | null }
  | { status: 'failed'; error: string; failures: number; nextAttemptAt: string }

interface StopReason {
  message: string
  retryAfterSeconds?: number
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// Identifies the app to RIPE and stops the whole run on the first sign of
// trouble (429, 5xx, network error) instead of letting other requests pile on.
function politeFetch(userAgent: string, stop: (reason: StopReason) => void, count: () => void): typeof fetch {
  return async (input, init) => {
    init?.signal?.throwIfAborted() // the run was stopped: send nothing more
    count()
    const headers = new Headers(init?.headers)
    headers.set('User-Agent', userAgent)
    headers.set('Accept', 'application/json')
    let response: Response
    try {
      response = await fetch(input, { ...init, headers })
    } catch (error) {
      if (!init?.signal?.aborted) stop({ message: `Network error: ${messageOf(error)}` })
      throw error
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'), Date.now())
      stop({ message: `Atlas HTTP ${response.status}`, retryAfterSeconds })
    }
    return response
  }
}

// One scheduled run: skip if backing off, otherwise build the report from
// Atlas and store it. A failed run keeps the previous snapshot (the page marks
// it stale) and pushes the next attempt out. Requests are never retried.
export async function runSnapshot(store: SnapshotStore, userAgent: string, nowMs = Date.now()): Promise<RunOutcome> {
  const backoff = await store.readBackoff()
  if (shouldSkip(backoff, nowMs)) {
    return { status: 'skipped', until: new Date(backoff.nextAttemptAt).toISOString(), lastError: backoff.lastError }
  }

  const stopped: { reason?: StopReason } = {}
  const controller = new AbortController()
  const stop = (reason: StopReason) => {
    stopped.reason ??= reason
    controller.abort()
  }
  let requests = 0
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(SNAPSHOT.runTimeoutSeconds * 1000)])

  try {
    const atlas = { baseUrl: ATLAS_API, fetch: politeFetch(userAgent, stop, () => requests++) }
    const report = await loadReport(atlas, signal)
    await store.writeSnapshot(toSnapshot(report))
    if (backoff.failures > 0) await store.writeBackoff(NO_BACKOFF)
    return { status: 'written', failedRequests: report.failedRequests, requests }
  } catch (error) {
    const timedOut = signal.aborted && !stopped.reason
    const reason = stopped.reason ?? {
      message: timedOut ? `Run exceeded ${SNAPSHOT.runTimeoutSeconds} s` : messageOf(error),
    }
    const next = afterFailure(backoff, nowMs, reason.message, reason.retryAfterSeconds)
    await store.writeBackoff(next)
    return {
      status: 'failed',
      error: reason.message,
      failures: next.failures,
      nextAttemptAt: new Date(next.nextAttemptAt).toISOString(),
    }
  }
}
