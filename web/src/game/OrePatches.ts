// THE ore-body authority in the client: a typed face over the of_gp_patch_* flat
// C ABI (of_core_api.cpp section 9, ABI 3), which is a thin shim over
// deposits.h §P. No shape, no richness, no rate and no amount is decided here.
//
// WHAT A DEPOSIT IS NOW. Not a boulder you swing at until it disappears: an
// irregular area of GROUND, tens of metres across, holding one pool of one ore,
// richest in the middle and thinning to nothing at the rim. You put a mining
// drill on top of it and it eats the ground under itself. Outcrops are the part
// of the body that breaks the surface, so the patch is visible from a distance
// and a hand still has something to swing at.
//
// STANDING RULE 5 lives in every read below: a scratch view is built AFTER the
// producing call and COPIED before anything else calls into WASM.
//
// SURFACE AUTHORITY (standing rule 1). Everything /core hands back is a UNIT
// DIRECTION, never a height. Whoever draws it asks of_surface_radius for the
// radius along that direction, so a patch that has been dug into or levelled is
// still drawn on the ground it is actually in.

import { scratchF64, type OfCoreModule } from '../sim/wasm/heap.js';

export interface PatchState {
  index: number;
  /** Body-frame metres: the centre, on the surface it was laid out against. */
  centre: { x: number; y: number; z: number };
  /** Unit direction of the centre, and the patch's own tangent basis. */
  dir: { x: number; y: number; z: number };
  t1: { x: number; y: number; z: number };
  t2: { x: number; y: number; z: number };
  radiusM: number;
  /** worldgen::survival::NodeKind, for art selection only. */
  kind: number;
  resource: number;
  grade: number;
  initial: number;
  remaining: number;
}

/** One vertex of the drawable ground skin: a unit direction and its coverage. */
export interface PatchVertex {
  x: number; y: number; z: number; cover: number;
}

/** One piece of the ore body that breaks the surface. */
export interface PatchOutcrop {
  x: number; y: number; z: number;
  scale: number;
  /** How much of the piece is buried, as a fraction of its own size. */
  sink: number;
  cover: number;
}

const V3 = (p: Float64Array, at: number) => ({ x: p[at], y: p[at + 1], z: p[at + 2] });

export class OrePatches {
  constructor(private readonly M: OfCoreModule, private readonly body: number) {}

  clear(): void { this.M._of_gp_patches_clear(); }
  get count(): number { return this.M._of_gp_patches_count(); }

  /**
   * Lay out one patch per kind around `dir`. `edits` is the live voxel handle so
   * every centre is snapped through the surface oracle, not the raw heightfield.
   * Returns the total patch count.
   */
  layout(kinds: readonly number[], dir: { x: number; y: number; z: number },
         spreadM: number, edits = 0): number {
    this.M._of_gp_kinds_reset();
    for (const k of kinds) this.M._of_gp_kinds_push(k);
    return this.M._of_gp_patch_layout(this.body, edits, dir.x, dir.y, dir.z, spreadM);
  }

  patch(i: number): PatchState | null {
    if (this.M._of_gp_patch_state(i) !== 18) return null;
    const p = scratchF64(this.M, 18);
    return {
      index: i,
      centre: V3(p, 0), dir: V3(p, 3), t1: V3(p, 6), t2: V3(p, 9),
      radiusM: p[12], kind: p[13], resource: p[14], grade: p[15],
      initial: p[16], remaining: p[17],
    };
  }

  all(): PatchState[] {
    const out: PatchState[] = [];
    for (let i = 0; i < this.count; ++i) {
      const p = this.patch(i);
      if (p !== null) out.push(p);
    }
    return out;
  }

  /** The ground skin, ring by ring. (rings + 1) * segs vertices. */
  mesh(i: number, rings: number, segs: number): PatchVertex[] {
    const n = this.M._of_gp_patch_mesh(i, rings, segs);
    if (n <= 0) return [];
    const p = scratchF64(this.M, n * 4);
    const out: PatchVertex[] = [];
    for (let k = 0; k < n; ++k) {
      out.push({ x: p[k * 4], y: p[k * 4 + 1], z: p[k * 4 + 2], cover: p[k * 4 + 3] });
    }
    return out;
  }

  outcrops(i: number): PatchOutcrop[] {
    const n = this.M._of_gp_patch_outcrops(i);
    if (n <= 0) return [];
    const p = scratchF64(this.M, n * 6);
    const out: PatchOutcrop[] = [];
    for (let k = 0; k < n; ++k) {
      out.push({
        x: p[k * 6], y: p[k * 6 + 1], z: p[k * 6 + 2],
        scale: p[k * 6 + 3], sink: p[k * 6 + 4], cover: p[k * 6 + 5],
      });
    }
    return out;
  }

  /** THE placement question: which patch is under this point, or -1. */
  find(x: number, y: number, z: number): number {
    return this.M._of_gp_patch_find(x, y, z);
  }

  cover(i: number, x: number, y: number, z: number): number {
    return this.M._of_gp_patch_cover(i, x, y, z);
  }

  /** A drill's units per second where it stands: /core's rate times richness. */
  drillRate(i: number, x: number, y: number, z: number): number {
    return this.M._of_gp_patch_drill_rate(i, x, y, z);
  }

  /** Take ore out without granting it. The drill's ledger transfer. */
  drain(i: number, units: number): number {
    return this.M._of_gp_patch_drain(i, units);
  }

  /** Add a harvest node that is an outcrop OF a patch. Returns its index. */
  addOutcrop(patch: number, dx: number, dy: number, dz: number, edits = 0): number {
    return this.M._of_gp_node_add_outcrop(this.body, edits, patch, dx, dy, dz);
  }

  /** THE surface, for whoever is drawing a direction /core handed back. */
  surfaceRadius(dx: number, dy: number, dz: number, edits = 0): number {
    return this.M._of_surface_radius(this.body, edits, dx, dy, dz);
  }
}
