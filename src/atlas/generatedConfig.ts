// Shape of src/config.generated.json, written by scripts/discover.ts.

export interface BackboneAnchor {
  label: string // row/column label, e.g. "Arelion"
  asn: number
  wanted: string // what we were looking for, e.g. "Lumen AS3356"
  substitute: boolean // true when `asn` is not the wanted network
  anchorId: number
  probeId: number // the anchor's probe ID = its ID as a measurement source
  fqdn: string
  ipv4: string
  city: string
  country: string
  company: string
  latitude: number
  longitude: number
  af: 4 | 6
  pingMsmId: number // IPv4 anchor-mesh ping targeting this anchor
  pingInterval: number // seconds
}

export interface RootServer {
  letter: string
  host: string
  af: 4 | 6
  targetIp: string
  msmId: number
  kind: 'ping' | 'dns' // G-root does not answer ICMP; we use its DNS RTT instead
  interval: number
  dnsMsmId: number | null // built-in hostname.bind query to the same address
  dnsInterval: number // seconds; 0 when there is no hostname.bind measurement
}

export interface HomeIsp {
  key: string
  name: string
  asns: number[]
  probeIds: number[]
  probeAsns: Record<string, number> // probe ID -> ASN, for debugging
  connectedProbes: number // before capping
}

export interface GeneratedConfig {
  generatedAt: string
  backbone: { anchors: BackboneAnchor[]; coverage: Record<string, number> }
  roots: { servers: RootServer[]; isps: HomeIsp[] }
}
