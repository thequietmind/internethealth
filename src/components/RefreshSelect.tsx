import { REFRESH_OPTIONS_MINUTES, type RefreshMinutes } from '../thresholds.ts'
import { isRefreshMinutes } from './useRefreshMinutes.ts'

function refreshLabel(minutes: RefreshMinutes): string {
  if (minutes === 0) return 'Off'
  return minutes === 60 ? 'Every hour' : `Every ${minutes} min`
}

interface RefreshSelectProps {
  value: RefreshMinutes
  onChange: (minutes: RefreshMinutes) => void
}

export function RefreshSelect({ value, onChange }: RefreshSelectProps) {
  return (
    <label className="refresh-select">
      <span>Auto-refresh</span>
      <select
        className="button"
        value={value}
        onChange={(event) => {
          const minutes = Number(event.target.value)
          if (isRefreshMinutes(minutes)) onChange(minutes)
        }}
      >
        {REFRESH_OPTIONS_MINUTES.map((minutes) => (
          <option key={minutes} value={minutes}>
            {refreshLabel(minutes)}
          </option>
        ))}
      </select>
    </label>
  )
}
