// The one biome -> colour table. /core's biomeAt is a HARD classifier (one biome
// per direction), so W1 renders flat per-vertex biome colour and lets the
// rasterizer interpolate across a triangle; that is the barycentric blend
// WASM-BRIDGE.md section 4.8 describes, and it is free. The 8-layer KTX2 array
// texture replaces the palette at W4.

import * as THREE from 'three';

/** Index == the /core Biome enum. */
export const BIOME_NAMES = [
  'Ocean', 'Beach', 'Plains', 'Forest', 'Hills',
  'Mountains', 'Polar', 'Regolith', 'MoonHighland', 'CraterFloor',
] as const;

const HEX = [
  0x14406e, // Ocean
  0xc8b48a, // Beach
  0x5f7d38, // Plains
  0x2f5230, // Forest
  0x6f7346, // Hills
  0x7c7a74, // Mountains
  0xe8eef2, // Polar
  0x8d8579, // Regolith
  0xa9a294, // MoonHighland
  0x5c574e, // CraterFloor
];

export const BIOME_COUNT = BIOME_NAMES.length;

/** Linear-space RGB triples, ready for a vec3 array uniform. */
export function biomeColorArray(): THREE.Color[] {
  return HEX.map((h) => new THREE.Color().setHex(h, THREE.SRGBColorSpace));
}

/**
 * The terrain's own ALBEDO rule, for geometry that cannot run the terrain
 * shader. `flat` is dot(normal, localUp) and `band` is relief / maxRelief.
 *
 * THIS IS A SECOND COPY OF FOUR LINES OF TerrainShader.ts AND THEY MUST MOVE
 * TOGETHER. GLSL cannot call TypeScript, and the alternative was worse in both
 * directions: giving the near voxel mesh a colour of its own (a brown that
 * reads as a different substance from the hillside it is cut into, measured at
 * 33.6% off) or shading it with the terrain material (which ignores three's
 * light list entirely and so cannot see the headlamp, the one thing that makes
 * a tunnel readable). Colour comes from here; light stays Headlamp's.
 */
export function terrainAlbedo(biome: THREE.Color, flat: number, band: number,
                              out: THREE.Color): THREE.Color {
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  out.setRGB(0.30, 0.28, 0.26).lerp(biome, smooth(0.55, 0.88, flat));
  const snow = smooth(0.86, 1.14, band) * smooth(0.45, 0.85, flat) * 0.9;
  out.lerp(new THREE.Color(0.88, 0.92, 0.98), snow);
  return out.multiplyScalar(0.82 + 0.26 * smooth(0.0, 0.7, band));
}

/**
 * WHAT DUG GROUND LOOKS LIKE (RN-80): the underground revealed by digging,
 * as a function of DEPTH BELOW THE DESIGNED SURFACE. Before this rule the
 * voxel skin painted every dug face with the surface albedo, so the floor of
 * a three-metre pit was the same grass green as the lawn around it and a
 * tunnel read as a green-walled tube.
 *
 * The profile is soil science compressed to three stops: TOPSOIL (dark,
 * organic, only the first half metre), SUBSOIL (lighter mineral earth), then
 * BEDROCK (the terrain shader's own rock constant, so a deep cut arrives at
 * the same substance a cliff face is drawn with; one authority on what rock
 * looks like). `m01` is a per-vertex mottle in [0,1] the caller derives from
 * position, because a Lambert vertex colour with no variation reads as
 * painted plastic at headlamp range.
 *
 * The rim keeps the surface rule: a vertex within 5 cm of the designed
 * surface is the edge of the hole seen from above, and darkening it draws an
 * outline around every edit that reads as scorching.
 */
export function dugAlbedo(biome: THREE.Color, flat: number, band: number,
                          depthM: number, m01: number,
                          out: THREE.Color): THREE.Color {
  terrainAlbedo(biome, flat, band, out);
  if (depthM <= 0.05) return out;
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // The same altitude exposure terrainAlbedo applies, so a dig at altitude
  // does not glow against its own surroundings.
  const expose = 0.82 + 0.26 * smooth(0, 0.7, band);
  const mottle = (0.86 + 0.26 * m01) * expose;
  const soil = new THREE.Color(0.27, 0.21, 0.145).multiplyScalar(mottle);
  const sub = new THREE.Color(0.42, 0.335, 0.235).multiplyScalar(mottle);
  const rock = new THREE.Color(0.30, 0.28, 0.26)
    .multiplyScalar((0.90 + 0.18 * m01) * expose);
  out.lerp(soil, smooth(0.05, 0.40, depthM));
  out.lerp(sub, smooth(0.75, 1.9, depthM) * 0.85);
  out.lerp(rock, smooth(2.3, 4.5, depthM));
  return out;
}

