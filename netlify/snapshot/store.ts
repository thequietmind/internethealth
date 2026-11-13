import { getStore } from '@netlify/blobs'
import { NO_BACKOFF, type BackoffState } from './backoff.ts'
import type { SnapshotStore } from './run.ts'

export const STORE_NAME = 'snapshots'
export const SNAPSHOT_KEY = 'latest'
const BACKOFF_KEY = 'backoff'

export function blobSnapshotStore(): SnapshotStore {
  // Strong consistency so a run always sees the previous run's back-off state.
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })
  return {
    async readBackoff() {
      return ((await store.get(BACKOFF_KEY, { type: 'json' })) as BackoffState | null) ?? NO_BACKOFF
    },
    async writeBackoff(state) {
      await store.setJSON(BACKOFF_KEY, state)
    },
    async writeSnapshot(snapshot) {
      // generatedAt as metadata lets the endpoint answer 304s without reading the body.
      await store.setJSON(SNAPSHOT_KEY, snapshot, { metadata: { generatedAt: snapshot.generatedAt } })
    },
  }
}
