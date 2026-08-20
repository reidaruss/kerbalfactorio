// THE GROUND-COVER CARPET. RN-2145, fidelity lane A2.
//
// The gap analysis' section 1 difference 1, in one class: "the ground IS grass
// there; here grass sits ON the ground". This is the residency and rebase layer
// for a two-rung GPU-instanced cover whose every blade takes its colour from
// the terrain beneath it. GrassTuning holds the numbers, GrassPalette the
// colour rule, GrassSample the per-chunk build, GrassPool the buffers.
//
// It is SHAPED LIKE Scatter deliberately: poll the resident views once a frame,
// diff against an owned map, build a budget's worth, drop what left, and
// recompose against the chunk's current engine position on a rebase. That shape
// is the one this codebase has already paid to get right (WG-64's 4 km of
// displacement, CE-19's teardown ordering, the empty-chunk retry starvation),
// and none of those lessons are cheaper to relearn here.

import * as THREE from 'three';
import type { ChunkView } from '../../world/ChunkView.js';
import type { ChunkGeometryPool } from '../geometry/ChunkGeometryPool.js';
import type { WaterOracle } from '../../world/WaterOracle.js';
import type { DepthPolicy } from '../DepthPolicy.js';
import type { AtmosphereUniforms } from '../materials/Atmosphere.glsl.js';
import { buildCardGeometry, cardTriangles, MAT_CARD, TUFT_CARD } from './GrassCard.js';
import { createGrassMaterial, type GrassMaterialHandle } from './GrassMaterial.js';
import { GrassPool } from './GrassPool.js';
import { sampleGrass, type GrassSampleDeps, type RungSpec } from './GrassSample.js';
import { coverPaletteState } from './GrassPalette.js';
import {
  BUILDS_PER_UPDATE, DENS_HALF_M, GRASS_ON, GRASS_RAW, MAT_CAP, MAT_H_M,
  MAT_IN_HI_M, MAT_IN_LO_M, MAT_PER_M2, MAT_W_M, NEAR_PER_M2, REACH_M,
  TUFT_CAP, TUFT_H_M, TUFT_REACH_M, TUFT_W_M, bandOf, tuftDensity,
} from './GrassTuning.js';

export interface GrassCoverOptions {
  readonly pool: ChunkGeometryPool;
  readonly depth: DepthPolicy;
  readonly terrain: THREE.ShaderMaterial;
  readonly atmosphere: AtmosphereUniforms;
  readonly cascades: number;
  readonly maxReliefM: number;
  readonly water: WaterOracle | null;
  readonly editsHandle: () => number;
}

interface Rung {
  readonly name: string;
  readonly spec: RungSpec;
  readonly pool: GrassPool;
  readonly mat: GrassMaterialHandle;
  /** True when the rung's density changes with range, so a chunk must be
   *  re-sampled as it approaches. The far rung is FLAT and never is. */
  readonly graded: boolean;
}

/** Where the near tufts hand over to the far rung. A HANDOVER and not a fade:
 *  see GrassGlsl's note on why saying so matters. */
const TUFT_OUT_LO_M = 20;

export class GrassCover {
  readonly meshes: THREE.Mesh[];
  private readonly rungs: Rung[];
  private readonly deps: GrassSampleDeps;
  private readonly eye = new THREE.Vector3();
  /** The band each chunk's near rung was built at. Only the graded rung has
   *  one; the flat rung is built once and never re-sampled for density. */
  private readonly band = new Map<string, number>();
  private backlog = 0;
  private buildMs = 0;
  private builds = 0;

