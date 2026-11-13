import { SNAPSHOT } from '../../src/thresholds.ts'

export interface BackoffState {
  failures: number // consecutive failed runs
  nextAttemptAt: number // ms; runs before this are skipped
  lastError: string | null
}

export const NO_BACKOFF: BackoffState = { failures: 0, nextAttemptAt: 0, lastError: null }

const MINUTE_MS = 60_000
// Cron runs drift by a few seconds; don't skip a run that fires slightly early.
const SCHEDULE_TOLERANCE_MS = MINUTE_MS

export const shouldSkip = (state: BackoffState, nowMs: number) => nowMs < state.nextAttemptAt

// Waits 5, 10, 20, 40, then 60 minutes between attempts. A Retry-After from
// Atlas wins when it asks for longer.
export function afterFailure(
  state: BackoffState,
  nowMs: number,
  error: string,
  retryAfterSeconds?: number,
): BackoffState {
  const failures = state.failures + 1
  const waitMinutes = Math.min(SNAPSHOT.backoffBaseMinutes * 2 ** (failures - 1), SNAPSHOT.backoffMaxMinutes)
  const waitMs = waitMinutes * MINUTE_MS - SCHEDULE_TOLERANCE_MS
  const retryAfterMs = (retryAfterSeconds ?? 0) * 1000
  return { failures, nextAttemptAt: nowMs + Math.max(waitMs, retryAfterMs), lastError: error }
}

// Retry-After is either delay-seconds or an HTTP date.
export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds)
  const date = Date.parse(header)
  return Number.isNaN(date) ? undefined : Math.max(0, (date - nowMs) / 1000)
}
