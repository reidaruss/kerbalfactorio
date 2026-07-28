// Placing ONE prop: the per-cell weighted draw, the bilinear interpolation onto
// the mesh, and the contact skirt.
//
// Split out of Scatter.ts at the 400-line cap, and the boundary is a real one
// rather than a line count. `Scatter` decides WHICH chunks and WHICH cells are
// eligible and owns the accounting that `deliveredFraction` is computed from;
// this file decides what happens inside one cell once that decision is made.
// Keeping them apart is what lets the look change (colour, scale, skirt) without
// touching the code a density measurement is read out of.

import * as THREE from 'three';
import type { PropLibrary, PropPart } from '../render/instancing/PropLibrary.js';
import type { PropSpec } from '../assets/Registry.js';
import { MAX_PER_CELL, hash32, frac, type Tier } from './ScatterTuning.js';
import {
  CLUSTER_BIAS, CONTACT_CARDS, CONTACT_SPREAD, lookOf, scaleFor, tintFor,
  tintScratch,
  type Look,
} from './ScatterLook.js';

/**
 * One chunk's build in progress. A record rather than eleven parameters, and
 * MUTABLE on purpose: `emit` advances `n` and appends to `parts`, and passing
 * that back through a return value for every one of up to fourteen thousand
 * props is how a sampler becomes the worst frame in the run.
 */
export interface Build {
  pos: Float32Array;
  local: Float32Array;
  quat: Float32Array;
  scale: Float32Array;
  parts: { material: string; slot: number; lod0: number; lod2: number }[];
  owner: number[];
  n: number;
  want: number;
  /** The current cell: its unit normal, its four corner indices, its hash. */
  nx: number; ny: number; nz: number;
  /** Per-PATCH hash for species clustering. See ScatterLook.CLUSTER_SHIFT. */
  cluster: number;
  i00: number; i10: number; i01: number; i11: number;
  seed: number;
}

export class PropEmitter {
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly n = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly spin = new THREE.Quaternion();
  /** Per-stem look family, cached. See `lookFor`. */
  private readonly looks = new Map<string, Look>();
  /** The understorey pool the CURRENT chunk's contact skirt draws from. */
  skirt: Tier | null = null;
  /** Cells whose draw was TRUNCATED by MAX_PER_CELL. Must stay 0 near. */
  cellsCapped = 0;

  constructor(
    private readonly lib: PropLibrary,
    /** See Scatter's `fair`: `?scatterfair=0` restores the RN-7 defect. */
    private readonly fair: boolean,
    /**
     * False restores the RN-15 understorey height band and the height-compounding
     * distance upscale. Reached from `?grassshort=0` since RN-45; the note at
     * `ScatterLook.TALL_H_LO` explains why it was defaulted for one round.
     */
    private readonly short = true,
  ) {}

  /**
   * One weighted draw over one cell, returning what it was ASKED for so the
   * caller can accumulate `wanted` from the same number the draw used.
   *
   * The Bernoulli quantisation is unchanged (RN-7): the fractional part is
   * spent as a probability keyed by the same per-cell hash, so realised density
   * equals requested density at any LOD depth. What is new is that a cell now
   * makes TWO of these draws, one per tier, and they must not share a hash
   * stream or the understorey would land exactly where the biome props do.
   * `salt` separates them.
   */
  drawTier(
    b: Build, tier: Tier, expect: number, salt: number, grow: number,
    skirt: boolean,
  ): number {
    if (!(expect > 0)) return 0;
    const whole = Math.floor(expect);
    const drawn = this.fair
      ? whole + (frac(hash32(b.seed, 0x9e3779b1 + salt)) < expect - whole ? 1 : 0)
      : Math.round(expect);
    if (drawn > MAX_PER_CELL) this.cellsCapped++;
    const perCell = Math.min(MAX_PER_CELL, drawn);
    // What this cell ASKED for, which is the density draw PLUS the skirt. The
    // skirt has to be in here and the first version of it was not, which
    // `probes/grass.js` caught immediately: `deliveredFraction` read 1.5146
    // against a check that requires 1.00 within 5%. A layer that produces
    // instances it never requested breaks the RN-7 ratio in the direction that
    // looks harmless, and a ratio that can read 1.5 can no longer be trusted to
    // read 0.98 when something is genuinely being dropped.
    //
    // A skirt card is not a density draw: its request is exactly
    // CONTACT_CARDS per colliding prop, deterministically. Counting it that way
    // keeps the two sides comparable and still catches truncation, because the
    // cards the `b.n < b.want` guard refuses are counted as asked for and are
    // not produced.
    let asked = expect;
    for (let j = 0; j < perCell && b.n < b.want; ++j) {
      const k = salt + j;
      const spec = this.pickClustered(tier, hash32(b.seed, k * 8 + 2), b.cluster);
      const placed = this.emit(b, spec, k, frac(hash32(b.seed, k * 8)),
        frac(hash32(b.seed, k * 8 + 1)), grow);
      // CONTACT BLENDING. A prop that collides has a silhouette that meets the
      // ground, and the reference has vegetation crowding every one of them.
      // The skirt is drawn from the understorey pool of this same biome, so a
      // biome with no understorey (Polar, Ocean) gets none rather than getting
      // the wrong plant. See ScatterLook.CONTACT_CARDS.
      if (placed && skirt && spec.collides && this.skirt !== null
        && this.skirt.total > 0) {
        asked += CONTACT_CARDS;
        for (let c = 0; c < CONTACT_CARDS && b.n < b.want; ++c) {
          const ck = 0x20000 + k * 16 + c;
          const du = (frac(hash32(b.seed, ck * 8 + 3)) * 2 - 1) * CONTACT_SPREAD;
          const dw = (frac(hash32(b.seed, ck * 8 + 4)) * 2 - 1) * CONTACT_SPREAD;
          const cs = this.pick(this.skirt, hash32(b.seed, ck * 8 + 2));
          // Clamped rather than wrapped: a skirt card must stay in the cell
          // whose four corners the bilinear interpolation is reading, or it
          // would be placed at a height that belongs to a different patch of
          // ground and would float or sink.
          this.emit(b, cs, ck,
            Math.min(1, Math.max(0, frac(hash32(b.seed, k * 8)) + du)),
            Math.min(1, Math.max(0, frac(hash32(b.seed, k * 8 + 1)) + dw)), 1);
        }
      }
    }
    return asked;
  }