  constructor(o: GrassCoverOptions) {
    this.deps = {
      pool: o.pool, water: o.water, editsHandle: o.editsHandle,
      eye: this.eye, maxReliefM: o.maxReliefM,
    };
    // THE NEAR RUNG. Inverse-square density, crossed tufts, hands over at
    // TUFT_OUT_LO_M so the mid field is the far rung's from 20 m out.
    const tuft = createGrassMaterial({
      depth: o.depth, terrain: o.terrain, atmosphere: o.atmosphere,
      cascades: o.cascades, name: 'GrassCover(tuft)',
      rung: {
        densK: new THREE.Vector2(NEAR_PER_M2, DENS_HALF_M),
        inM: new THREE.Vector2(-2, -1),
        outM: new THREE.Vector2(TUFT_OUT_LO_M, TUFT_REACH_M),
        windGain: 2.2,
      },
    });
    // THE FAR RUNG. Flat density (a half-distance of 1e9 IS "flat", which is
    // how one shader expression covers both rungs), one wide quad, faded in
    // behind the tufts and out at its own pixel size.
    const mat = createGrassMaterial({
      depth: o.depth, terrain: o.terrain, atmosphere: o.atmosphere,
      cascades: o.cascades, name: 'GrassCover(mat)',
      rung: {
        densK: new THREE.Vector2(MAT_PER_M2, 1e9),
        inM: new THREE.Vector2(MAT_IN_LO_M, MAT_IN_HI_M),
        outM: new THREE.Vector2(1e8, 1e9),
        windGain: 1.1,
      },
    });
    this.rungs = [
      {
        name: 'tuft', graded: true, mat: tuft,
        spec: {
          salt: 0x5e11a1, reachM: TUFT_REACH_M,
          widthM: TUFT_W_M, heightM: TUFT_H_M, densityAt: tuftDensity,
        },
        pool: new GrassPool(buildCardGeometry(TUFT_CARD), tuft.material,
          TUFT_CAP, cardTriangles(TUFT_CARD), 'GrassCover(tuft)'),
      },
      {
        name: 'mat', graded: false, mat,
        spec: {
          salt: 0x3c0ffe, reachM: REACH_M,
          widthM: MAT_W_M, heightM: MAT_H_M, densityAt: (): number => MAT_PER_M2,
        },
        pool: new GrassPool(buildCardGeometry(MAT_CARD), mat.material,
          MAT_CAP, cardTriangles(MAT_CARD), 'GrassCover(mat)'),
      },
    ];
    this.meshes = this.rungs.map((r) => r.pool.mesh);
  }

  /** Bind the texgen grass card. Called once `surfacesReady()` resolves. */
  bindCard(): boolean {
    let all = true;
    for (const r of this.rungs) if (!r.mat.bindCard()) all = false;
    return all;
  }

  /**
   * Add cover for chunks that entered the reach, drop it for chunks that left,
   * re-sample the graded rung for chunks that crossed a band.
   *
   * `pxPerRad` is the camera's own pixels per radian, and it is pushed rather
   * than assumed because the fade is expressed in PIXELS: a fade that read a
   * constant would be a fade in metres wearing a pixel's clothes, and would go
   * wrong the first time the window resized (GrassTuning's FADE_PX note).
   */
  update(views: Iterable<ChunkView>, eye: THREE.Vector3, pxPerRad: number): void {
    if (!GRASS_ON) return;
    const t0 = performance.now();
    this.eye.copy(eye);
    for (const r of this.rungs) r.mat.setPxPerRad(pxPerRad);
    const seen = new Set<string>();
    let budget = BUILDS_PER_UPDATE;
    let backlog = 0;
    for (const v of views) {
      if (!v.isNear || !v.visible) continue;
      const near = v.pos.distanceTo(eye) - v.maxOffsetM;
      if (near > REACH_M) continue;
      seen.add(v.key);
      const b = bandOf(Math.max(0, near));
      const had = this.band.get(v.key);
      if (had === b) continue;
      if (budget <= 0) { backlog++; continue; }
      budget--;
      // A chunk arriving for the first time builds BOTH rungs; a chunk that
      // only crossed a band re-samples the graded one, because the flat rung's
      // count does not depend on range and re-sampling it would be a buffer
      // rewrite that produces the identical bytes.
      for (const r of this.rungs) {
        if (had !== undefined && !r.graded) continue;
        this.buildRung(r, v);
      }
      this.band.set(v.key, b);
    }
    for (const key of [...this.band.keys()]) {
      if (!seen.has(key)) this.drop(key);
    }
    this.backlog = backlog;
    for (const r of this.rungs) r.pool.flush();
    this.buildMs = performance.now() - t0;
  }

