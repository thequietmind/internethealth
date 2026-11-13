// Discovers anchor-mesh and built-in root-server measurement IDs plus home-ISP
// probe IDs from the public RIPE Atlas API, and writes src/config.generated.json.
//
//   yarn discover
//
// Read-only: it never creates measurements. Runs directly on Node >= 23.6
// (native TypeScript type stripping), so only `import type` from src/.

import { writeFile } from 'node:fs/promises'
import type { Anchor, Measurement, Paginated, PingResult, Probe } from '../src/atlas/types.ts'
import type {
  BackboneAnchor,
  GeneratedConfig,
  HomeIsp,
  RootServer,
} from '../src/atlas/generatedConfig.ts'

const API = 'https://atlas.ripe.net/api/v2'
const OUTPUT = new URL('../src/config.generated.json', import.meta.url)
const MAX_PROBES_PER_ISP = 100 // keeps the union of probe IDs in one URL < ~4 KB
const FRESH_SECONDS = 15 * 60

// --- What we want ----------------------------------------------------------

// Each wish lists the wanted ASNs first. If none of them has a live anchor,
// `fallback` is used and the entry is marked as a substitute.
// `prefer` is a substring matched against the anchor FQDN to pick a site.
interface BackboneWish {
  label: string
  wanted: string
  asns: number[]
  prefer?: string
  fallback?: { label: string; asn: number; prefer?: string }
}

const BACKBONE: BackboneWish[] = [
  { label: 'Arelion', wanted: 'Arelion AS1299', asns: [1299], prefer: 'us-' },
  { label: 'NTT', wanted: 'NTT AS2914', asns: [2914], prefer: 'us-' },
  { label: 'Hurricane Electric', wanted: 'Hurricane Electric AS6939', asns: [6939], prefer: 'us-' },
  { label: 'Cogent', wanted: 'Cogent AS174', asns: [174], prefer: 'us-' },
  {
    label: 'Lumen',
    wanted: 'Lumen AS3356',
    asns: [3356, 3549, 209],
    fallback: { label: 'PCCW Global', asn: 3491, prefer: 'us-rtv' },
  },
  {
    label: 'Zayo',
    wanted: 'Zayo AS6461',
    asns: [6461],
    fallback: { label: 'GTT', asn: 3257 },
  },
  {
    label: 'Tata',
    wanted: 'Tata AS6453',
    asns: [6453],
    fallback: { label: 'Deutsche Telekom', asn: 3320, prefer: 'de-fra-as3320.' },
  },
]

const HOME_ISPS: Omit<HomeIsp, 'probeIds' | 'probeAsns' | 'connectedProbes'>[] = [
  { key: 'comcast', name: 'Comcast', asns: [7922] },
  // Charter still announces legacy Time Warner Cable / Bright House ASNs.
  {
    key: 'charter',
    name: 'Charter',
    asns: [20115, 11427, 11426, 12271, 20001, 10796, 11351, 33363],
  },
  { key: 'att', name: 'AT&T', asns: [7018] },
  { key: 'verizon', name: 'Verizon', asns: [701] },
  { key: 'centurylink', name: 'CenturyLink', asns: [209] },
  { key: 'frontier', name: 'Frontier', asns: [5650] },
  { key: 'cox', name: 'Cox', asns: [22773] },
]

const ROOT_LETTERS = 'ABCDEFGHIJKLM'.split('')

// --- HTTP ------------------------------------------------------------------

