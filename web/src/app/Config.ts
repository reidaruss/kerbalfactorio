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
}

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
  // Depth-precision probe (ARCHITECTURE.md section 3.3).
  zfight: { ...HOME, alt: 900, sunDot: 0.55 },
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
  /** Draw the skirt index range as well as the interior. ?skirts=1 enables. */
  readonly skirts: boolean;
  /** StreamConfig.skirtFraction override; 0 keeps the default. */
  readonly skirtFraction: number;
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
  const scenarioName = p.get('scenario') ?? 'space';
  const base = SCENARIOS[scenarioName] ?? SCENARIOS.space;
  const tRaw = p.get('t');
  const scenario: Scenario = {
    lat: num(p, 'lat', base.lat),
    lon: num(p, 'lon', base.lon),
    alt: num(p, 'alt', base.alt),
    sunDot: num(p, 'sundot', base.sunDot),
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
    maxDepth: Math.min(14, Math.max(4, num(p, 'maxdepth', 12) | 0)),
    // OFF by default at W1. of::TerrainStreamer sizes the skirt apron in
    // proportion to the chunk, so even at skirtFraction 0.02 the rings render as
    // ribbons and shelves lying across the landscape rather than as hidden
    // crack plugs. The resident set is a complete quadtree partition, so the
    // only cracks are LOD T-junctions; revisit at W2 when a walk makes them
    // observable. ?skirts=1 turns them back on for that comparison.
    skirts: p.get('skirts') === '1',
    skirtFraction: num(p, 'skirtfrac', 0),
  };
}