  /** THE REBASE PATH, chained behind Scatter's on TerrainStream.afterRebase. */
  replace(views: Map<string, ChunkView>): void {
    if (!GRASS_ON) return;
    const posOf = (key: string): THREE.Vector3 | undefined => views.get(key)?.pos;
    for (const r of this.rungs) { r.pool.rebase(posOf); r.pool.flush(); }
  }

  /** CE-19. Release everything this scope placed. Keyed teardown, not "drop
   *  what is no longer resident": after TerrainStream.dispose the resident set
   *  is already empty and the per-frame reclaim would never run again. */
  clearPlaced(): void {
    for (const key of [...this.band.keys()]) this.drop(key);
    for (const r of this.rungs) { r.pool.clear(); r.pool.flush(); }
  }

  dispose(): void {
    this.clearPlaced();
    for (const r of this.rungs) { r.pool.dispose(); r.mat.material.dispose(); }
  }

  /**
   * What the carpet is doing, in the shape WG-193 and the "print the
   * denominator you mean" rule require: never a bare instance count, always
   * beside the ground it is spread over, what was asked for, and every refusal.
   */
  report(): unknown {
    const rows = this.rungs.map((r) => ({
      rung: r.name,
      instances: r.pool.liveInstances,
      triangles: r.pool.liveTriangles,
      chunks: r.pool.chunks,
      cap: r.pool.cap,
      refused: r.pool.refused,
      cardBound: r.mat.cardBound(),
    }));
    return {
      on: GRASS_ON, raw: GRASS_RAW,
      draws: GRASS_ON ? this.rungs.length : 0,
      instances: rows.reduce((s, r) => s + r.instances, 0),
      triangles: rows.reduce((s, r) => s + r.triangles, 0),
      refused: rows.reduce((s, r) => s + r.refused, 0),
      chunksCovered: this.band.size,
      backlog: this.backlog,
      builds: this.builds,
      buildMs: Number(this.buildMs.toFixed(3)),
      placedPerM2: this.perM2,
      askedPerM2: this.askedPerM2,
      deliveredFraction: this.askedPerM2 > 0
        ? Number((this.perM2 / this.askedPerM2).toFixed(4)) : null,
      cellsCapped: this.capped,
      rungs: rows,
      palette: coverPaletteState(),
    };
  }

  private perM2 = 0;
  private askedPerM2 = 0;
  private capped = 0;
  private area = 0;
  private placed = 0;
  private asked = 0;

  private buildRung(r: Rung, v: ChunkView): void {
    const prev = r.pool.has(v.key);
    if (prev) this.unaccount(r, v.key);
    const s = sampleGrass(this.deps, v, r.spec);
    if (!r.pool.add(v.key, v.pos, s.n, s.local, s.param, s.col)) {
      // REFUSED, not truncated. GrassPool counts it; nothing here retries,
      // because a retry against a full pool is a chunk that starves every
      // chunk behind it (Scatter's own empty-chunk lesson in the other
      // direction).
      return;
    }
    this.builds++;
    this.capped += s.capped;
    this.area += s.areaM2;
    this.placed += s.n;
    this.asked += s.wanted;
    this.recount();
    this.acct.set(`${r.name}:${v.key}`,
      { n: s.n, area: s.areaM2, asked: s.wanted, capped: s.capped });
  }

  private readonly acct = new Map<string,
  { n: number; area: number; asked: number; capped: number }>();

  private unaccount(r: Rung, key: string): void {
    const a = this.acct.get(`${r.name}:${key}`);
    if (a === undefined) return;
    this.area -= a.area; this.placed -= a.n;
    this.asked -= a.asked; this.capped -= a.capped;
    this.acct.delete(`${r.name}:${key}`);
    this.recount();
  }

  private recount(): void {
    this.perM2 = this.area > 0 ? Number((this.placed / this.area).toFixed(4)) : 0;
    this.askedPerM2 = this.area > 0 ? Number((this.asked / this.area).toFixed(4)) : 0;
  }

  private drop(key: string): void {
    for (const r of this.rungs) { this.unaccount(r, key); r.pool.remove(key); }
    this.band.delete(key);
  }
}
