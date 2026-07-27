// Seed, quality tier, tunables and URL-parameter parsing. The single source of
// truth for "what run is this". ARCHITECTURE.md section 11.3: every stochastic
// value derives from Config.seed through /core's hash chain, so ?seed= alone
// makes a run reproducible.

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

// lat 2 / lon 144 on Forge at seed 0x0bf00d01: a Hills valley floor at 2,963 m
// with 3,200 m of relief and peaks 2,668 m above it inside a 6 km box, found by
// sweeping baseHeight and biomeAt through the oracle. The default start is
// deliberately on rugged land: an ocean or plateau start makes every terrain
// screenshot useless.
const HOME = { lat: 2, lon: 144 };

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
  const tRaw = p.get('t');
  const scenario: Scenario = {
    lat: num(p, 'lat', base.lat),
    lon: num(p, 'lon', base.lon),
    alt: num(p, 'alt', base.alt),
    sunDot: num(p, 'sundot', base.sunDot),
    pitchDeg: base.pitchDeg,
  };
  return {
    seedLo: seed.lo,
    seedHi: seed.hi,
    seedText: seed.text,
    scenarioName,
    scenario,
    sunTExplicit: tRaw === null || !Number.isFinite(Number(tRaw)) ? null : Number(tRaw),
    quality: parseQuality(p.get('quality')),
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
    atmosphere: p.get('atmos') !== '0',
    stars: p.get('stars') !== '0',
    props: p.get('props') !== '0',
    density: Math.max(0, num(p, 'density', 1)),
    scatterFair: p.get('scatterfair') !== '0',
    propGrow: p.get('propgrow') !== '0',
    detailCards: p.get('detail') !== '0',
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
    zSepRatio: Math.max(0, num(p, 'zsep', 0)),
    clearColor: (() => {
      const v = p.get('clear');
      if (v === null) return 0x000000;
      const n = Number.parseInt(v.replace('#', ''), 16);
      return Number.isFinite(n) ? n : 0x000000;
    })(),
  };
}
