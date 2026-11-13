// Builds the /snapshot.json response. The ETag comes from the snapshot's
// generatedAt (stored as blob metadata), so a page that already has the
// current snapshot gets a body-less 304 instead of the full ~200 KB again.

export interface SnapshotReader {
  getMetadata(key: string): Promise<{ metadata: Record<string, unknown> } | null>
  getWithMetadata(key: string): Promise<{ data: string; metadata: Record<string, unknown> } | null>
}

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, must-revalidate',
  // The CDN keeps it for a minute, so however many people visit, this
  // function runs about once a minute per edge and Atlas is never touched.
  'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=60, stale-while-revalidate=300',
}

export function etagFor(metadata: Record<string, unknown>): string | null {
  const generatedAt = metadata.generatedAt
  return typeof generatedAt === 'number' ? `"snapshot-${generatedAt}"` : null
}

// If-None-Match may list several tags, and a CDN that compresses the body may
// have weakened ours to W/"…"; either still means the client has this snapshot.
export function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  return ifNoneMatch.split(',').some((tag) => {
    const trimmed = tag.trim()
    return trimmed === '*' || trimmed.replace(/^W\//, '') === etag
  })
}

export async function snapshotResponse(request: Request, reader: SnapshotReader, key: string): Promise<Response> {
  const current = await reader.getMetadata(key)
  const currentEtag = current && etagFor(current.metadata)
  if (currentEtag && matchesEtag(request.headers.get('if-none-match'), currentEtag)) {
    return new Response(null, { status: 304, headers: { ...CACHE_HEADERS, ETag: currentEtag } })
  }

  // Read body and metadata together so the ETag always describes this body.
  const stored = await reader.getWithMetadata(key)
  if (!stored) {
    return Response.json({ error: 'No snapshot yet' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  const etag = etagFor(stored.metadata)
  return new Response(stored.data, {
    headers: { 'Content-Type': 'application/json', ...CACHE_HEADERS, ...(etag ? { ETag: etag } : {}) },
  })
}
