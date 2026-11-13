import type { DnsResult, LatestResult } from '../atlas/types.ts'
import type { LossThresholds } from '../thresholds.ts'

export type Health = 'good' | 'warn' | 'bad' | 'nodata'

export interface CellStats {
  results: number // fresh, usable results (probes × versions)
  excluded: number // fresh results dropped as unusable (local errors, intercepted DNS)
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

// The anycast instance named in a hostname.bind TXT answer, or null when the
// reply carries no identity (typically a home router intercepting DNS).
export function dnsIdentity(result: DnsResult): string | null {
  const txt = result.result?.answers?.find((answer) => answer.TYPE === 'TXT' && answer.RDATA?.length)
  return txt ? txt.RDATA!.join(' ') : null
}

interface Packets {
  sent: number
  received: number
  rtts: number[]
}

// DNS results count as one packet each. Only a timeout is loss; other errors
// (socket, resolver) are local failures, and answers without a hostname.bind
// identity did not come from the root. Both are excluded (null).
function dnsPackets(result: DnsResult): Packets | null {
  if (result.result) {
    return dnsIdentity(result) === null ? null : { sent: 1, received: 1, rtts: [result.result.rt] }
  }
  return result.error && 'timeout' in result.error ? { sent: 1, received: 0, rtts: [] } : null
}

// Ping packets are counted from the per-packet array: `{rtt}` is received
// (duplicates skipped), `{x: "*"}` is lost, `{error}` is a local send failure
// and is excluded. A result with no countable packets is excluded entirely.
function packetsOf(result: LatestResult): Packets | null {
  if (result.type === 'dns') return dnsPackets(result)
  const rtts: number[] = []
  let lost = 0
  for (const packet of result.result) {
    if ('rtt' in packet && !packet.dup) rtts.push(packet.rtt)
    else if ('x' in packet) lost++
  }
  const sent = rtts.length + lost
  return sent ? { sent, received: rtts.length, rtts } : null
}

export function summarize(results: LatestResult[], nowSeconds: number, maxAgeSeconds: number): CellStats {
  const fresh = results.filter((result) => nowSeconds - result.timestamp <= maxAgeSeconds)
  const usable: LatestResult[] = []
  let sent = 0
  let received = 0
  const rtts: number[] = []
  for (const result of fresh) {
    const packets = packetsOf(result)
    if (!packets) continue
    usable.push(result)
    sent += packets.sent
    received += packets.received
    rtts.push(...packets.rtts)
  }
  rtts.sort((a, b) => a - b)

  return {
    results: usable.length,
    excluded: fresh.length - usable.length,
    probes: new Set(usable.map((result) => result.prb_id)).size,
    sent,
    received,
    lossPct: sent ? (100 * (sent - received)) / sent : null,
    medianMs: rtts.length ? median(rtts) : null,
    minMs: rtts.length ? rtts[0] : null,
    maxMs: rtts.length ? rtts[rtts.length - 1] : null,
    newestTimestamp: usable.length ? Math.max(...usable.map((result) => result.timestamp)) : null,
  }
}

// --- Per-probe breakdown (for the inspector; does not affect rating) ---------

export type ProbeStatus = 'no-reply' | 'loss' | 'ok' | 'excluded' | 'stale' | 'no-result'

export interface ProbeRow {
  probeId: number
  asn: number | null
  status: ProbeStatus
  stats: CellStats // over this probe's fresh results only
  lastSeen: number | null // newest result of any age, unix seconds
  instance?: string | null // DNS cells: hostname.bind identity of the newest answer
}

const STATUS_ORDER: ProbeStatus[] = ['no-reply', 'loss', 'excluded', 'stale', 'no-result', 'ok']

function probeStatus(stats: CellStats, anyResults: boolean): ProbeStatus {
  if (!anyResults) return 'no-result'
  if (stats.excluded > 0 && stats.results === 0) return 'excluded'
  if (stats.results === 0) return 'stale'
  if (stats.received === 0) return 'no-reply'
  return stats.received < stats.sent ? 'loss' : 'ok'
}

// One row per expected probe, worst first. "no-result" and "stale" probes are
// listed but never counted as loss.
export function probeRows(
  probeIds: number[],
  asnOf: (probeId: number) => number | null,
  results: LatestResult[],
  nowSeconds: number,
  maxAgeSeconds: number,
): ProbeRow[] {
  const byProbe = new Map<number, LatestResult[]>()
  for (const result of results) {
    byProbe.set(result.prb_id, [...(byProbe.get(result.prb_id) ?? []), result])
  }
  const rows = probeIds.map((probeId): ProbeRow => {
    const own = byProbe.get(probeId) ?? []
    const stats = summarize(own, nowSeconds, maxAgeSeconds)
    const newest = own.reduce<LatestResult | undefined>(
      (latest, result) => (!latest || result.timestamp > latest.timestamp ? result : latest),
      undefined,
    )
    return {
      probeId,
      asn: asnOf(probeId),
      status: probeStatus(stats, own.length > 0),
      stats,
      lastSeen: newest?.timestamp ?? null,
      instance: newest?.type === 'dns' ? dnsIdentity(newest) : undefined,
    }
  })
  return rows.sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      (b.stats.lossPct ?? 0) - (a.stats.lossPct ?? 0) ||
      (b.stats.medianMs ?? 0) - (a.stats.medianMs ?? 0),
  )
}

// --- Rating ----------------------------------------------------------------

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
