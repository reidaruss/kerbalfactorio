// THE SHADOW-LOD LADDER for the harvest nodes, measured off the merged geometry
// the batch is about to draw. Split out of NodeBatch.ts (GP-1086); the function
// keeps the name `ladder` it had as a method, because the probe corpus names it.
//
// It takes the batch registry and the per-file parts as arguments instead of
// reaching through a NodeBatch, which is what lets it run after `build` has
// finished filling both and stay ignorant of everything else on that class.

import type * as THREE from 'three';
import { attachShadowLod, emptyIndex, indexRow, publishLadders, type LodRow }
  from '../render/ShadowLod.js';
import { surfaceDeviation, triCount } from '../render/ShadowLodMeasure.js';
import { VARIANTS, type Batch, type NodePart } from './NodeBatchTypes.js';

/**
 * THE SECOND SAVING ON THE NODES, and it is not the one the tree lane took.
 *
 * `NODE_LOD1_M` / `NODE_LOD2_M` is a DISTANCE ladder and it pays 81.9% on the
 * forest because the trees are spread over a 620 m ring. It does nothing at
 * all for the tree three metres away, which still draws its LOD0 into all
 * three cascades. This is that other half: a cascade whose texels are 211 mm
 * cannot resolve a leaf card either way, whatever the node's distance says.
 *
 * The two COMPOSE and do not fight, because `attachShadowLod` takes the
 * coarser of the two: a node already at LOD2 for distance is never promoted
 * back to LOD1 by a near cascade. Rocks, spires and trees all cast, so all
 * three are in it.
 *
 * WHAT IT ACTUALLY PAYS, measured, and it is small: -470 triangles at the
 * RN-15 camera, -1,880 at Plains and ZERO at Forest. The trees are the reason.
 * `tree_conifer`'s Full variant deviates 925 mm at LOD1 and 3,126 mm at LOD2,
 * and `tree_broadleaf`'s leaf row 1,070 mm, so the crowns are refused at every
 * cascade and only the boulders and spires (58 to 110 mm at LOD1) are ever
 * admitted. A node ladder authored for DISTANCE is not a ladder authored for
 * a 15.47 mm texel, and this is the number that says so.
 */
export function ladder(batches: ReadonlyMap<string, Batch>,
                       partsByFile: ReadonlyMap<string, NodePart[]>,
                       geo: ReadonlyMap<string, THREE.BufferGeometry>): void {
  const rows: LodRow[] = [];
  for (const [family, b] of batches) {
    const ix = emptyIndex();
    for (const [file, parts] of partsByFile) {
      for (const part of parts) {
        if (part.material !== family) continue;
        for (let v = 0; v < VARIANTS.length; ++v) {
          const ids = part.geom[v];
          const base = geo.get(`${file}|${v}|0|${family}`);
          if (base === undefined) continue;
          const row: LodRow = {
            label: `${file}|${VARIANTS[v]}|${family}`,
            ids,
            tris: ids.map((_, l) => {
              const g = geo.get(`${file}|${v}|${l}|${family}`);
              return g === undefined ? 0 : triCount(g);
            }),
            dev: ids.map((_, l) => {
              if (l === 0) return 0;
              const g = geo.get(`${file}|${v}|${l}|${family}`);
              return g === undefined ? Infinity : surfaceDeviation(base, g);
            }),
          };
          rows.push(row);
          indexRow(ix, row);
        }
      }
    }
    attachShadowLod(b.mesh, ix);
  }
  publishLadders('nodes', rows);
}
