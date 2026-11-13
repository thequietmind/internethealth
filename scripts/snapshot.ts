// Builds a snapshot from live Atlas data with the same code the Netlify job
// uses, and writes it to public/snapshot.json for `yarn dev:snapshot`.
//
//   yarn snapshot
//
// Rerun it while the dev server is open and the page picks up the new
// snapshot on its next check. Read-only against Atlas, like the job.
//
// The report code imports JSON without import attributes, which plain Node
// can't load, so the job's modules are loaded through Vite instead.
import { writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

const OUTPUT = 'public/snapshot.json'
const USER_AGENT = 'internethealth-snapshot/1.0 (+local development)'

interface Outcome {
  status: 'written' | 'skipped' | 'failed'
  [detail: string]: unknown
}

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { runSnapshot } = await vite.ssrLoadModule('/netlify/snapshot/run.ts')
  const { NO_BACKOFF } = await vite.ssrLoadModule('/netlify/snapshot/backoff.ts')

  // No back-off state between local runs; each run is a deliberate retry.
  const store = {
    readBackoff: async () => NO_BACKOFF,
    writeBackoff: async () => {},
    writeSnapshot: async (snapshot: unknown) => writeFile(OUTPUT, JSON.stringify(snapshot)),
  }
  const outcome = (await runSnapshot(store, USER_AGENT)) as Outcome
  console.log(outcome.status === 'written' ? `Wrote ${OUTPUT}:` : 'No snapshot written:', outcome)
  if (outcome.status !== 'written') process.exitCode = 1
} finally {
  await vite.close()
}
