# Internet Health Report

A local, real-time "how healthy is the internet right now" dashboard, in the spirit of the
old Keynote internethealthreport.com carrier matrix. It reads public
[RIPE Atlas](https://atlas.ripe.net/) results and renders two colour-coded grids. It has no backend,
database, history, account or API key, and it never creates measurements.

## Run

```bash
yarn
yarn dev
```

Open the URL Vite prints (default http://localhost:5173). The page fetches on load. After that,
it refreshes on the **Auto-refresh** schedule you pick in the header: off, every 15 minutes, every
30 minutes (the default), or every hour. It only refreshes while the tab is visible, and the
browser remembers your choice. **Refresh** fetches immediately. The default and the choices live in
`src/thresholds.ts`. These two controls only appear in live mode; in snapshot mode the page
follows the snapshot schedule instead (see below).

In dev, each refresh reads Atlas directly ("live" mode): 20 GET requests (7 backbone + 13 root
servers), plus one DNS request per root column that shows ping loss, at most 4 in flight. Each
request is filtered to only the probes we need.

### The Atlas proxy

In live mode, requests go to `/atlas/*`, which the Vite dev server proxies to
`https://atlas.ripe.net/api/v2/*` (see `vite.config.ts`). Atlas does in fact send CORS headers (it
echoes back the request `Origin`), so the proxy isn't strictly required. It's kept so the app makes
same-origin requests and doesn't depend on that behaviour. Production builds don't use it: they
read the shared snapshot instead (see below).

## Deploying: the shared snapshot

A public page must not call Atlas once per visitor; a busy day would multiply the load on a
volunteer-supported platform for data that only changes every 4 minutes. So production builds
read one shared snapshot, and Atlas load stays fixed however many people look:

- **`netlify/functions/snapshot-refresh.ts`** is a Netlify scheduled function. It runs every 5
  minutes, offset from the hour (`2-59/5 * * * *`: :02, :07, …), builds the same report the page
  builds in live mode, and stores it in Netlify Blobs. That's about 26–33 requests per run, or
  roughly 300–400 an hour.
- **`netlify/functions/snapshot.ts`** serves it at `/snapshot.json`. The CDN caches it for a
  minute, so visitor traffic reaches the function at most about once a minute per edge.
- **The page** reads `snapshot.json` on load, then checks again about a minute after the next
  snapshot is due (once it's due, every minute until it appears). There's no Refresh button or
  auto-refresh menu in this mode, because clicking couldn't make the data any newer. The header
  shows when the snapshot was taken and when the next one is expected. Ratings and freshness are
  computed at snapshot time. If no new snapshot has arrived 12 minutes after the last one (the job
  is failing or backing off), the header quietly says the next one is running late.
- **Checks are cheap.** The endpoint sends an `ETag` built from the snapshot's time (stored as blob
  metadata), so a check that finds nothing new gets a body-less `304` instead of the full
  snapshot again.

The snapshot function is a polite Atlas client:

- **It identifies itself** with `User-Agent: internethealth-snapshot/1.0 (+<contact>)`. The contact
  is Netlify's `URL` (the site's address), or set `SNAPSHOT_CONTACT` in the site's environment
  variables to an email address or project page.
- **It never retries.** The first 429, 5xx or network error stops the whole run, and nothing more is
  sent. The previous snapshot stays in place (and goes stale on the page).
- **It backs off.** After a failed run it waits 5, 10, 20, 40, then 60 minutes between attempts,
  or longer if Atlas sends `Retry-After`. A successful run resets this. A run that takes longer
  than 25 s is stopped and counts as a failure (Netlify allows scheduled functions 30 s).

To deploy, create a Netlify site from this repo; `netlify.toml` sets the build. Scheduled
functions only run on the published production deploy, so `/snapshot.json` returns 503 until the
first run (within 5 minutes). The function logs one JSON line per run (`written`, `skipped` or
`failed`, with the reason) in the Netlify functions log.

The snapshot JSON is about 1.7 MB (about 200 KB compressed), mostly the per-probe rows behind the
inspector.

### Snapshot mode locally

The data source is chosen by `VITE_DATA_SOURCE` (`live` or `snapshot`). It defaults to `live` in
dev and `snapshot` in builds. To run the page locally exactly as the production site runs it:

```bash
yarn snapshot       # build a snapshot from Atlas into public/snapshot.json (git-ignored)
yarn dev:snapshot   # dev server that reads it (VITE_DATA_SOURCE=snapshot via .env.snapshot)
```

`yarn snapshot` runs the same code as the Netlify job, User-Agent and stop-on-error included, but
writes a file instead of a blob. Nothing reruns it on a schedule, so after 12 minutes the header
says the next snapshot is running late, which is also how you test that note. Run `yarn snapshot` again while
the page is open and it picks up the new snapshot on its next check, as the live site does.

## Rerun discovery

```bash
yarn discover
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
- **There's no history.** Each cell is a snapshot of the latest results, a few minutes old at most
  (up to about 10 minutes when reading the shared snapshot).
  There's no baseline, so "unusual for this pair" isn't detected. Only the thresholds are.

## Layout

```
scripts/discover.ts          discovery → src/config.generated.json
src/thresholds.ts            all tunables, including the snapshot schedule and back-off
src/atlas/                   API types, fetch + concurrency, generated-config types
src/health/stats.ts          per-cell aggregation and rating
src/health/report.ts         builds both grid models from one batch of requests
src/health/snapshot.ts       snapshot JSON format (shared by page and function)
src/health/source.ts         live vs snapshot data source and refresh schedules
src/health/useHealthReport.ts  polling hook
src/components/              grid, tooltip, inspector, controls
netlify/functions/           scheduled snapshot job and the /snapshot.json endpoint
netlify/snapshot/            the snapshot run, back-off, Blobs storage, and the ETag response
scripts/snapshot.ts          local snapshot → public/snapshot.json
```
