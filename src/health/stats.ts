import type { LatestResult } from '../atlas/types.ts'
import type { LossThresholds } from '../thresholds.ts'

export type Health = 'good' | 'warn' | 'bad' | 'nodata'

export interface CellStats {
  results: number // fresh results (probes × versions)
  probes: number // distinct probes with a fresh result
  sent: number
  received: number
  lossPct: number | null
  medianMs: number | null
  minMs: number | null
  maxMs: number | null
  newestTimestamp: number | null // unix seconds
}

export interface LatencyLimits {
  goodMs: number
  warnMs: number
}

function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// Ping results contribute every packet; DNS results count as one packet each
// (an answer is "received", a timeout is "lost").
function packetsOf(result: LatestResult): { sent: number; received: number; rtts: number[] } {
  if (result.type === 'dns') {
    const rtts = result.result ? [result.result.rt] : []
    return { sent: 1, received: rtts.length, rtts }
  }
  const rtts = result.result.flatMap((packet) => ('rtt' in packet ? [packet.rtt] : []))
  return { sent: result.sent, received: Math.min(result.rcvd, result.sent), rtts }
}

export function summarize(results: LatestResult[], nowSeconds: number, maxAgeSeconds: number): CellStats {
  const fresh = results.filter((result) => nowSeconds - result.timestamp <= maxAgeSeconds)
  let sent = 0
  let received = 0
  const rtts: number[] = []
  for (const result of fresh) {
    const packets = packetsOf(result)
    sent += packets.sent
    received += packets.received
    rtts.push(...packets.rtts)
  }
  rtts.sort((a, b) => a - b)

  return {
    results: fresh.length,
    probes: new Set(fresh.map((result) => result.prb_id)).size,
    sent,
    received,
    lossPct: sent ? (100 * (sent - received)) / sent : null,
    medianMs: rtts.length ? median(rtts) : null,
    minMs: rtts.length ? rtts[0] : null,
    maxMs: rtts.length ? rtts[rtts.length - 1] : null,
    newestTimestamp: fresh.length ? Math.max(...fresh.map((result) => result.timestamp)) : null,
  }
}

const SEVERITY: Health[] = ['good', 'warn', 'bad']

function worse(a: Health, b: Health): Health {
  return SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b
}

function rateLatency(medianMs: number | null, limits: LatencyLimits): Health {
  if (medianMs === null) return 'bad' // results exist but every packet was lost
  if (medianMs <= limits.goodMs) return 'good'
  if (medianMs <= limits.warnMs) return 'warn'
  return 'bad'
}

function rateLoss(lossPct: number | null, loss: LossThresholds): Health {
  if (lossPct === null || lossPct <= loss.warnPct) return 'good'
  if (lossPct <= loss.badPct) return 'warn'
  return 'bad'
}

export function rate(
  stats: CellStats,
  limits: LatencyLimits,
  loss: LossThresholds,
  minSamples: number,
): Health {
  if (stats.results < minSamples) return 'nodata'
  return worse(rateLatency(stats.medianMs, limits), rateLoss(stats.lossPct, loss))
}
