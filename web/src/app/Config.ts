// Seed, quality tier, tunables and URL-parameter parsing. The single source of
// truth for "what run is this". ARCHITECTURE.md section 11.3: every stochastic
// value derives from Config.seed through /core's hash chain, so ?seed= alone
// makes a run reproducible.
//
// Split (line-cap batch 2, BT-285) into ConfigTypes.ts (QualityTier,
// Scenario, PlayerMode, SCENARIOS, the Config record itself); this file
// stays the barrel, holding the URL-parameter parsing (parseConfig and its
// helpers), and re-exports every type a consumer imported from here before
// the split.

import { parsePost } from '../render/post/PostConfig.js';
import { TREE_RADIUS_M } from '../game/TreeTuning.js';
import {
  SCENARIOS, type Config, type Scenario, type QualityTier,
} from './ConfigTypes.js';

export type {
  QualityTier, Scenario, PlayerMode, Config,
} from './ConfigTypes.js';
export { SCENARIOS } from './ConfigTypes.js';

const DEFAULT_SEED_LO = 0x0bf00d01;

function parseSeed(raw: string | null): { lo: number; hi: number; text: string } {
  if (raw === null || raw === '') {
    return { lo: DEFAULT_SEED_LO, hi: 0, text: `0x${DEFAULT_SEED_LO.toString(16)}` };
  }
  const text = raw.trim();
  // Accept decimal, 0x-hex, or an arbitrary string hashed with FNV-1a (so
  // ?seed=alpha is as legitimate a seed as ?seed=42).
  if (/^(0x)?[0-9a-f]+$/i.test(text)) {
    const n = text.startsWith('0x') || text.startsWith('0X')
      ? Number.parseInt(text.slice(2), 16)
      : Number.parseInt(text, 10);
    if (Number.isFinite(n)) {
      const lo = n >>> 0;
      const hi = Math.floor(n / 0x1_0000_0000) >>> 0;
      return { lo, hi, text };
    }
  }
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < text.length; ++i) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return { lo: h, hi: 0, text };
}

function parseQuality(raw: string | null): QualityTier {
  return raw === 'low' || raw === 'med' || raw === 'high' ? raw : 'high';
}

/**
 * A tri-state flag: absent is `null`, not `false`. §2.6's fourth trap in one
 * function: "a flag's DEFAULT is a fixture. `Number(null)` is 0, so parse a
 * missing parameter as MISSING and assert the boot default in its own named
 * check." Every existing flag here is two-state on purpose; these two are
 * OVERRIDES of a per-tier table and genuinely have three states.
 */
function boolOrNull(p: URLSearchParams, key: string): boolean | null {
  const v = p.get(key);
  return v === null || v === '' ? null : v !== '0';
}

/** As above, clamped to a power of two in [16, 512]. */
function pow2OrNull(p: URLSearchParams, key: string): number | null {
  const v = p.get(key);
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const e = Math.round(Math.log2(n));
  return 2 ** Math.min(9, Math.max(4, e));
}

