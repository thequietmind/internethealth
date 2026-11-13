import { getStore } from '@netlify/blobs'
import { snapshotResponse } from '../snapshot/serve.ts'
import { SNAPSHOT_KEY, STORE_NAME } from '../snapshot/store.ts'

// Serves the stored snapshot, with an ETag so unchanged checks are cheap.
export default async (request: Request) => snapshotResponse(request, getStore(STORE_NAME), SNAPSHOT_KEY)

export const config = { path: '/snapshot.json' }
