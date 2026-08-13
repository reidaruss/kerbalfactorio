// Seed, quality tier, tunables and URL-parameter parsing. The single source of
// truth for "what run is this". ARCHITECTURE.md section 11.3: every stochastic
// value derives from Config.seed through /core's hash chain, so ?seed= alone
// makes a run reproducible.

import { parsePost, type PostSettings } from '../render/post/PostConfig.js';
import { TREE_RADIUS_M } from '../game/TreeTuning.js';
import type { BodyId } from '../world/PlanetBody.js';

export type QualityTier = 'low' | 'med' | 'high';

/** Named start states an agent or the smoke suite can jump straight to. */
export interface Scenario {
  readonly lat: number;
  readonly lon: number;
  readonly alt: number;
  /**
   * Target dot(sunDir, localUp) at the start point. Boot SOLVES the sun angle
   * for this, so any lat/lon is lit without re-guessing a magic time of day.
   * ?t= overrides it with an absolute angle in turns.
   */
  readonly sunDot: number;
  /** 'walk' spawns the kinematic capsule; 'fly' keeps the free/orbit camera. */
  readonly mode?: PlayerMode;
  /** Overrides the horizon-framing pitch. The depth probe needs a clear ray. */
  readonly pitchDeg?: number;
}

export type PlayerMode = 'walk' | 'fly';

// lat -3.41413 / lon 150.27984 on Forge at seed 0x0bf00d01 (WG-214).
//
// **THIS COMMENT IS NO LONGER THE ONLY THING MAKING THE CLAIM.** Its previous
// version described lat 2 / lon 144 as "a Hills valley floor at 2,963 m". By
// 2026-08-03 that point measured 4,667.789 m in the MOUNTAINS: a drift of
// +1,704.789 m and a biome change, unnoticed for months because nothing
// asserted it. The spawn stood 2,817.8 m above `TREELINE_BARE_M`, a sweep found
// 100% Mountains and 0% sub-treeline ground at every band out to 20 km, and the
// only wood within 20 km was the 14 hand-placed starter trees. The first goal
// of the progression spine is "gather wood".
//
// Every number below is now ASSERTED in `core/tests/test_spawn.cpp`, which also
// carries a negative control proving all four gates refuse the old site. If
// this comment ever disagrees with the world again, that suite goes red.
//
// A Hills valley floor at 797.6 m, below the treeline with the wander's own
// margin, carrying an estimated 1,296 trees in the shipped 620 m ring even
// pessimistically. 623 m of relief inside a 6 km box with 54.2% of that box
// standing above it, so it is a floor rather than a tabletop: the start is
// deliberately on rugged land, because an ocean or plateau start makes every
// terrain screenshot useless. Noon sun reaches 63.8 degrees.
//
// The lat/lon here and `BodyParams::homeDir` in cubed_sphere.h are two
// encodings of one place and `test_spawn.cpp` pins them to each other.
const HOME = { lat: -3.41413, lon: 150.27984 };

export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  // Whole planet in frame, everything in the far scaled scene.
  space: { ...HOME, alt: 1.6e6, sunDot: 0.85 },
  // Low orbit: the planet fills the frame, the near/far split is active.
  orbit: { ...HOME, alt: 3.0e5, sunDot: 0.85 },
  // Boots on the ground, all fine terrain in the near 1:1 scene.
  surface: { ...HOME, alt: 40, sunDot: 0.55 },
  // Mid-ascent, deliberately straddling the near/far chunk cutoff.
  ascent: { ...HOME, alt: 1.2e4, sunDot: 0.70 },
  // Depth-precision probe. The pitch is deliberately ABOVE the horizon: the
  // probe pairs sit along the view ray out to 60 km and terrain must not bury
  // them (ARCHITECTURE.md section 3.3).
  zfight: { ...HOME, alt: 900, sunDot: 0.55, pitchDeg: 8 },
  // W2: boots on the ground with the kinematic capsule driving the observer.
  // alt is ignored (the capsule spawns ON the surface); it is kept so the
  // scenario record has one shape.
  walk: { ...HOME, alt: 2, sunDot: 0.55, mode: 'walk' },
  // The sustained-walk streaming and rebase test starts from the same place.
  long_walk: { ...HOME, alt: 2, sunDot: 0.55, mode: 'walk' },
};