function num(p: URLSearchParams, key: string, fallback: number): number {
  const v = p.get(key);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function parseConfig(search: string): Config {
  const p = new URLSearchParams(search);
  const seed = parseSeed(p.get('seed'));
  // The bare URL opens the GAME, not a tech demo. 'space' was the default back
  // when an orbital planet was the only thing that existed; now it drops a new
  // player 1.6 Mm up with no character, no pack and no objectives, which reads
  // as "nothing works". Every probe scenario is still one query param away.
  const scenarioName = p.get('scenario') ?? 'walk';
  const base = SCENARIOS[scenarioName] ?? SCENARIOS.walk;
  const quality = parseQuality(p.get('quality'));
  const tRaw = p.get('t');
  const scenario: Scenario = {
    lat: num(p, 'lat', base.lat),
    lon: num(p, 'lon', base.lon),
    alt: num(p, 'alt', base.alt),
    sunDot: num(p, 'sundot', base.sunDot),
    pitchDeg: base.pitchDeg,
  };
  return {
    bodyId: ['cinder', 'moon', '1'].includes(p.get('body') ?? '') ? 1 : 0,
    seedLo: seed.lo,
    seedHi: seed.hi,
    seedText: seed.text,
    scenarioName,
    scenario,
    sunTExplicit: tRaw === null || !Number.isFinite(Number(tRaw)) ? null : Number(tRaw),
    quality,
    post: parsePost(search, quality),
    debug: p.get('debug') !== '0',
    forceLogDepth: p.get('depth') === 'log',
    forcePlainDepth: p.get('depth') === 'plain',
    chunkPoolSize: Math.max(64, num(p, 'pool', 384) | 0),
    // DW-19: maxDepth 14 gives a measured 1.80 m cell at the feet on a plain
    // and 1.65 m on a mountain, finer than the 2 m the 1 m voxel layer needs.
    // The ceiling is 16 so the probe can sweep past the shipping value.
    //
    // WG-186 to WG-193: 14 -> 15, measured cell 1.799 -> 0.899 m at the feet.
    // PRICED ON A REAL D3D11 BOOT with 4 INTERLEAVED repeats per arm, because
    // the first two sweeps disagreed on the SIGN (+2.10 ms on one, -0.80 on the
    // next) and a non-interleaved sweep lets thermal drift land on one arm:
    // high tier p50 8.00 -> 9.40 ms against a 16.6 ms budget, +112,243
    // triangles (+15.1%), near chunks 169 -> 184, pool never exhausted (133 of
    // 384 still free), VRAM unchanged. The delta is 2.3x md14's own 0.60 ms
    // within-arm spread, so it is real; md15's own spread is 2.60 ms, so this
    // also buys a slightly LUMPIER frame, and that is the honest half.
    //
    // WHAT IT BUYS, AND WHAT IT DOES NOT, because the flag that asked for this
    // named a cause the measurement does not support. `lodstep.js` measures the
    // ANGLE BETWEEN ADJACENT FACETS, which is what a "polygon step" IS:
    //   - On the ground a player walks (the forestfloor art pose, the ruin
    //     walk), the crease at the SHIPPED depth 14 is already p50 0.014-0.30
    //     and max 0.39-0.73 DEGREES. There was no visible step there to remove.
    //   - On a 9.5 degree mountain flank the upper percentiles DO NOT IMPROVE
    //     AT ALL from depth 13 to depth 16: p90 stays ~5 deg and max ~19 deg
    //     across an 8x change in tessellation, because the height field is
    //     fractal and its worst creases are scale-invariant.
    // So this does NOT fix silhouette stepping on steep ground and no depth
    // will. What it does buy is measured too: the normals resolve 0.9 m relief
    // instead of 1.8 m, so sub-1.8 m surface shape reaches the SHADING. With
    // the scatter held off (`?props=0`, one flag apart) the `forestfloor` frame
    // moves 48.91% of its pixels, both ways (289,923 darker / 267,530 lighter)
    // against a same-config control that moves 0.78%, and the §2.1 groundNear
    // box gains 25.1% of iqr at 1.0% of luma. The airbrushed ground gets grain.
    //
    // THE ONE CONSEQUENCE THAT LEAVES THIS DOMAIN: with the scatter ON the same
    // box reads 26.54 -> 28.22 luma, which is OUT of §2.1's band. That is a
    // RE-SEED and not a loss, proved rather than argued: scatter density is per
    // CELL, so a finer lattice is a different hash, and `placedPerM2` holds at
    // 0.46431 -> 0.46466 with `deliveredFraction` 1.0002 in BOTH arms and zero
    // cells or chunks capped. The §2.1 luminance table has to be re-taken at
    // this LOD; it cannot be carried across.
    // RN-1642 (2026-08-14): this comment previously read 30.58 for the
    // scatter-ON figure, which no re-take (headless or on real D3D11) has ever
    // reproduced; every measurement, then and since, reads 28.22. Corrected
    // rather than left, because a stray digit in a comment beside the constant
    // it explains is exactly the kind of citation this file warns readers to
    // trust. The §2.1 and §2b tables were re-taken at this LOD in the same
    // lane; see rendering.md §2.1b and §2c.
    maxDepth: Math.min(16, Math.max(4, num(p, 'maxdepth', 15) | 0)),
    // DW-19: 1.4 is the highest ratio that still refines on a MOUNTAIN. The
    // split metric measures the observer to the quad CENTRE, so a coarse quad
    // the observer stands inside reports up to a half-diagonal of distance and
    // s/d tops out near 2; at splitRatio 2.0 the mountain root stops splitting
    // and the whole set collapses to 108 chunks at depth 4. Measured cliff, not
    // a guess: see ARCHITECTURE.md 15.2.
    splitRatio: Math.min(4, Math.max(0.25, num(p, 'split', 1.4))),
    // OFF by default at W1. of::TerrainStreamer sizes the skirt apron in
    // proportion to the chunk, so even at skirtFraction 0.02 the rings render as
    // ribbons and shelves lying across the landscape rather than as hidden
    // crack plugs. The resident set is a complete quadtree partition, so the
    // only cracks are LOD T-junctions; revisit at W2 when a walk makes them
    // observable. ?skirts=1 turns them back on for that comparison.
    skirts: p.get('skirts') === '1',
    skirtFraction: num(p, 'skirtfrac', 0),
    mode: p.get('mode') === 'walk' ? 'walk'
      : p.get('mode') === 'fly' ? 'fly'
        : base.mode ?? 'fly',
    view: p.get('view') === 'tp' || p.get('view') === 'TP' ? 'TP' : 'FP',
    stitch: p.get('stitch') !== '0',
    proxy: p.get('proxy') !== '0',
    shell: p.get('shell') !== '0',
    // 250 ms (ARCHITECTURE.md section 4.5 mechanism 3). ?fade=0 reproduces the
    // W2 pop in the same build, so the fix has a measured BEFORE.
    fadeSecs: Math.max(0, num(p, 'fade', 0.25)),
    shadows: p.get('shadows') !== '0',
    shadowSoftOverride: boolOrNull(p, 'shadowsoft'),
    iblSizeOverride: pow2OrNull(p, 'iblsize'),
    atmosphere: p.get('atmos') !== '0',
    // RN-64. `?iblground=0` builds no ground shell, so the environment's lower
    // hemisphere goes back to the sky model marched through the planet, which
    // is what every prop, tree, pebble and machine was lit from below by until
    // this pass. Standing rule 7: one flag per term, and this one is the term.
    iblGround: p.get('iblground') !== '0',
    iblGroundAmp: Math.max(0, num(p, 'iblgroundamp', 1)),
    stars: p.get('stars') !== '0',
    props: p.get('props') !== '0',
    density: Math.max(0, num(p, 'density', 1)),
    scatterFair: p.get('scatterfair') !== '0',
    propGrow: p.get('propgrow') !== '0',
    detailCards: p.get('detail') !== '0',
    propCull: p.get('propcull') !== '0',
    grassShort: p.get('grassshort') !== '0',
    scatterWet: p.get('scatterwet') === '1',
    // Clamped at 1,600 m rather than left open: past that the cell the far
    // chunks offer is coarser than `MAX_CELL_M` and the ring silently stops
    // growing, which would read as "the cost levelled off" rather than as
    // "the sampler refused the chunk".
    // WG-116: the scenery canopy is RETIRED, so the default is 0 and
    // `?canopy=620` (ScatterTuning.CANOPY_RADIUS_M, which still holds the
    // measured reach and its argument) restores it as the before-picture.
    canopyRadiusM: Math.min(1600, Math.max(0, num(p, 'canopy', 0))),
    canopyShade: p.get('canopyshade') !== '0',
    rocks: p.get('rocks') !== '0',
    station: p.get('station') !== '0',
    rockDensity: Math.max(0, num(p, 'rockdensity', 1)),
    treeRadiusM: Math.min(1600, Math.max(0, num(p, 'trees', TREE_RADIUS_M))),
    treeDensity: Math.max(0, num(p, 'treedensity', 1)),
    nodeLod: p.get('nodelod') !== '0',
    nodeCull: p.get('nodecull') !== '0',
    spires: p.get('spires') !== '0',
    forestDetail: p.get('forestdetail') !== '0',
    propLod2: p.get('proplod2') !== '0',
    gameplay: p.get('gameplay') !== '0',
    vab: p.get('vab') !== '0',
    flight: p.get('flight') !== '0',
    // OFF unless asked for, and asked for POSITIVELY (`=1`), unlike the
    // isolation switches above which are all `!== '0'`. A mode that could be
    // entered by a typo in a query string is a mode that will silently label
    // somebody's survival save as sandbox.
    sandbox: p.get('sandbox') === '1',
    voxelSkinEditsOnly: p.get('voxelskin') !== '0',
    voxelNear: p.get('voxelnear') !== '0',
    aimShell: p.get('aimshell') === '1',
    levelRing: p.get('levelring') !== '0',
    nearCutoff: Math.max(0, num(p, 'cutoff', 0) | 0),
    // 4,000 m is of::FloatingOrigin's default. The knob exists so a headless run
    // can force many rebases inside a walk that fits in a smoke budget, which
    // makes the invisibility assertion STRICTER, not weaker.
    rebaseM: Math.max(16, num(p, 'rebase', 4000)),
    walkSpeedMps: Math.max(0.5, num(p, 'walkspeed', 4.6)),
    // ?interp=0 reproduces the un-interpolated behaviour so the jitter fix has a
    // measured BEFORE in the same build, not an argument.
    interpolate: p.get('interp') !== '0',
    anim: p.get('anim') !== '0',
    zSepRatio: Math.max(0, num(p, 'zsep', 0)),
    clearColor: (() => {
      const v = p.get('clear');
      if (v === null) return 0x000000;
      const n = Number.parseInt(v.replace('#', ''), 16);
      return Number.isFinite(n) ? n : 0x000000;
    })(),
  };
}
