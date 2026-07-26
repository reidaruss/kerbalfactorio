// Which resident chunks are HIDDEN by their own four children, and which are
// still dithering in. Split out of TerrainStream (2.2 rule 1) because it is one
// self-contained rule over the resident map and nothing else.
//
// of::TerrainStreamer keeps minResidentDepth shells resident for the WHOLE body
// (that is what gives the far scene a complete planet), so a coarse ancestor and
// its fine descendants are resident SIMULTANEOUSLY and cover the same ground. At
// depth 2 the vertex spacing is 7.3 km, so an ancestor interpolating across a
// ridge sits kilometres ABOVE the fine terrain and renders as a grey mesa
// punched through the landscape.
//
// A chunk is hidden exactly when all four of its children are resident, which is
// precisely when they cover its whole quad. This recurses for free, is
// O(resident), and leaves no hole during streaming because a partially
// subdivided parent stays visible.
//
// CROSS-FADE (ARCHITECTURE.md 4.5 mechanism 3): the parent is held one step
// longer, until all four children have FINISHED dithering in. Without that hold
// there is nothing behind the dither holes and the fade reads as a shimmer
// against the sky instead of as a dissolve between two LODs. That is the whole
// fix for the stream-in pop, and it is four extra characters of condition.

import type { ChunkGeometryPool } from '../render/geometry/ChunkGeometryPool.js';
import type { ChunkView } from './ChunkView.js';

export interface CoverageResult {
  hidden: number;
  fading: number;
}

export function updateCoverage(
  views: Map<string, ChunkView>, pool: ChunkGeometryPool,
  nowSecs: number, fadeSecs: number, shell: boolean,
): CoverageResult {
  let hidden = 0;
  let fading = 0;
  const faded = (key: string): boolean => {
    const c = views.get(key);
    return c !== undefined && (fadeSecs <= 0 || nowSecs - c.fadeT0 >= fadeSecs);
  };
  for (const v of views.values()) {
    if (fadeSecs > 0 && nowSecs - v.fadeT0 < fadeSecs) fading++;
    const [face, depth, qx, qy] = v.key.split(':').map(Number);
    const cd = depth + 1;
    const cx = qx * 2;
    const cy = qy * 2;
    const covered = faded(`${face}:${cd}:${cx}:${cy}`)
      && faded(`${face}:${cd}:${cx + 1}:${cy}`)
      && faded(`${face}:${cd}:${cx}:${cy + 1}`)
      && faded(`${face}:${cd}:${cx + 1}:${cy + 1}`);
    v.setVisible(pool, !covered && (v.isNear || shell));
    if (covered) hidden++;
  }
  return { hidden, fading };
}