/**
 * Per-biome GROUND TEXTURE channel weights (RN-78): how much of each of
 * RN-77's four detail fields a biome's flat cover shows. Order matches the
 * texture channels: x grass clump, y rock grain, z granular, w clod.
 *
 * These are AMPLITUDES, not a partition. Each channel arrives at the shader
 * centred on 0.5 with an equal, known spread (groundtex.py's _centre), so a
 * weight vector's absolute sum is that biome's total modulation amplitude and
 * the ratios are its material character. Sums sit near 0.3, except Polar,
 * deliberately subdued because drifted snow is smooth and the altitude snow
 * band above it ships clean on purpose. THE 0.3 WAS MEASURED DOWN FROM 0.6:
 * with both sample scales stacked the 0.6 table produced a +/-45% modulation
 * that photographed as dark speckle soup at the RN-15 camera (89% of moved
 * pixels darker, the tone curve compressing the bright half), and 0.35 of it
 * read as turf. Halving the table is the calibrated middle.
 *
 * Kept beside the colour table because they are indexed by the SAME /core
 * Biome enum, and a new biome that gets a colour but no weights should fail
 * review in one screenful.
 */
const MAT_W: [number, number, number, number][] = [
  [0.00, 0.04, 0.20, 0.06], // Ocean: the visible part is the sandy bed
  [0.00, 0.03, 0.26, 0.05], // Beach: sand, grain dominant
  // RN-149: Plains up 0.19 -> 0.24 (denser grass clumping was the second
  // pass's brief) and Forest clod up 0.14 -> 0.18 (the litter read), both
  // still inside the calibrated regime: the RN-78 speckle-soup failure was a
  // table SUM near 0.6 with both scales stacked; these sums move 0.32 -> 0.37
  // and 0.32 -> 0.36, nowhere near it, and the pairs are re-photographed.
  [0.24, 0.00, 0.04, 0.09], // Plains: denser turf clumping
  [0.15, 0.00, 0.03, 0.18], // Forest: turf under heavy litter/clod
  [0.21, 0.00, 0.03, 0.08], // Hills: the strongest turf read
  [0.04, 0.14, 0.08, 0.04], // Mountains: scree, rock grain on the flat too
  [0.00, 0.04, 0.08, 0.03], // Polar: subdued; snow is smooth
  [0.00, 0.08, 0.15, 0.07], // Regolith: gravel and dust
  [0.00, 0.10, 0.14, 0.05], // MoonHighland: coarser regolith
  [0.00, 0.12, 0.12, 0.06], // CraterFloor: broken rock and dust
];

/** Vector4 array for the uBiomeMat uniform, index == the /core Biome enum. */
export function biomeMatWeights(): THREE.Vector4[] {
  return MAT_W.map(([x, y, z, w]) => new THREE.Vector4(x, y, z, w));
}

/**
 * Per-biome RELIEF channel weights (RN-148): how much of each of RN-147's four
 * ASYMMETRIC height fields a biome's flat cover shows through the bump. Order
 * matches of_ground_relief's channels: x sand ripple, y clod, z scree step,
 * w leaf litter.
 *
 * These weight a HEIGHT that feeds ofArtBump (lighting normal only), so their
 * scale is not comparable to MAT_W's albedo percentages: the bump amplifies a
 * field by its own frequency, and these fields are far finer than the vnoise
 * octaves. Start table authored by intent, then CALIBRATED BY PHOTOGRAPH at
 * grazing sun exactly as MAT_W was measured down from 0.6 (asymmetry is
 * invisible at noon, so the calibration frames are morning and evening).
 *
 * Biome intent, stated so a retune has something to be checked against:
 * Beach and the visible Ocean bed are RIPPLE-MARKED (the classic, and sand
 * ripples are asymmetric by formation); Forest floor is LITTER; Plains and
 * Hills are clumpy turf via CLOD; Mountains flat ground is SCREE; Polar stays
 * near zero BY DESIGN (drifted snow is smooth and RN-78 shipped it clean on
 * purpose; a snowfield with dirt clods is the named failure mode here).
 */
const RELIEF_W: [number, number, number, number][] = [
  [0.30, 0.05, 0.05, 0.00], // Ocean: ripple-marked sandy bed
  [0.42, 0.06, 0.03, 0.00], // Beach: ripples dominant
  [0.05, 0.30, 0.02, 0.08], // Plains: clumpy turf
  [0.00, 0.12, 0.02, 0.40], // Forest: leaf litter
  [0.04, 0.32, 0.05, 0.10], // Hills: heavier clod
  [0.02, 0.08, 0.40, 0.02], // Mountains: scree on the flat
  [0.03, 0.03, 0.02, 0.00], // Polar: near zero; snow is smooth
  [0.06, 0.12, 0.22, 0.02], // Regolith: gravel steps
  [0.05, 0.10, 0.26, 0.02], // MoonHighland: coarser steps
  [0.04, 0.10, 0.30, 0.03], // CraterFloor: broken rock
];

/** Vector4 array for the uBiomeRelief uniform, index == the /core Biome enum. */
export function biomeReliefWeights(): THREE.Vector4[] {
  return RELIEF_W.map(([x, y, z, w]) => new THREE.Vector4(x, y, z, w));
}

export function biomeColorFlat(): Float32Array {
  const out = new Float32Array(BIOME_COUNT * 3);
  const cols = biomeColorArray();
  for (let i = 0; i < BIOME_COUNT; ++i) {
    out[i * 3] = cols[i].r; out[i * 3 + 1] = cols[i].g; out[i * 3 + 2] = cols[i].b;
  }
  return out;
}
