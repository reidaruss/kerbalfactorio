// GP-533. The scanning antenna's row in the one atomic save slot (DW-17),
// `LaunchPadSave.ts`'s own shape: an antenna holds nothing, so its whole
// state is where it stands and which way it faces, and nothing here PAYS --
// the cost was spent when it was built.
//
// THE REVEAL ITSELF LIVES ELSEWHERE, DELIBERATELY. Which sites are known is
// `poi.h`'s own state (WG-151), saved and restored through `poiAbi` in
// Persist.ts directly, not through this file: an antenna's transform and the
// ruins it revealed are two different facts that happen to share a cause, and
// conflating them here would make the antenna's row the second authority on
// what the player has scanned. `rebuildRevealMarkers` below re-derives the
// DRAWABLE consequence of that already-restored fact (the map markers), which
// is not persisted at all -- `MarkerRegistry` is rebuilt from `Sites` on every
// load, never serialized, for the reason its own call site states.

import * as THREE from 'three';
import type { Antennas, ScanAntenna } from './Antennas.js';
import type { SaveStation } from './SaveGame.js';
import { Sites } from '../world/Sites.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { markerRegistry } from './MarkerRegistry.js';
import { markerFor } from './PoiMarkers.js';

export function saveAntennas(antennas: Antennas): SaveStation[] {
  return antennas.list.map((at: ScanAntenna) => ({
    pos: [at.pos.x, at.pos.y, at.pos.z],
    quat: [at.quat.x, at.quat.y, at.quat.z, at.quat.w],
  }));
}

/** Put the saved antennas back. Returns how many came back. Resets first, so
 *  a load into a live world cannot double them (`LaunchPadSave.restorePads`'s
 *  own discipline). */
export function restoreAntennas(antennas: Antennas,
                                rows: readonly SaveStation[] | undefined): number {
  antennas.reset();
  if (rows === undefined) return 0;
  let n = 0;
  for (const r of rows) {
    const at = antennas.restore(
      { x: r.pos[0], y: r.pos[1], z: r.pos[2] },
      new THREE.Quaternion(r.quat[0], r.quat[1], r.quat[2], r.quat[3]));
    if (at !== null) n++;
  }
  return n;
}

/**
 * GP-533. REBUILT, NEVER RELOADED. `MarkerRegistry` is a module-level
 * singleton (GP-520) with no `bodyId` per record, so it survives a body
 * switch this restore does not, and a stale marker left standing on the
 * wrong body would be the GP-650 defect class again. Cleared, then rebuilt
 * from `Sites`' own `known` bit for the body actually being restored.
 * Call AFTER the poi bytes are loaded (Persist.ts's step 0c), or every site
 * reads unknown and this clears the map for nothing.
 */
export function rebuildRevealMarkers(M: OfCoreModule, bodyHandle: number): void {
  markerRegistry.clear();
  const sites = new Sites(M, bodyHandle);
  if (!sites.live) return;
  for (const row of sites.rows()) {
    if (sites.known(row)) markerRegistry.add(markerFor(row));
  }
}
