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

/**
 * RN-347. THE VEGETATED BIOMES STOP BEING PAINTED THE COLOUR OF THEIR OWN
 * VEGETATION, AND THIS IS THE SINGLE LARGEST THING IN A FOREST FRAME.
 *
 * WHAT THE PICTURE SHOWED, and no statistic in this pass found it first. Reid,
 * on the forest floor: "Still plato-y smooth pastel." Standing eye at the Forest
 * site pitched 26 degrees down, `docs/screenshots/RN347_floor_before.png` is a
 * large, smooth, saturated emerald SHEET with sparse tufts standing on it. The
 * tufts are the understorey and they were re-authored twice. The sheet is THIS
 * TABLE, it is most of the pixels, and nobody had looked at it since W1.
 *
 * THE ERROR IS CATEGORICAL, NOT A MATTER OF DEGREE. `biomeAt` is a classifier
 * over CLIMATE, and this table was filled in by naming the classes: forest is
 * green, plains is green, hills is green. But the terrain material draws the
 * GROUND, and the ground under a forest is not a forest. It is litter, humus,
 * root, stone and bare soil, and the green belongs to the 3.2 million detail
 * cards per square kilometre that stand ON it. Painting both the same green
 * means the layer that is supposed to READ as vegetation has nothing to read
 * against, and a plant loses its silhouette into a background of its own colour.
 * That is why two passes of silhouette work on the understorey changed nothing
 * Reid could see: the silhouettes were correct and they were invisible.
 *
 * ART-DIRECTION.md asks for "grounded, muted, layered colour, not pastel, not
 * saturated primaries" and for "value and material contrast" to do the work.
 * The old triple for Forest is HSV saturation 0.415 at hue 123 degrees, i.e. a
 * green primary, and there is no value contrast available between a green
 * ground and a green plant at all.
 *
 * WHAT CHANGED, and the three that did NOT are as deliberate as the four that
 * did. Mountains, Polar, Regolith, MoonHighland and CraterFloor were already
 * substrate colours and are untouched, which is the control: any measured
 * difference at those sites is a bug in this change.
 *
 *   biome    old       S      new       S     what the new colour is
 *   Beach    c8b48a  0.310    b3a184  0.263  damp-to-dry sand, a stop darker
 *   Plains   5f7d38  0.552    6d6a47  0.349  dry turf over pale soil
 *   Forest   2f5230  0.415    41392b  0.339  leaf litter and humus
 *   Hills    6f7346  0.391    6b6650  0.252  thin turf over stony ground
 *
 * Every one moves DOWN in saturation and toward the soil it stands on, and
 * Forest moves furthest because a closed canopy is where least green ground
 * survives. Beach darkens rather than desaturating much, because the Beach
 * measurement in this pass was the opposite complaint: it is the one site where
 * the frame was already too bright (p50 150 to 172 under the new curve).
 *
 * THIS IS ALSO WHERE THE `dugAlbedo` PROFILE FINALLY MAKES SENSE. RN-80 shipped
 * topsoil at (0.27, 0.21, 0.145), i.e. brown, because a pit floor the colour of
 * a lawn read as absurd. The surface has now been brought into agreement with
 * the material one metre below it instead of contradicting it.
 *
 * RN-2320 SUPERSEDES FOREST'S OWN ROW, and the numbers above are kept rather
 * than edited because they are still the record of what RN-347 fixed; this is
 * what the audit found ONE LAYER FURTHER IN. World Audit R2's own ranked gap 3
 * and RN-2275's owed item 3 both name the same arithmetic: this hex is not just
 * the walking-level litter RN-347 wanted, it is ALSO what every FAR clearing
 * between wooded stands paints (`TerrainCoverFar`'s chroma rotation is
 * luminance-PRESERVING by construction, so it cannot brighten a dark substrate,
 * only rotate its hue), and it is the base the crown card's self-shadow floor
 * is compared against (CanopySelfShadow.ts). At the old 0x41392b (luma 0.0422)
 * the margin between a self-shadowed wood and its own clearing was as little as
 * -0.30 counts at `forestairnoon`'s own local noon (rendering.md 2.19.3) --
 * correct in sign, but thin enough that a slightly darker substrate or a
 * slightly brighter card would have put it back over the line. 0x4a4030 (linear
 * ~(0.068, 0.051, 0.030), luma 0.0533, HSV S 0.352 -- still inside RN-347's own
 * "vegetated biomes sit at 0.25 to 0.35" band, section 3 of this file's own
 * history) is a moderate, DELIBERATE lift toward "duff and moss over soil, with
 * more of the clearing's own light reaching it" rather than "pure shaded
 * litter", not a return to green: it is warmer as well as a little brighter
 * (TINT_W's own warm-litter axis in BiomeMaterial.ts is unchanged and the new
 * hex sits on the same warm side of neutral the old one did). It was chosen
 * empirically against two constraints pulling opposite ways, both measured on
 * this build: (1) `forestfloor`'s own committed box (RN-352's standing-eye
 * calibration pose, the same one RN-347 tuned against) must still read as
 * litter with a crack network by eye and must not move outside a grade-intent
 * band -- an earlier, larger candidate (0x5a4f36, luma 0.080) moved `box` from
 * 22.82 to 42.48, which visibly re-lit the whole understorey carpet (the
 * ground's own substrate feeds `GrassPalette.coverAlbedo` as the ROTATION'S OWN
 * BASE, RN-2145, so a brighter substrate cascades into brighter grass at
 * exactly the same luminance ratio) and was rejected; 0x4a4030 moves the same
 * box to 28.64, +25%, visibly unchanged by eye (`docs/screenshots/RN2320_
 * forestfloor.png` against the pre-lane frame). (2) RN-2275's four wood-versus-
 * clearing pairs must still invert (wood darker than its own clearing) at every
 * sun angle -- they do, and by a healthier margin than before rather than a
 * thinner one: see this file's own header note below the table and rendering.md
 * 2.21 for the requoted four pairs. Swept by eye against both constraints
 * together; there is no registered page-param for this hex (it is a table
 * lookup, not a uniform, and `?splat=0`/`?canopy=0` already isolate the terms
 * that read it).
 */
const HEX = [
  0x14406e, // Ocean
  0xb3a184, // Beach: sand, a stop darker and less golden
  0x6d6a47, // Plains: dry turf over pale soil, not a lawn
  0x4a4030, // Forest: RN-2320, duff-and-moss over soil (was 0x41392b, RN-347)
  0x6b6650, // Hills: thin turf over stony ground
  0x7c7a74, // Mountains: unchanged, already substrate
  0xe8eef2, // Polar: unchanged
  0x8d8579, // Regolith: unchanged
  0xa9a294, // MoonHighland: unchanged
  0x5c574e, // CraterFloor: unchanged
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

// RN-1257's per-biome MATERIAL record lives in BiomeMaterial.ts (400-line cap).
// It is deliberately NOT re-exported from here, which is the opposite of the
// CascadeShadow precedent and cost one page load to learn: BiomeMaterial imports
// BIOME_COUNT from this file to assert its own row count, so a re-export closes
// the cycle and the assertion runs while BIOME_COUNT is still undefined. It
// threw on the first frame, which is the guard doing exactly its job. The three
// consumers import from BiomeMaterial.js directly instead.

export function biomeColorFlat(): Float32Array {
  const out = new Float32Array(BIOME_COUNT * 3);
  const cols = biomeColorArray();
  for (let i = 0; i < BIOME_COUNT; ++i) {
    out[i * 3] = cols[i].r; out[i * 3 + 1] = cols[i].g; out[i * 3 + 2] = cols[i].b;
  }
  return out;
}
