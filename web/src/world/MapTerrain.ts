// =============================================================================
// MapTerrain.ts - the client's driver for `/core`'s `of_map_sample` (DW-37).
//
// WHY IT EXISTS. Reid, on the map WG-29 shipped: "cant see the terrain from the
// map, even in sandbox." Every instrument was correct over an empty grey plane,
// and since DISCOVERY REVEALS TERRAIN, a map with no terrain has nothing to
// reveal, so the feature could not be evaluated at all.
//
// IT DECIDES NOTHING ABOUT THE WORLD. The biome is `biomeAt`, the height is
// `sampleDesignedHeight` (the surface oracle's designed base) and the survey bit
// is `of_disc_has` — all three read inside ONE `/core` call, which is standing
// rule 1: this is a CONSUMER of the surface authority, never a second copy of
// it. This file's only opinions are WHEN to resample and WHAT TO KEEP.
//
// Its shape mirrors `Discovery.ts` deliberately, because that shape is proven:
//   - the producing export is called FIRST, then the scratch pointer and
//     HEAPF64 are BOTH re-read, never cached across a call (standing rule 5:
//     ALLOW_MEMORY_GROWTH detaches every ArrayBuffer when the heap grows);
//   - the arena is COPIED out before the next call into WASM, because the map
//     holds this buffer across frames;
//   - the result is CACHED on everything that could change it, so a repaint
//     that changed nothing costs nothing. A full rebuild is thousands of noise
//     evaluations; doing it at 60 Hz for a picture that only moves when the
//     view or the discovered set does would be a self-inflicted frame cost.
//
// THE HALF THAT SURVIVES. DW-37 also turns the map into a rotatable 3D camera.
// The PAINTER downstream of this is expected to be replaced by that lane; the
// SAMPLING is not, which is why the request below is a region of a sphere (a
// centre, two axes, a span, a density) rather than a rectangle of pixels.
// =============================================================================
import { MAP_SAMPLE_WORDS, MapSample, discAbi } from '../sim/wasm/discabi.js';
import type { OfDiscoveryModule } from '../sim/wasm/discabi.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { Discovery } from './Discovery.js';

export { MapSample, MAP_SAMPLE_WORDS };

/**
 * One sampled view of the ground, ready for the painter to blit.
 *
 * THREE PARALLEL ARRAYS AND NOT THE INTERLEAVED ARENA, so the painter needs to
 * know nothing about the bridge's layout: `discabi.ts`'s `MapSample` stays the
 * one definition of where a field lives, read here and nowhere else. All three
 * are row-major with the TOP ROW FIRST, which is the order an ImageData wants.
 */
export interface TerrainGrid {
  /** /core's `Biome` enum per sample; **-1 means OFF THE LIMB**. */
  readonly biome: Int8Array;
  /** The surface oracle's designed base height, metres. */
  readonly heightM: Float64Array;
  /** 1 when this sample's SURVEY cell has been observed. THE GATE. */
  readonly seen: Uint8Array;
  readonly cols: number;
  readonly rows: number;
  /** Ground metres across ONE sample. This is the terrain layer's FEATURE SIZE
   *  and the map's legibility ramp is taken from it, exactly as the discovery
   *  layer's was taken from a cell edge (DW-36: no layer is switched on at a
   *  span; a feature earns its pixels). */
  readonly sampleSizeM: number;
  /** Samples with ground under them (biome >= 0), i.e. inside the limb. */
  readonly onBody: number;
  /** Of those, how many have been seen. In sandbox the painter ignores the
   *  mask and draws every on-body sample; in survival it is the one gate. */
  readonly seenOnBody: number;
  /** The height range over the ON-BODY samples, for the relief ramp. A SHADING
   *  STATISTIC of this view and not a fact about the world: it is what lets the
   *  same ramp read at a 600 m span (metres of relief) and at a whole-body one
   *  (kilometres) without a threshold anywhere. */
  readonly minH: number;
  readonly maxH: number;
}

