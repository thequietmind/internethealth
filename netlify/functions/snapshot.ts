import { getStore } from '@netlify/blobs'
import { SNAPSHOT_KEY, STORE_NAME } from '../snapshot/store.ts'

// Serves the stored snapshot. Netlify's CDN keeps it for a minute, so visitor
// traffic, however large, reaches this function about once a minute per edge
// and never reaches Atlas.
export default async () => {
  const body = await getStore(STORE_NAME).get(SNAPSHOT_KEY)
  if (body === null) {
    return Response.json({ error: 'No snapshot yet' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=60, stale-while-revalidate=300',
    },
  })
}

export const config = { path: '/snapshot.json' }
