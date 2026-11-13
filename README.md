# Internet Health Report

A local, real-time "how healthy is the internet right now" dashboard, in the spirit of the
old Keynote internethealthreport.com carrier matrix. It reads public
[RIPE Atlas](https://atlas.ripe.net/) results and renders two colour-coded grids. It has no backend,
database, history, account or API key, and it never creates measurements.

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (default http://localhost:5173). The page fetches on load. After that,
it refreshes on the **Auto-refresh** schedule you pick in the header: off, every 15 minutes, every
30 minutes (the default), or every hour. It only refreshes while the tab is visible, and the
browser remembers your choice. **Refresh** fetches immediately. The default and the choices live in
`src/thresholds.ts`.

Each refresh is 20 GET requests (7 backbone + 13 root servers), at most 4 in flight. Each one is
filtered to only the probes we need.

### The Atlas proxy

Requests go to `/atlas/*`, which the Vite dev server proxies to `https://atlas.ripe.net/api/v2/*`
(see `vite.config.ts`). Atlas does in fact send CORS headers (it echoes back the request `Origin`),
so the proxy isn't strictly required. It's kept so the app makes same-origin requests and doesn't
depend on that behaviour. `npm run build` output has no proxy, so serve it behind something
equivalent or point `API_BASE` in `src/atlas/client.ts` at Atlas directly.

## Rerun discovery

```bash
npm run discover
```

`scripts/discover.ts` queries the Atlas API and rewrites `src/config.generated.json`:

- **Backbone anchors.** For each entry in the `BACKBONE` wish list at the top of the script, it
  picks a live, connected anchor in the wanted ASN, or the listed fallback. It then finds that
  anchor's IPv4 anchor-mesh ping (`/measurements/?target=<fqdn>&tags=mesh`) and checks that every
  chosen anchor has a fresh result towards every other one.
- **Root servers.** It uses the built-in IPv4 pings to A–M (IDs 1001–1016). G-root doesn't answer
  ICMP, so its column uses the built-in `hostname.bind` DNS query (msm 10314, 240 s), and the DNS
  RTT stands in for ping RTT.
- **Home ISPs.** It collects connected US, non-anchor, non-datacentre probes per ISP, using the 100
  longest-connected per row. Charter merges its legacy TWC/Bright House ASNs.

Edit `BACKBONE` or `HOME_ISPS` in the script to change rows/columns, then rerun it. Discovery
needs Node ≥ 23.6, which runs `.ts` directly.

Current substitutes, because the wanted network has no live anchor: PCCW Global AS3491 (Reston)
for Lumen, GTT AS3257 (Amsterdam) for Zayo, and Deutsche Telekom AS3320 (Frankfurt) for Tata.
Cogent's only live anchor is in Frankfurt. Arelion, NTT and HE are all at one Los Angeles site.

## Tune thresholds

Every number lives in `src/thresholds.ts`:

- **Backbone.** RTT is judged against the speed-of-light-in-fibre minimum for the pair
  (great-circle km / 100 ms). A cell is green up to `2 × min + 15 ms` and yellow up to
  `3 × min + 30 ms`. Each cell uses the last 3 rounds per pair (`versions: 3`, about 9 packets), so
  one lost packet is yellow and two or more are red.
- **Root servers.** These use absolute limits: green ≤ 40 ms, yellow ≤ 100 ms. Loss is pooled
  across every packet from every probe in the ISP. Yellow starts at 2% loss because one dead home
  probe alone contributes about 1%. Red starts at 10%.
- **Both grids.** A result is fresh if it's at most `freshRounds × interval + 60 s` old, using each
  measurement's own interval: 2 rounds for roots, and 3 for the backbone to match `versions`.
  Fewer than `minSamples` fresh results makes a cell gray ("no data"). The worse of the latency
  rating and the loss rating wins.

### What counts as loss

- **Ping.** Packets are counted from the per-packet `result` array. `{rtt}` is received
  (duplicates are skipped), `{x: "*"}` is lost, and `{error}` is a local send failure that's
  excluded. A probe that returned no result at all, or only stale or excluded ones, never counts
  as loss.
- **DNS.** Only a timeout is loss. Other errors are local failures and are excluded. An answer
  with no `hostname.bind` TXT identity didn't come from the root (it's usually a home router
  intercepting DNS), so it's excluded too.

### Ping-filtered cells

Some anycast instances drop ICMP echo but still answer DNS. If a root column shows ping loss, the
app also fetches that root's built-in `hostname.bind` query results for the same probes. A probe
counts as ping-filtered when its pings get no reply but the root answers its DNS query. If at
least `pingFilteredShare` (50%) of a cell's probes are filtered, the cell is rated on DNS query
time and DNS loss instead, and drawn hatched with a "dns" label. The color is still an honest
rating; only the metric changes. Real outages, where DNS fails too (for example, Comcast → I-root
when this was written), stay red on ping.

Hover or focus a cell to see the source and target, median/min/max RTT, loss with packet counts,
probe and result counts, the age of the newest result, and the thresholds applied.

Click a cell (or press Enter on it) to open the inspector, which shows:

- The measurement ID, linked to atlas.ripe.net, plus a link to the exact raw `/latest/` request.
- The address family and target address.
- The freshness window.
- One row per requested probe, worst first, with its ASN, status, median/min/max RTT, packets
  received, and age. Probe statuses are no reply, loss, ok, excluded, stale, and no result.
  Excluded, stale, and no-result probes are listed, but they never count as loss. DNS-rated cells
  also show which anycast instance answered each probe.

## What the grids do and don't mean

- **The backbone matrix is data centre to data centre.** Anchors are servers in well-connected
  facilities, often single-homed to one carrier. A cell shows how that carrier pair is behaving
  between those two sites right now. It says nothing about what home users experience. Three of
  the "carriers" are stand-ins, and with only one anchor per network, a cell is really one path,
  not the whole network.
- **Same-city cells measure hand-offs, not distance.** NTT→Arelion in LA is under 1 ms, while
  HE→Arelion is about 10 ms because that traffic crosses over in another metro.
- **The root grid measures home networks reaching anycast DNS roots.** High RTT usually means the
  ISP's routing picks a distant instance, which isn't necessarily an outage. Sustained loss across
  many probes (for example, a whole ISP losing a root) is the interesting signal.
- **Home-to-CDN-cache paths aren't measurable this way.** Most real traffic goes to CDN caches
  inside or next to the ISP, and nothing here measures those. A red root cell rarely means
  "Netflix is down".
- **There's no history.** Each cell is a snapshot of the latest results, a few minutes old at most.
  There's no baseline, so "unusual for this pair" isn't detected. Only the thresholds are.

## Layout

```
scripts/discover.ts          discovery → src/config.generated.json
src/thresholds.ts            all tunables
src/atlas/                   API types, fetch + concurrency, generated-config types
src/health/stats.ts          per-cell aggregation and rating
src/health/report.ts         builds both grid models from one batch of requests
src/health/useHealthReport.ts  polling hook
src/components/              grid, tooltip, theme toggle
```
