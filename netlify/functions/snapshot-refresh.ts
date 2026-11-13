import { runSnapshot } from '../snapshot/run.ts'
import { blobSnapshotStore } from '../snapshot/store.ts'

// Who is calling, so RIPE can reach the operator instead of just blocking.
// Netlify sets URL to the site's primary address; SNAPSHOT_CONTACT overrides it
// (an email address or a page about the project). Empty values count as unset,
// since contexts without a value may pass an empty string.
function userAgent(): string {
  const contact = process.env.SNAPSHOT_CONTACT || process.env.URL || 'no contact configured'
  return `internethealth-snapshot/1.0 (+${contact})`
}

export default async () => {
  const outcome = await runSnapshot(blobSnapshotStore(), userAgent())
  console.log(JSON.stringify(outcome))
}

// Every 5 minutes, offset from the hour (:02, :07, …) to avoid the :00 rush.
// Must be a literal for Netlify; keep it in step with SNAPSHOT.intervalMinutes.
export const config = { schedule: '2-59/5 * * * *' }
