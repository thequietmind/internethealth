export function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  return ms < 10 ? ms.toFixed(1) : String(Math.round(ms))
}

export function formatLoss(lossPct: number | null): string {
  if (lossPct === null) return '—'
  if (lossPct === 0) return '0%'
  return lossPct < 10 ? `${lossPct.toFixed(1)}%` : `${Math.round(lossPct)}%`
}

export function formatAge(timestampSeconds: number | null, nowMs = Date.now()): string {
  if (timestampSeconds === null) return '—'
  const seconds = Math.max(0, Math.round(nowMs / 1000 - timestampSeconds))
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s ago`
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
