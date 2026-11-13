import type { Cell, GridModel, Report } from './report.ts'

// The JSON the snapshot function stores and the page reads. Ratings and
// freshness are computed when the snapshot is taken; `generatedAt` says when.
export const SNAPSHOT_VERSION = 1

interface SerializedGrid extends Omit<GridModel, 'cells'> {
  cells: [string, Cell][]
}

export interface Snapshot {
  version: typeof SNAPSHOT_VERSION
  generatedAt: number // ms
  backbone: SerializedGrid
  roots: SerializedGrid
  failedRequests: number
}

const serializeGrid = (grid: GridModel): SerializedGrid => ({ ...grid, cells: [...grid.cells] })
const deserializeGrid = (grid: SerializedGrid): GridModel => ({ ...grid, cells: new Map(grid.cells) })

export function toSnapshot(report: Report): Snapshot {
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: report.fetchedAt,
    backbone: serializeGrid(report.backbone),
    roots: serializeGrid(report.roots),
    failedRequests: report.failedRequests,
  }
}

export function fromSnapshot(snapshot: Snapshot): Report {
  if (snapshot.version !== SNAPSHOT_VERSION) throw new Error(`Unsupported snapshot version ${snapshot.version}`)
  return {
    backbone: deserializeGrid(snapshot.backbone),
    roots: deserializeGrid(snapshot.roots),
    fetchedAt: snapshot.generatedAt,
    failedRequests: snapshot.failedRequests,
    source: 'snapshot',
  }
}
