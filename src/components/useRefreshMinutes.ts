import { useEffect, useState } from 'react'
import { DEFAULT_REFRESH_MINUTES, REFRESH_OPTIONS_MINUTES, type RefreshMinutes } from '../thresholds.ts'

const STORAGE_KEY = 'internethealth.refreshMinutes'

export function isRefreshMinutes(value: number): value is RefreshMinutes {
  return (REFRESH_OPTIONS_MINUTES as readonly number[]).includes(value)
}

function readStoredMinutes(): RefreshMinutes {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY) ?? Number.NaN)
    return isRefreshMinutes(stored) ? stored : DEFAULT_REFRESH_MINUTES
  } catch {
    return DEFAULT_REFRESH_MINUTES
  }
}

// The auto-refresh choice, remembered per browser. 0 means off.
export function useRefreshMinutes(): [RefreshMinutes, (minutes: RefreshMinutes) => void] {
  const [minutes, setMinutes] = useState<RefreshMinutes>(readStoredMinutes)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(minutes))
    } catch {
      // Storage unavailable (private mode); the choice just won't persist.
    }
  }, [minutes])

  return [minutes, setMinutes]
}
