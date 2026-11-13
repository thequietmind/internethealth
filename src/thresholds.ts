// Every tunable number in the app lives here.

// Auto-refresh choices offered in the header dropdown, in minutes (0 = off).
// Atlas built-ins run every 4 minutes, so shorter intervals add little.
export const REFRESH_OPTIONS_MINUTES = [0, 15, 30, 60] as const
export type RefreshMinutes = (typeof REFRESH_OPTIONS_MINUTES)[number]
export const DEFAULT_REFRESH_MINUTES: RefreshMinutes = 30
export const MAX_CONCURRENT_REQUESTS = 4

// Production reads one shared snapshot instead of calling Atlas per visitor.
// A scheduled function rebuilds it every `intervalMinutes`; the cron expression
// in netlify/functions/snapshot-refresh.ts must match. The page warns once the
// snapshot is older than `staleAfterMinutes` (two missed runs plus slack).
export const SNAPSHOT = {
  intervalMinutes: 5,
  staleAfterMinutes: 12,
  // Back-off after a throttled (429), failing (5xx) or timed-out run: wait
  // 5, 10, 20, 40, then 60 minutes between attempts, or longer if Atlas sends
  // Retry-After. A successful run resets it.
  backoffBaseMinutes: 5,
  backoffMaxMinutes: 60,
  runTimeoutSeconds: 25, // Netlify stops scheduled functions at 30 s
} as const

export interface LossThresholds {
  warnPct: number // loss above this is at least yellow
  badPct: number // loss above this is red
}

// A result is fresh if it is at most `freshRounds × interval + FRESH_SLACK_SECONDS`
// old, using each measurement's own interval.
export const FRESH_SLACK_SECONDS = 60

export interface GridThresholds {
  versions: number // how many recent results per probe to request from /latest/
  freshRounds: number // results older than this many measurement rounds are ignored
  minSamples: number // fewer fresh results than this => gray "no data"
  loss: LossThresholds
}

// Backbone RTT is judged against the physical minimum for the pair: light in
// fibre covers ~200 km/ms, so min RTT ≈ great-circle km / 100. A cell is green
// up to `factor × min + slackMs`. Slack covers same-city pairs that hand off
// traffic in another metro (e.g. HE→Arelion in LA is ~10 ms).
export const BACKBONE = {
  versions: 3, // 3 rounds × 3 packets ≈ last 12 minutes
  freshRounds: 3, // matches `versions`: all requested rounds count
  minSamples: 2,
  latency: {
    good: { factor: 2, slackMs: 15 },
    warn: { factor: 3, slackMs: 30 },
  },
  // ~9 packets per cell: one lost packet (11%) => yellow, two or more => red.
  loss: { warnPct: 1, badPct: 15 },
} satisfies GridThresholds & { latency: unknown }

// Root servers are anycast, so a nearby instance should always be close.
export const ROOTS = {
  versions: 1,
  freshRounds: 2,
  minSamples: 5, // probes in the ISP with a fresh result
  latency: { goodMs: 40, warnMs: 100 },
  // Loss is pooled across ~300 packets. A single dead home probe adds ~1.1%,
  // which is noise, so yellow starts at 2%.
  loss: { warnPct: 2, badPct: 10 },
  // Ping-filtered detection: a probe whose pings get no reply while its
  // hostname.bind query to the same address is answered by the root is
  // "ping filtered". If at least this share of a cell's probes are, the cell is
  // rated on DNS query time and loss instead of ping, and drawn hatched.
  pingFilteredShare: 0.5,
} satisfies GridThresholds & { latency: unknown; pingFilteredShare: number }