async function getJson<T>(url: string): Promise<T> {
  const fullUrl = url.startsWith('http') ? url : `${API}${url}`
  const response = await fetch(fullUrl, { headers: { 'User-Agent': 'internethealth-discover' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${fullUrl}`)
  return (await response.json()) as T
}

async function getAllPages<T>(url: string): Promise<T[]> {
  const items: T[] = []
  let next: string | null = url
  while (next) {
    const page: Paginated<T> = await getJson<Paginated<T>>(next)
    items.push(...page.results)
    next = page.next
  }
  return items
}

// --- Backbone --------------------------------------------------------------

async function connectedAnchorProbeIds(): Promise<Set<number>> {
  const probes = await getAllPages<Probe>('/probes/?is_anchor=true&status=1&fields=id&page_size=500')
  return new Set(probes.map((probe) => probe.id))
}

function pickAnchor(anchors: Anchor[], asns: number[], prefer?: string): Anchor | undefined {
  const candidates = anchors.filter((anchor) => anchor.as_v4 !== null && asns.includes(anchor.as_v4))
  if (!prefer) return candidates[0]
  return candidates.find((anchor) => anchor.fqdn.includes(prefer)) ?? candidates[0]
}

async function findMeshPing(fqdn: string): Promise<Measurement> {
  const page = await getJson<Paginated<Measurement>>(
    `/measurements/?target=${fqdn}&type=ping&af=4&status=2&tags=mesh`,
  )
  const meshPing = page.results.find((measurement) => measurement.tags?.includes('mesh'))
  if (!meshPing) throw new Error(`No IPv4 mesh ping found for ${fqdn}`)
  return meshPing
}

async function discoverBackbone(): Promise<BackboneAnchor[]> {
  const all = await getAllPages<Anchor>('/anchors/?page_size=500')
  const enabled = all.filter((anchor) => !anchor.is_disabled && anchor.ip_v4)
  const connected = await connectedAnchorProbeIds()
  const live = enabled.filter((anchor) => connected.has(anchor.probe))
  console.log(`anchors: ${all.length} total, ${enabled.length} enabled, ${live.length} connected`)

  const chosen: BackboneAnchor[] = []
  for (const wish of BACKBONE) {
    const direct = pickAnchor(live, wish.asns, wish.prefer)
    const anchor = direct ?? (wish.fallback && pickAnchor(live, [wish.fallback.asn], wish.fallback.prefer))
    if (!anchor) {
      console.warn(`  ${wish.wanted}: no live anchor and no usable fallback, skipped`)
      continue
    }
    const meshPing = await findMeshPing(anchor.fqdn)
    const label = direct ? wish.label : wish.fallback!.label
    console.log(`  ${wish.wanted} -> ${label} ${anchor.fqdn} (msm ${meshPing.id})`)
    chosen.push({
      label,
      asn: anchor.as_v4!,
      wanted: wish.wanted,
      substitute: !direct,
      anchorId: anchor.id,
      probeId: anchor.probe,
      fqdn: anchor.fqdn,
      ipv4: anchor.ip_v4!,
      city: anchor.city,
      country: anchor.country,
      company: anchor.company,
      latitude: anchor.geometry.coordinates[1],
      longitude: anchor.geometry.coordinates[0],
      af: meshPing.af,
      pingMsmId: meshPing.id,
      pingInterval: meshPing.interval,
    })
  }
  return chosen
}

// Verifies that each chosen anchor actually reports fresh results to every
// other chosen anchor. Returns "source->target" => fresh result count (0 or 1).
async function checkMeshCoverage(anchors: BackboneAnchor[]): Promise<Record<string, number>> {
  const probeIds = anchors.map((anchor) => anchor.probeId).join(',')
  const now = Date.now() / 1000
  const coverage: Record<string, number> = {}
  for (const target of anchors) {
    const results = await getJson<PingResult[]>(
      `/measurements/${target.pingMsmId}/latest/?probe_ids=${probeIds}`,
    )
    for (const source of anchors) {
      if (source === target) continue
      const fresh = results.filter(
        (result) => result.prb_id === source.probeId && now - result.timestamp < FRESH_SECONDS,
      )
      coverage[`${source.label}->${target.label}`] = fresh.length
    }
  }
  return coverage
}

// --- Root servers ----------------------------------------------------------

function rootLetter(host: string): string | undefined {
  const match = /^([a-m])\.root-servers\.net$/i.exec(host)
  return match?.[1].toUpperCase()
}

// The built-in UDP hostname.bind query (every 240 s). Its answer names the
// anycast instance that replied, and its RTT stands in when ping is filtered.
async function findHostnameBind(host: string): Promise<Measurement | undefined> {
  const dnsMeasurements = await getAllPages<Measurement>(
    `/measurements/?target=${host}&type=dns&af=4&status=2`,
  )
  return dnsMeasurements.find(
    (measurement) => measurement.protocol === 'UDP' && measurement.query_argument === 'hostname.bind',
  )
}

async function discoverRoots(): Promise<RootServer[]> {
  // Built-in measurements have low IDs; one page covers them.
  const pings = await getAllPages<Measurement>(
    '/measurements/?id__lt=10000&type=ping&af=4&status=2&page_size=200',
  )
  const servers: RootServer[] = []
  for (const letter of ROOT_LETTERS) {
    const host = `${letter.toLowerCase()}.root-servers.net`
    const ping = pings.find((measurement) => rootLetter(measurement.target) === letter)
    const dns = await findHostnameBind(host)
    if (!dns) console.warn(`  ${letter}-root: no built-in hostname.bind measurement`)
    if (ping) {
      servers.push({
        letter,
        host,
        af: ping.af,
        targetIp: ping.target_ip,
        msmId: ping.id,
        kind: 'ping',
        interval: ping.interval,
        dnsMsmId: dns?.id ?? null,
        dnsInterval: dns?.interval ?? 0,
      })
      continue
    }
    // No ping (G-root drops ICMP): the hostname.bind query is the only RTT source.
    if (!dns) {
      console.warn(`  ${letter}-root: no built-in ping or DNS measurement, skipped`)
      continue
    }
    console.log(`  ${letter}-root: no ping, using DNS msm ${dns.id} (${dns.query_argument} ${dns.query_type})`)
    servers.push({
      letter,
      host,
      af: dns.af,
      targetIp: dns.target_ip,
      msmId: dns.id,
      kind: 'dns',
      interval: dns.interval,
      dnsMsmId: dns.id,
      dnsInterval: dns.interval,
    })
  }
  return servers
}

// --- Home ISPs -------------------------------------------------------------

const EXCLUDED_TAGS = new Set(['datacentre', 'data-center', 'datacenter', 'system-anchor'])

function isHomeProbe(probe: Probe): boolean {
  if (probe.is_anchor) return false
  if (probe.country_code !== 'US') return false
  return !probe.tags.some((tag) => EXCLUDED_TAGS.has(tag.slug))
}

async function discoverIsp(isp: (typeof HOME_ISPS)[number]): Promise<HomeIsp> {
  const probes: Probe[] = []
  for (const asn of isp.asns) {
    probes.push(
      ...(await getAllPages<Probe>(
        `/probes/?asn_v4=${asn}&status=1&page_size=500&fields=id,asn_v4,country_code,is_anchor,status,status_since,tags`,
      )),
    )
  }
  const home = probes.filter(isHomeProbe)
  // Longest-connected first: those tend to be the most stable.
  const probeIds = home
    .sort((a, b) => a.status_since - b.status_since)
    .slice(0, MAX_PROBES_PER_ISP)
    .map((probe) => probe.id)
  const probeAsns = Object.fromEntries(home.map((probe) => [probe.id, probe.asn_v4 ?? 0]))
  console.log(`  ${isp.name}: ${home.length} connected US home probes, using ${probeIds.length}`)
  return {
    ...isp,
    probeIds,
    probeAsns: Object.fromEntries(probeIds.map((id) => [id, probeAsns[id]])),
    connectedProbes: home.length,
  }
}

// --- Main ------------------------------------------------------------------

async function main() {
  console.log('Backbone anchors')
  const anchors = await discoverBackbone()
  const coverage = await checkMeshCoverage(anchors)
  const missing = Object.entries(coverage).filter(([, count]) => count === 0)
  console.log(`  mesh coverage: ${Object.keys(coverage).length - missing.length}/${Object.keys(coverage).length} pairs fresh`)
  for (const [pair] of missing) console.log(`    no fresh result: ${pair}`)

  console.log('Root servers')
  const servers = await discoverRoots()

  console.log('Home ISPs')
  const isps: HomeIsp[] = []
  for (const isp of HOME_ISPS) isps.push(await discoverIsp(isp))

  const config: GeneratedConfig = {
    generatedAt: new Date().toISOString(),
    backbone: { anchors, coverage },
    roots: { servers, isps },
  }
  await writeFile(OUTPUT, JSON.stringify(config, null, 2) + '\n')
  console.log(`Wrote ${OUTPUT.pathname}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
