import { useCallback, useEffect, useRef, useState } from 'react'
import type { Report } from './report.ts'
import { loadLatest } from './source.ts'

export interface HealthReportState {
  report: Report | null
  loading: boolean
  error: string | null
  refresh: () => void
}

const TICK_MS = 15_000

// Loads on mount, then every `intervalMs` (null = auto-refresh off; manual
// refresh still works). Skips ticks while the tab is hidden and catches up as
// soon as it becomes visible again.
export function useHealthReport(intervalMs: number | null): HealthReportState {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const lastFetchRef = useRef(0)

  const refresh = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    lastFetchRef.current = Date.now()
    setLoading(true)

    loadLatest(controller.signal)
      .then((next) => {
        setReport(next)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (controllerRef.current === controller) setLoading(false)
      })
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the effect starts the initial fetch
    refresh()
    return () => controllerRef.current?.abort()
  }, [refresh])

  useEffect(() => {
    if (intervalMs === null) return
    const refreshIfDue = () => {
      if (document.hidden) return
      if (Date.now() - lastFetchRef.current >= intervalMs) refresh()
    }
    const timer = setInterval(refreshIfDue, TICK_MS)
    document.addEventListener('visibilitychange', refreshIfDue)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshIfDue)
    }
  }, [intervalMs, refresh])

  return { report, loading, error, refresh }
}
