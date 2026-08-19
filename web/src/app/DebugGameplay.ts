// The gameplay half of window.__of, split out when the demolition and audio
// surfaces landed and Debug.ts crossed the 400-line cap.
//
// EVERY ENTRY HERE GOES THROUGH THE PLAYER'S OWN PATH. `build(n)` is the number
// key, `demolish` is the X key's handler, `craft` is the panel button. A probe
// that reached past these into the sim would be verifying a path no player can
// take, which is the quiet way an acceptance test stops meaning anything.
//
// GP-1075. AND IT IS NOW A COMPOSITION OF THIRTEEN SUB-APIS RATHER THAN ONE
// 850-LINE OBJECT LITERAL, on the shape `of.ruins()` and `of.sites()` already
// use: one builder per concern, each taking the same `Services`, each in its
// own file under the 400-line cap.
//
// THE SPREAD ORDER IS THE PUBLISHED ORDER AND IS LOAD-BEARING. `Object.keys`
// on `window.__of` is a shape a probe can read, and an object spread preserves
// insertion order, so each sub-API below holds a CONTIGUOUS run of the
// original file's properties and the runs appear here in the original's own
// sequence. The composed object is property-for-property identical, names,
// order and behaviour alike; that was proven by diffing `Object.keys` from a
// real page before and after the split, not by reading this comment.
//
// WHERE THE GROUPS COME FROM. They are cut along what a probe ASKS ABOUT, not
// along the file's reading order, and every boundary already fell on a blank
// line in the original: the pack, the hand, the things standing in the world,
// the lattices, the per-tick traces, the station's record, seating a walker,
// gravity, damage and demolition, sound, the save slot, the first minute, and
// the ground's own material.
import { packApi } from './DebugPack.js';
import { handApi } from './DebugHand.js';
import { placedApi } from './DebugPlaced.js';
import { gridApi } from './DebugGrid.js';
import { tracesApi } from './DebugTraces.js';
import { stationApi } from './DebugStation.js';
import { seatApi } from './DebugSeat.js';
import { gravityApi } from './DebugGravity.js';
import { harmApi } from './DebugHarm.js';
import { audioApi } from './DebugAudio.js';
import { saveApi } from './DebugSave.js';
import { goalsApi } from './DebugGoals.js';
import { harvestApi } from './DebugHarvest.js';
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';

export function gameplayApi(s: Services, loop: Loop) {
  return {
    ...packApi(s),
    ...handApi(s),
    ...placedApi(s),
    ...gridApi(s),
    ...tracesApi(s),
    ...stationApi(s, loop),
    ...seatApi(s, loop),
    ...gravityApi(s),
    ...harmApi(s),
    ...audioApi(s),
    ...saveApi(s),
    ...goalsApi(s),
    ...harvestApi(s, loop),
  };
}
