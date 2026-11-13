// Types for the subset of the RIPE Atlas v2 API this project uses.
// Shapes were taken from real responses (Nov 2026), not from docs.

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface Anchor {
  id: number
  probe: number
  fqdn: string
  hostname: string
  ip_v4: string | null
  as_v4: number | null
  ip_v6: string | null
  as_v6: number | null
  city: string
  country: string
  company: string
  geometry: { type: 'Point'; coordinates: [longitude: number, latitude: number] }
  is_disabled: boolean
  date_decommissioned: string | null
}

export interface Probe {
  id: number
  asn_v4: number | null
  country_code: string
  is_anchor: boolean
  status: { id: number; name: string } // 1 = Connected
  status_since: number
  tags: { name: string; slug: string }[]
}

export interface Measurement {
  id: number
  af: 4 | 6
  type: 'ping' | 'traceroute' | 'dns' | 'http' | string
  target: string
  target_ip: string
  interval: number
  description: string | null
  tags?: string[]
  participant_count?: number | null
  query_type?: string
  query_argument?: string
  protocol?: string
}

// One entry of a ping result's `result` array. Lost packets are `{ x: "*" }`,
// errors are `{ error: "..." }`; successful ones carry `rtt` (and sometimes `ttl`).
// Duplicate replies carry `dup: 1` and must not count as an extra received packet.
export type PingPacket = { rtt: number; ttl?: number; dup?: number } | { x: '*' } | { error: string }

// Element of GET /measurements/{id}/latest/ for a ping measurement.
// `avg/min/max` are -1 when every packet was lost; `avg` may be an int.
export interface PingResult {
  type: 'ping'
  msm_id: number
  prb_id: number
  from: string
  dst_addr: string
  timestamp: number // unix seconds
  stored_timestamp?: number
  sent: number
  rcvd: number
  dup: number
  avg: number
  min: number
  max: number
  result: PingPacket[]
}

export interface DnsAnswer {
  TYPE: string
  NAME: string
  RDATA?: string[]
}

// Element of /latest/ for a DNS measurement. `result.rt` is the query RTT in ms;
// timeouts show up as `error: { timeout: 5000 }` with no `result`. For the
// built-in hostname.bind queries, the TXT answer names the anycast instance.
export interface DnsResult {
  type: 'dns'
  msm_id: number
  prb_id: number
  from: string
  dst_addr: string
  timestamp: number
  result?: { rt: number; size: number; ANCOUNT?: number; answers?: DnsAnswer[] }
  error?: Record<string, unknown>
}

export type LatestResult = PingResult | DnsResult