/**
 * The sample density across the SHORT screen axis, CHOSEN BY MEASUREMENT.
 *
 * The cost is a sample's worth of the noise stack, measured at **2.37 us** on a
 * fully on-body view (`biomeAt` plus `sampleDesignedHeight`; a sample off the
 * limb costs a dot product and is skipped, which is why the same grid is 5x
 * cheaper zoomed out). Swept on the shipped wasm at a 2.9:1 aspect, worst case
 * (a 600 m span, every sample on the body):
 *
 *     n=16   736 samples   1.7 ms      n=40  4,640 samples  11.7 ms
 *     n=24 1,680 samples   3.5 ms      n=48  6,672 samples  14.3 ms
 *     n=32 2,976 samples   6.4 ms      n=64 11,904 samples  26.7 ms
 *     n=36 3,744 samples   8.9 ms      n=96 26,688 samples  58.7 ms
 *
 * That sweep is at a 2.9:1 aspect, which is the WIDEST panel the map is ever
 * given and not the one it has: the shipped panel measures 1.19:1, so `n` rows
 * cost n*1.19*n samples rather than n*2.9*n. Re-measured IN THE BROWSER on the
 * real panel, 48 rows is 48x57 = 2,736 samples at 8.6 ms, which is the same
 * ~8 ms budget at the shape the map actually has. `report().rebuildMs` is the
 * live number, so this stays honest if the panel is ever re-laid-out.
 *
 * THE BUDGET IS A REBUILD BUDGET, NOT A FRAME ONE: a still view is a cache hit
 * and costs nothing, and
 * the expensive case (a small span, every sample on the ground) is the ON-FOOT
 * map, where the panel MUTES the movement keys, so the view cannot move while
 * it is up. The case that does move every frame is the map open in flight, and
 * that one is auto-fitted to a trajectory, so most of its samples are off the
 * limb: the same grid is 1.8 ms there.
 *
 * If this ever needs to be finer than a rebuild can afford, the grid can be
 * built in BANDS over a few frames the way the terrain streamer budgets chunk
 * generation, and no ABI change is needed to do it: a band is just a call with
 * the centre pushed along v, `spanM` scaled by the band's share of the rows and
 * `aspect` scaled to keep the same columns, which lands on exactly the same
 * sample positions.
 */
export const TERRAIN_N = 48;

export interface TerrainDeps {
  core: OfCoreModule;
  /** A §1 body handle. The height and the biome belong to the BODY. */
  body: number;
  /** Only for its generation counter: a new observation changes the survey
   *  mask, and a cache that did not notice would keep painting the old one. */
  disc: Discovery | null;
}

/** To the nearest `q`. A non-finite or non-positive step is the identity, so a
 *  degenerate view still asks for the picture it asked for. */
function snap(v: number, q: number): number {
  if (!Number.isFinite(v)) return 0;
  return Number.isFinite(q) && q > 0 ? Math.round(v / q) * q : v;
}

/** A direction rounded to a nanoradian, as a fresh triple. */
function unitq(a: readonly [number, number, number]):
    [number, number, number] {
  return [snap(a[0], 1e-9), snap(a[1], 1e-9), snap(a[2], 1e-9)];
}

export class MapTerrain {
  private readonly M: OfDiscoveryModule;
  private grid: TerrainGrid | null = null;
  private key = '';
  rebuildMsTotal = 0;
  rebuilds = 0;
  calls = 0;
  hits = 0;
  lastRefused = false;

  constructor(private readonly d: TerrainDeps) {
    this.M = discAbi(d.core);
  }

  /**
   * The ground under a view, or null when there is none to draw.
   *
   * `centreM` is the projection origin (MapScene.centreM), `u`/`v` the two
   * in-plane axes, `shortSpanM` the metres across the SHORT screen axis (the
   * map's own zoom parameter), and `cssW`/`cssH` the canvas.
   *
   * THE GRID IS CUT TO THE CANVAS, not to the short axis, so the samples land
   * exactly on the pixels: metres per pixel is `shortSpanM / min(cssW, cssH)`,
   * so the view is `cssH` of those tall and `cssW` wide, and asking `/core` for
   * that region with `TERRAIN_N` samples across the SHORT axis puts one sample
   * every `min(cssW,cssH)/TERRAIN_N` pixels whatever the panel's shape.
   */
  sample(centreM: readonly [number, number, number],
         u: readonly [number, number, number],
         v: readonly [number, number, number],
         shortSpanM: number, cssW: number, cssH: number): TerrainGrid | null {
    this.calls += 1;
    if (!(shortSpanM > 0) || !(cssW > 0) || !(cssH > 0)) return this.grid;
    const short = Math.min(cssW, cssH);
    const rows = Math.max(1, Math.round(TERRAIN_N * cssH / short));
    const aspect = cssW / cssH;
    const spanM = shortSpanM * cssH / short;
    const gen = this.d.disc === null ? 0 : this.d.disc.generation;
    const sampleSizeM = shortSpanM / TERRAIN_N;
    // THE REQUEST IS SNAPPED TO A FRACTION OF A SAMPLE, and the reason is a
    // measurement rather than a preference. Keyed on the raw centre, a player
    // merely SETTLING on uneven ground moved it by centimetres every frame and
    // rebuilt the whole grid at 60 Hz: measured at +7.3 ms of frame cost with
    // the map open and standing still, against +0.8 ms when the same run
    // happened not to jitter. A request that differs by less than a
    // thirty-second of one sample is asking for the same picture.
    //
    // The SNAPPED values are what is sampled, not just what is keyed, so the
    // grid is a deterministic function of its key rather than of whichever
    // frame happened to miss the cache. The registration error that buys is at
    // most half a step: 0.2 m of ground at the on-foot span, 2 km at a
    // whole-body one - a sixty-fourth of a sample either way, which is below
    // the resolution the picture has.
    const q = sampleSizeM / 32;
    const c: [number, number, number] = [snap(centreM[0], q), snap(centreM[1], q),
                                         snap(centreM[2], q)];
    // The axis rides on the focus and drifts by nanoradians as the player
    // settles; 1e-9 is 0.6 mm on Forge's own radius.
    const uu = unitq(u), vv = unitq(v);
    const k = `${gen}|${rows}|${aspect.toFixed(6)}|${spanM}|${c.join(',')}|`
      + `${uu.join(',')}|${vv.join(',')}`;
    if (k === this.key) { this.hits += 1; return this.grid; }
    this.key = k;
    this.grid = this.build(c, uu, vv, spanM, aspect, rows, sampleSizeM);
    return this.grid;
  }

