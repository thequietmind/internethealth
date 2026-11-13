import { useCallback, useEffect, useRef, useState } from 'react'
import { REFRESH_INTERVAL_MS } from '../thresholds.ts'
import { loadReport, type Report } from './report.ts'

export interface HealthReportState {
  report: Report | null
  loading: boolean
  error: string | null
  refresh: () => void
}

// Loads on mount and every REFRESH_INTERVAL_MS. Skips ticks while the tab is
// hidden and catches up as soon as it becomes visible again.
export function useHealthReport(): HealthReportState {
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

    loadReport(controller.signal)
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
    const refreshIfDue = () => {
      if (document.hidden) return
      if (Date.now() - lastFetchRef.current >= REFRESH_INTERVAL_MS) refresh()
    }

    // oxlint-disable-next-line react/set-state-in-effect -- the effect starts the initial fetch
    refresh()
    const timer = setInterval(refreshIfDue, 15_000)
    document.addEventListener('visibilitychange', refreshIfDue)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshIfDue)
      controllerRef.current?.abort()
    }
  }, [refresh])

  return { report, loading, error, refresh }
}
