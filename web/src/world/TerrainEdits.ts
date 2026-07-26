// The terrain worker's EDIT channel: everything that tells the worker its copy
// of the world changed, and nothing else.
//
// Split out of TerrainStream when levelling and the restore sync pushed that
// file over the 400-line cap, and it is a real seam rather than a filing
// convenience: TerrainStream owns the RESIDENT SET, this owns the fact that a
// second WASM instance holds a second copy of the edits (DW-16) and has to be
// kept honest about it.
//
// TWO SHAPES, AND THE DIFFERENCE MATTERS. `digAt` and `levelAt` are OPS: an
// increment the worker applies to what it already has. `syncEdits` is STATE: the
// authoritative bytes, replacing whatever the worker had. Ops are cheap and are
// how live play stays in step; state is how a save restore is reconciled,
// because after one the op log is a history of a world the worker is no longer
// in. Replaying it would be redundant for a dig and WRONG for a level, which the
// log records with a bounding radius: replayed as a dig it would carve a 13 m
// sphere out of the pad it describes.
//
// Every message counts on `sent`, and the worker's replies count on `applied`.
// sent != applied means an edit never landed, so the heightfield still believes
// in ground the voxel layer has already moved.

import type { Vec3d } from './PlanetBody.js';

export class TerrainEditChannel {
  /** Messages posted, and replies seen. Equal means nothing was lost. */
  sent = 0;
  applied = 0;

  constructor(
    private readonly worker: Worker,
    /** Borrowed from TerrainStream so ops and observes share one sequence. */
    private readonly nextSeq: () => number,
  ) {}

  /** Replay one dig brush. */
  digAt(x: number, y: number, z: number, radiusM: number): void {
    this.sent++;
    this.worker.postMessage({ type: 'dig', seq: this.nextSeq(), x, y, z, radiusM });
  }

  /** Replay one levelling disc. */
  levelAt(x: number, y: number, z: number, radiusM: number, targetHeightM: number,
          maxCutM: number, maxFillM: number): void {
    this.sent++;
    this.worker.postMessage({
      type: 'level', seq: this.nextSeq(), x, y, z, radiusM,
      targetHeightM, maxCutM, maxFillM,
    });
  }

  /**
   * Replace the worker's whole edit set from /core's own persistence bytes and
   * re-mesh what is near the observer. `bytes` is TRANSFERRED, so the caller
   * must not touch it afterwards.
   */
  syncEdits(bytes: Uint8Array, observer: Vec3d, radiusM: number): void {
    this.sent++;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.worker.postMessage({
      type: 'edits', seq: this.nextSeq(), bytes: buf,
      x: observer.x, y: observer.y, z: observer.z, radiusM,
    }, [buf]);
  }
}