  /** ONE call into `/core`, then the copy out. Nothing here interprets a
   *  height or a biome; it counts what came back so the painter and a probe
   *  read the same numbers. */
  private build(c: readonly [number, number, number],
                u: readonly [number, number, number],
                v: readonly [number, number, number],
                spanM: number, aspect: number, rows: number,
                sampleSizeM: number): TerrainGrid | null {
    const t0 = performance.now();
    const n = this.M._of_map_sample(this.d.body, c[0], c[1], c[2],
                                    u[0], u[1], u[2], v[0], v[1], v[2],
                                    spanM, aspect, rows);
    this.rebuildMsTotal += performance.now() - t0;
    this.rebuilds += 1;
    this.lastRefused = n <= 0;
    if (n <= 0) return null;
    // POINTER AND VIEW RE-READ AFTER THE CALL, never before and never cached:
    // the call may have grown the heap and detached every earlier view.
    const p = this.M._of_scratch_f64();
    const a = this.M.HEAPF64;
    const base = p >>> 3;
    // COPIED OUT, never a subarray: the map holds this across frames and the
    // next call into WASM may detach the buffer underneath it. The de-interleave
    // and the statistics ride the same one pass.
    const biome = new Int8Array(n);
    const heightM = new Float64Array(n);
    const seen = new Uint8Array(n);
    let onBody = 0, seenOnBody = 0;
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < n; i++) {
      const k = base + i * MAP_SAMPLE_WORDS;
      const b = a[k + MapSample.biomeId];
      biome[i] = b;
      if (b < 0) continue;
      const h = a[k + MapSample.heightM];
      heightM[i] = h;
      const s = a[k + MapSample.surveyed] !== 0 ? 1 : 0;
      seen[i] = s;
      onBody += 1;
      seenOnBody += s;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
    if (onBody === 0) { minH = 0; maxH = 0; }
    const cols = Math.max(1, Math.round(n / rows));
    return { biome, heightM, seen, cols, rows, sampleSizeM, onBody,
      seenOnBody, minH, maxH };
  }

  /** Drop what is held. Used when the discovered world is thrown away, so the
   *  picture cannot outlive the field it was cut from. */
  forget(): void { this.grid = null; this.key = ''; }

  report(): unknown {
    const g = this.grid;
    return {
      n: TERRAIN_N,
      cols: g === null ? 0 : g.cols,
      rows: g === null ? 0 : g.rows,
      samples: g === null ? 0 : g.cols * g.rows,
      onBody: g === null ? 0 : g.onBody,
      seenOnBody: g === null ? 0 : g.seenOnBody,
      sampleSizeM: g === null ? 0 : +g.sampleSizeM.toFixed(3),
      reliefM: g === null ? 0 : +(g.maxH - g.minH).toFixed(2),
      rebuilds: this.rebuilds,
      rebuildMs: this.rebuilds === 0 ? 0
        : +(this.rebuildMsTotal / this.rebuilds).toFixed(3),
      calls: this.calls,
      cacheHitRate: this.calls === 0 ? 0 : +(this.hits / this.calls).toFixed(4),
      refused: this.lastRefused,
    };
  }
}