export interface Config {
  /** Which body to boot on. ?body=cinder|moon|1 picks the moon (PlanetBody). */
  readonly bodyId: BodyId;
  readonly seedLo: number;
  readonly seedHi: number;
  readonly seedText: string;
  readonly scenarioName: string;
  readonly scenario: Scenario;
  /** Absolute sun angle in turns from ?t=, or null to solve from sunDot. */
  readonly sunTExplicit: number | null;
  readonly quality: QualityTier;
  readonly debug: boolean;
  readonly forceLogDepth: boolean;
  readonly forcePlainDepth: boolean;
  /** Max chunk geometries held resident by the pool. */
  readonly chunkPoolSize: number;
  /** TerrainStreamer maxDepth. */
  readonly maxDepth: number;
  /** TerrainStreamer splitRatio (DW-19). Higher = coarser far field. */
  readonly splitRatio: number;
  /** Draw the skirt index range as well as the interior. ?skirts=1 enables. */
  readonly skirts: boolean;
  /** StreamConfig.skirtFraction override; 0 keeps the default. */
  readonly skirtFraction: number;
  /** Which ViewSource drives the frame. ?mode=walk|fly overrides the scenario. */
  readonly mode: PlayerMode;
  /** Start camera mode for the character. FP is the default (section 3.4). */
  readonly view: 'FP' | 'TP';
  /** Snap LOD T-junction edges onto the coarser neighbour. ?stitch=0 disables. */
  readonly stitch: boolean;
  /** Draw the far-scene PlanetProxy. ?proxy=0 isolates the terrain shell. */
  readonly proxy: boolean;
  /** Draw far-scene terrain chunks. ?shell=0 isolates the proxy. */
  readonly shell: boolean;
  /** Cross-fade duration for a chunk arriving or being replaced, seconds. */
  readonly fadeSecs: number;
  /** Cascaded shadows. ?shadows=0 disables the whole pass. */
  readonly shadows: boolean;
  /**
   * RN-1420, standing rule 7. `?shadowsoft=0` puts `THREE.PCFShadowMap` back on
   * every tier and `?shadowsoft=1` forces `PCFSoftShadowMap` onto `low`, so the
   * filter change has a control inside one binary. `null` is the tier default
   * and is DELIBERATELY not `false`: `Number(null)` is 0 and a missing flag read
   * as its own default is §2.6's fourth trap.
   */
  readonly shadowSoftOverride: boolean | null;
  /**
   * RN-1415, standing rule 7. `?iblsize=` overrides the PMREM cube side. 64
   * restores what every tier shipped with before this pass. `null` is the tier
   * default; a value is clamped to a power of two in [16, 512] because
   * PMREMGenerator's mip chain is derived from it and a silly value is a
   * silently degraded environment rather than an error.
   */
  readonly iblSizeOverride: number | null;
  /** Analytic atmospheric scattering. ?atmos=0 disables sky + aerial perspective. */
  readonly atmosphere: boolean;
  /** Star field. ?stars=0 disables it. */
  readonly stars: boolean;
  /** Tier 1 biome prop scatter. ?props=0 isolates the terrain (standing rule 7). */
  readonly props: boolean;
  /** Scatter density multiplier. ?density=2 doubles every biome's count. */
  readonly density: number;
  /**
   * Fair per-cell quantisation of the scatter count. `?scatterfair=0` restores
   * the `Math.round(expected)` the layer shipped with, which returns ZERO props
   * per cell at the DW-19 cell size. Standing rule 7: the isolation that proves
   * the diagnosis stays in the build, and it makes the before and after
   * measurable against ONE binary.
   */
  readonly scatterFair: boolean;
  /** `?propgrow=0` pins the prop pools at the old fixed 7,000 with no growth. */
  readonly propGrow: boolean;
  /** `?detail=0` drops the ground-detail card layer that sits under the props. */
  readonly detailCards: boolean;
  /**
   * `?propcull=0` turns per-instance frustum culling OFF on the understorey
   * batches, which is what the whole prop layer shipped with. It exists because
   * the trade behind that choice was measured at 9,340 props and the
   * understorey now runs at tens of thousands, in a RING around the player, so
   * most of it is behind the camera on any given frame.
   */
  readonly propCull: boolean;
  /**
   * `?grassshort=0` restores the RN-15 understorey height band (0.55 to 1.30 of
   * the authored blade height) AND the height-compounding distance upscale, so
   * the whole "the understorey reads as a crop field" change can be isolated in
   * ONE binary rather than as a build pair.
   *
   * RN-30 shipped this change with a binary pair because every argument the
   * scatter is constructed with is passed by `Boot.ts` and another lane owned
   * Boot that round. It is one line here and one in Boot, and it turns the only
   * remaining unisolated claim in the ground-art programme into a runtime one.
   */
  readonly grassShort: boolean;
  /**
   * `?scatterwet=1` restores scattering ON the pond bed, which is what the
   * layer shipped with until RN-46 and is the isolation for that fix (standing
   * rule 7: the measurement that proves the diagnosis stays in the build).
   */
  readonly scatterWet: boolean;
  /**
   * `?iblground=0` removes the GROUND half of the environment map (RN-64), so
   * every stock material goes back to a lower hemisphere containing the sky
   * model marched through the planet. It is a build-time switch rather than a
   * runtime one on purpose: the shell exists or it does not, and a runtime
   * toggle would leave a stale cube behind until the next rebuild trigger,
   * which would make a matched pair measure the wrong frame.
   */
  readonly iblGround: boolean;
  /**
   * `?iblgroundamp=` multiplies RN-64's ground radiance. The shipped value is 1
   * and it is NOT a look knob: it exists so that "this term measures near zero"
   * can be told apart from "this term does not reach its consumer", which are
   * the same reading and have opposite fixes.
   */
  readonly iblGroundAmp: number;
  /**
   * How far SCENERY canopy trees reach, in metres, and **it now ships at 0**.
   *
   * WG-116, Reid's ruling: "there should be no scenery trees. all trees should
   * be minable." This tier is the scenery, so it is retired, and the retirement
   * is a default rather than a deletion for one measured reason: `?canopy=620`
   * reproduces the WG-59 world in the SAME binary, which is the only way to
   * photograph what the ruling cost and what it bought without comparing two
   * builds with two streamed chunk sets and two shadow states. `?trees=` is the
   * tier that replaced it.
   *
   * It stays a distance rather than a boolean because the cost of a forest goes
   * as the SQUARE of it, so the same control sweeps the ladder (260 / 520 / 900
   * measured in one binary is what set the retired shipping value of 620).
   */
  readonly canopyRadiusM: number;
  /**
   * `?canopyshade=0` keeps the understorey at full density under a closed
   * canopy. The trees and the ground cover they shade are two separate terms
   * with two separate costs, and a single number that mixed them could be used
   * to make either one look free.
   */
  readonly canopyShade: boolean;
  /**
   * WG-67: `?rocks=0` places NO world rocks and is the one-binary control for
   * the whole rock pass, the same shape as `?canopy=0` one paragraph up.
   * `?rockdensity=` scales every biome's rock ask together and exists for the
   * measurement ladder, not for play; the shipped value is 1.
   */
  readonly rocks: boolean;
  /**
   * PH-94: `?station=0` installs NO orbital station and is the one-binary
   * control for it (standing rule 7). It matters more than most isolation
   * flags because the station is the FIRST thing to put a solid in
   * `StructureBodies` on a world with no base in it, and `KinematicBody.step`
   * skips the whole structural port on `count === 0`. So installing one flips
   * every bare world from "the port never runs" to "the port runs and answers
   * nothing", and this flag is how that is measured rather than argued.
   */
  readonly station: boolean;
  readonly rockDensity: number;
  /**
   * WG-116: how far streamed TREE harvest nodes reach, in metres. `?trees=0`
   * places none and is the one-binary control for the whole tree pass, and a
   * distance rather than a boolean for exactly `canopyRadiusM`'s reason: the
   * cost goes as the square of it, so the same control sweeps the ladder that
   * sets the shipping value. `?treedensity=` scales every biome's ask together
   * and exists for the ladder, not for play; the shipped value is 1.
   */
  readonly treeRadiusM: number;
  readonly treeDensity: number;
  /** WG-118: `?nodelod=0` draws every harvest node at its LOD0 geometry at all
   *  ranges, which is what the node batch did before it learned that its own
   *  assets ship `_LOD1` and `_LOD2`. `?nodecull=0` turns per-instance frustum
   *  culling back off. Two separate claims, so two separate controls. */
  readonly nodeLod: boolean;
  readonly nodeCull: boolean;
  /** WG-94: `?spires=0` drops `rock_spire.glb` from `NodeArt.ART`, so Mountains
   *  rocks are all boulders again AND the file is not fetched. */
  readonly spires: boolean;
  /** WG-91: `?forestdetail=0` puts Forest's understorey back on the shared
   *  `GROUND_DETAIL` meadow mix, which is what its neutrality is measured
   *  against rather than argued from. */
  readonly forestDetail: boolean;
  /**
   * `?proplod2=0` makes the UNDERSTOREY draw its LOD0 geometry at all ranges,
   * which is the state the four ground-detail cards were in until RN-45
   * authored their LOD2. It is the one-binary control for that asset change,
   * and it is needed precisely because an asset change otherwise forces a
   * build pair, which cannot hold the streamed chunk set equal.
   *
   * Scoped to the understorey rather than to every batch: the biome props have
   * had LOD2 since W4, and a control that also removes theirs measures 2.30 M
   * triangles against 972 k when the honest figure is 1.09 M against 972 k.
   */
  readonly propLod2: boolean;
  /** W5 gameplay layer. ?gameplay=0 isolates the terrain (standing rule 7). */
  readonly gameplay: boolean;
  /** W8 the assembly bay. ?vab=0 isolates it, standing rule 7 again. */
  readonly vab: boolean;
  /** W9 flight. `?flight=0` isolates the whole flight lane, standing rule 7. */
  readonly flight: boolean;
  /**
   * DW-31. `?sandbox=1` creates a SANDBOX world: everything placeable at no
   * cost, no research gate, no pack requirement, the whole catalogue in hand.
   *
   * It is a mode and not a debug knob, so unlike every other flag in this record
   * it is carried into the save slot and the slot is keyed by it: a sandbox
   * world and a survival world are different saves and neither can overwrite or
   * be mistaken for the other (game/GameMode.ts, game/SaveGame.ts).
   */
  readonly sandbox: boolean;
  /**
   * Near voxel mesh: draw only the faces of an EDIT. `?voxelskin=0` restores
   * the whole solid-to-air shell W5 drew, which is the layer that put a field
   * of dark 1 m pyramids over untouched ground (standing rule 7: the isolation
   * that proves the diagnosis has to survive in the build).
   */
  readonly voxelSkinEditsOnly: boolean;
  /** `?voxelnear=0` keeps the near voxel mesh out of the scene entirely, so a
   *  capture can attribute geometry to it or to the terrain chunks. */
  readonly voxelNear: boolean;
  /** `?aimshell=1` marches the aim ray against the raw 1 m solidity shell, as
   *  W5 did, so a behaviour change can be attributed to that swap (rule 7). */
  readonly aimShell: boolean;
  /** WG-22. Draw the levelling footprint decal. `?levelring=0` isolates it. */
  readonly levelRing: boolean;
  /**
   * Override the SURFACE-band nearDepthCutoff. 0 keeps DepthPolicy's answer.
   * Lowering it pulls coarser chunks into the near 1:1 scene, which is how the
   * near/far horizon agreement is measured: render the same view twice with
   * different cutoffs and diff the pixels.
   */
  readonly nearCutoff: number;
  /** of::FloatingOrigin rebase threshold in metres. ?rebase= for walk tests. */
  readonly rebaseM: number;
  /** Character ground speed in m/s; sprint is 2x. ?walkspeed= for walk tests. */
  readonly walkSpeedMps: number;
  /** Render-time interpolation of the 60 Hz capsule. ?interp=0 is the W1 behaviour. */
  readonly interpolate: boolean;
  /**
   * `?anim=0` freezes every skeletal AnimationMixer in the client: the player
   * body, the first-person arms, and any rigged creature. Rigs still load and
   * draw, in their exported rest pose, and nothing ticks. Two uses, RN-121:
   * the NEGATIVE CONTROL for any clip-playback claim (a frame pair that moves
   * pixels with animation on must be bit-identical with it off, or the motion
   * being measured is not the mixer's), and the perf isolator that prices the
   * mixer tick as the only difference inside one binary.
   */
  readonly anim: boolean;
  /**
   * Clear colour as 0xRRGGBB. ?clear=ff00ff paints the void magenta, which is
   * the only way to tell a HOLE in the terrain from a dark-shaded steep face:
   * against the default black sky the two look identical.
   */
  readonly clearColor: number;
  /**
   * Depth-probe separation as a FRACTION of each scale's distance. The five
   * scales span 1 m to 400,000 km, so one absolute separation cannot test them
   * all. 0 (the default) uses each scale's measured budget, which makes a plain
   * run a regression gate; ?zsep=0.001 overrides all five, which is how those
   * budgets were swept in the first place.
   */
  readonly zSepRatio: number;
  /**
   * The post-processing stack's flags and tunables (render/post/PostConfig.ts).
   * `?post=0` restores the pre-stack path exactly: no render target, no
   * composite, three's own ACES straight to the canvas. Every effect inside it
   * switches off on its own, per standing rule 7.
   */
  readonly post: PostSettings;
}

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
    maxDepth: Math.min(16, Math.max(4, num(p, 'maxdepth', 14) | 0)),
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
