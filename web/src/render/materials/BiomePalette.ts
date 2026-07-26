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

export function biomeColorFlat(): Float32Array {
  const out = new Float32Array(BIOME_COUNT * 3);
  const cols = biomeColorArray();
  for (let i = 0; i < BIOME_COUNT; ++i) {
    out[i * 3] = cols[i].r; out[i * 3 + 1] = cols[i].g; out[i * 3 + 2] = cols[i].b;
  }
  return out;
}