  /** Place ONE prop at (u, w) inside the current cell. False if it has no art. */
  emit(
    b: Build, spec: PropSpec, k: number, u: number, w: number, grow: number,
  ): boolean {
    const list = this.lib.partsOf(spec.stem);
    if (list === null) return false;
    const n = b.n;
    b.local[n * 3] = this.bilerp(b.pos, b.i00, b.i10, b.i01, b.i11, 0, u, w);
    b.local[n * 3 + 1] = this.bilerp(b.pos, b.i00, b.i10, b.i01, b.i11, 1, u, w);
    b.local[n * 3 + 2] = this.bilerp(b.pos, b.i00, b.i10, b.i01, b.i11, 2, u, w);
    // Stand it on the SURFACE normal, then spin it about that normal.
    this.n.set(b.nx, b.ny, b.nz);
    this.q.setFromUnitVectors(this.up, this.n);
    this.spin.setFromAxisAngle(this.up, frac(hash32(b.seed, k * 8 + 3)) * Math.PI * 2);
    this.q.multiply(this.spin);
    b.quat[n * 4] = this.q.x; b.quat[n * 4 + 1] = this.q.y;
    b.quat[n * 4 + 2] = this.q.z; b.quat[n * 4 + 3] = this.q.w;
    const look = this.lookFor(spec.stem, list);
    const short = this.short && spec.detail === true;
    scaleFor(spec.jitter, b.seed, k, look === 'foliage', short, this.s);
    // `grow` IS HORIZONTAL ONLY for the understorey, and that is the durable
    // half of the height fix (ScatterLook.DETAIL_H_LO). `DETAIL_FAR_GROW` exists
    // to buy back screen COVERAGE at the outer edge of the ring, and coverage is
    // footprint; letting it multiply height as well is what turned a 0.60 m card
    // into a 1.34 m one. Spending it on width alone buys the same coverage and
    // cannot compound with the height jitter, so neither number has to be
    // re-derived when the other moves.
    const gy = short ? 1 : grow;
    b.scale[n * 3] = this.s.x * grow;
    b.scale[n * 3 + 1] = this.s.y * gy;
    b.scale[n * 3 + 2] = this.s.z * grow;
    tintFor(look, b.seed, k, tintScratch);
    for (const part of list) {
      const slot = this.lib.acquire(part.material);
      if (slot < 0) continue;
      // Tinted HERE, where the slot is acquired, and never again. See
      // PropLibrary.tint: colour is a property of the placement, and `write`
      // runs for every part on every floating-origin rebase.
      this.lib.tint(part.material, slot, tintScratch);
      b.parts.push({ material: part.material, slot, lod0: part.lod0, lod2: part.lod2 });
      b.owner.push(n);
    }
    b.n = n + 1;
    return true;
  }

  /**
   * A stem's look family, cached. `lookOf` reads the MATERIALS the prop's parts
   * landed in, which is the thing the tint multiplies, so the answer cannot
   * drift from a hand-kept list of which props are plants.
   */
  private lookFor(stem: string, list: readonly PropPart[]): Look {
    const hit = this.looks.get(stem);
    if (hit !== undefined) return hit;
    const look = lookOf(list.map((p) => p.material));
    this.looks.set(stem, look);
    return look;
  }

  private bilerp(
    a: Float32Array, i00: number, i10: number, i01: number, i11: number,
    c: number, u: number, w: number,
  ): number {
    const top = a[i00 + c] + (a[i10 + c] - a[i00 + c]) * u;
    const bot = a[i01 + c] + (a[i11 + c] - a[i01 + c]) * u;
    return top + (bot - top) * w;
  }

  private pick(t: Tier, h: number): PropSpec {
    let r = frac(h) * t.total;
    for (let i = 0; i < t.specs.length; ++i) {
      r -= t.weights[i];
      if (r <= 0) return t.specs[i];
    }
    return t.specs[t.specs.length - 1];
  }

  /**
   * The same weighted draw, but biased toward the patch's dominant species.
   * See ScatterLook.CLUSTER_BIAS for why a uniform mix is the thing to avoid.
   *
   * The dominant is drawn from the SAME table with the PATCH's hash, so it
   * costs no second table and a rare species dominates rarely. Determinism is
   * untouched: both draws are pure functions of hashes this code already had.
   */
  private pickClustered(t: Tier, h: number, cluster: number): PropSpec {
    if (frac(hash32(cluster, 0x5bd1e995)) < CLUSTER_BIAS) {
      return this.pick(t, hash32(cluster, 0x7feb352d));
    }
    return this.pick(t, h);
  }

}
