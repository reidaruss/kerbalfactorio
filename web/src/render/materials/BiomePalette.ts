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
 *
 * RN-2635 (World Audit R5 rank 3, THE DRY SEA IS A CHROMA BOUNDARY). Forge has
 * no ocean, so the OLD `0x14406e` painted a dry seabed the colour of deep
 * water: a saturated cool blue sitting inside a warm aerial frame, which is
 * simultaneous contrast doing the eye's own work -- a 260-px-apart, same-row
 * instrument (docs/web/WORLD-AUDIT-R5-2026-08-22.md section 3.3,
 * `forestair` row 372) read the plate as only 14.63 counts less warm than a
 * nearby cream patch the audit LABELLED "Beach", and concluded the boundary
 * was subtle. A biome-id paint arm (BiomeIdPaint.ts, `?biomeid=1`) built
 * BEFORE this row was touched (the R5 verifier's binding rule; R4's rank 1
 * died of an unproven rectangle) found the audit's own cream window sampled
 * FOREST, not Beach (its calibrated fill is (178,226,123), matching the
 * cream's own dominant colour to one count once measured correctly -- see
 * BiomeIdPaint.ts for the calibration and its own correction note): at row
 * 372 the true class sequence, walked column by column, is Ocean (x<1290) ->
 * Beach (x 1300-1410) -> Forest (x>1440), with a narrow band at ~x1420
 * reading as Plains that is **UNPROVEN and probably an INSTRUMENT ARTEFACT,
 * not a real biome** (found by the R5 verifier): `vBiomeIdx` is an
 * interpolated varying and Beach(1)-to-Forest(3) is the one non-adjacent-
 * index interface on this frame, so `int(v+0.5)` fabricates a Plains(2) band
 * at the interpolation's midpoint by construction, with no Plains geometry
 * anywhere near it (BiomeIdPaint.ts's own header has the mechanism and why
 * no Ocean/Beach interface shows the same artefact). The TRUE Ocean/Beach
 * warm step at that row is **25.46 screen counts** (14.23 at Ocean
 * x[1150,1280) to 39.69 at Beach x[1300,1400)), bigger than what the audit
 * measured, not smaller, because its own window was one class too far out.
 *
 * TARGETED IN ALBEDO, per the verifier's rule that a screen count is not an
 * albedo count once the ~92 per cent additive airlight floor (RN-2540) is in
 * the pixel. Isolated with the EXISTING isolator, `?terrainpaint=1` (zeroes
 * the source radiance, leaving airlight alone): at row 372 the airlight's own
 * warm is nearly IDENTICAL at both true patches (27.11 at Ocean's x[1150,1280),
 * 28.33 at Beach's x[1300,1400), a 1.22-count spread, because the sky/haze
 * direction is nearly the same for both) so the additive floor cancels almost
 * completely out of the DIFFERENCE and the screen warm gap is carried by the
 * surface term almost exactly (measured surface-term warm -12.88 at Ocean,
 * +11.36 at Beach, summing with the two airlight readings to 14.23 and 39.69
 * to the digit). Converting the old hex to linear sRGB gives Ocean's own
 * albedo warm (R-B) at **-0.1489** against Beach's **+0.2200**, a 0.3689
 * linear-albedo gap. **THIS CANCELLATION ARGUMENT IS A SANITY CHECK, NOT A
 * LICENSE FOR THE SHIPPED VALUE**: it is exact only for a purely ADDITIVE
 * pipeline (source term times transmittance plus a class-independent
 * floor), and candidate A below disproves that it extends to predicting a
 * hex from a target screen delta -- its own linear-albedo estimate said
 * 44.6 per cent of the gap would survive and the MEASURED screen result was
 * 8.8 per cent, because ACES tonemap + grade compress nonlinearly on top of
 * it. What actually licenses candidate B is that BOTH candidates were BUILT
 * AND MEASURED on screen rather than shipped off one prediction; the
 * cancellation argument's job is only to say WHERE in albedo space the
 * screen gap is coming from, not how far to move a hex.
 *
 * TWO CANDIDATES WERE BUILT AND MEASURED for exactly that reason. Candidate A
 * targeted Beach's own hue (36.85 deg) with value and saturation lowered
 * (0.702->0.42, 0.262->0.15); the RGB reconstruction from those HSV
 * parameters was arithmetic error, and the hex actually built and measured,
 * `0x6d6558`, is HSV **(37.14 deg, 0.193, 0.427)** -- close in hue, further
 * off in saturation/value than intended, but it is the ACTUAL built and
 * measured candidate and the number below is honest about what was tested:
 * 44.6 per cent of the ALBEDO warm gap remained (0.1647 of 0.3689), but on
 * screen the row-372 warm step fell from 25.46 to **2.25 counts (8.8 per
 * cent)** -- the nonlinearity compresses harder than the linear estimate near
 * Beach's own bright end, and 2.25 counts reads as FLATTENED rather than
 * "a gentler boundary", failing the "must still be legible from the air"
 * half of the brief (its 3x crop is plainly flatter and warmer than shipped
 * by eye, yet the plate STILL reads as a lake -- see rendering.md 2.41.6 for
 * why that is itself evidence about what "reads as water" is made of). The
 * shipped value below is candidate B: the midpoint, in LINEAR albedo,
 * between the old Ocean and candidate A (warm -0.0472, luma 0.0912, 72.4 per
 * cent of the albedo gap left against Beach), which measured on screen at
 * the same row-372 windows: warm step **25.46 -> 12.60 counts (49.5 per
 * cent)**, luma step 23.78 -> 17.14 counts (72.1 per cent). Beach's own two
 * windows read 39.69 / 39.81 / 39.91 warm across the three builds measured
 * (original, candidate A, candidate B) -- EVERY PRINTED NUMBER FROM THOSE
 * CAPTURES MATCHED TO THE DIGIT; PNG byte-identity was never checked and is
 * NOT implied (this harness's own repeat-capture noise floor, measured by
 * the R5 verifier, is up to 46 per cent of pixels differing between two
 * captures of the SAME build at `pondside`, see NUMBERS.md). Ocean is now
 * the SECOND-darkest class on the palette (Forest's 0.0534 is the only
 * darker dry biome; Ocean's new luma is 0.0912) -- cooler and darker than
 * every OTHER dry biome, which keeps it clear of the Hills/Plains band
 * (0.13-0.14) without being the class extreme it no longer needs to be. Its
 * shipped sRGB (80,85,100) is still visibly blue-grey, not sand-toned, while
 * no longer reading as SATURATED deep water, which is what makes it
 * defensible under EITHER of Reid's pending coastline rulings (section
 * 7.1/7.4 of the R5 audit, water vs desert): a cool, damp-toned grey-mud
 * reads as a dry lakebed today and loses nothing if the class is later
 * flooded. BEACH'S OWN ROW IS UNCHANGED: the fix
 * is Ocean moving part of the way toward the frame's general warmth, not the
 * two rows meeting in the middle, so a biome that reads "sand" today keeps
 * reading that way and only the ex-water class moves.
 *
 * `pondside`'s REAL water is NOT a different material and this edit's safety
 * there is INCIDENTAL, not structural, per the R5 verifier's correction of
 * this file's first printing (which claimed the opposite): `pondside` draws
 * with the SAME terrain material every other biome does, and
 * `TerrainFragAlbedo.glsl.ts:411-412` applies `ofArtWetTint` ON TOP OF
 * `albedo`, which is built from THIS table's `uBiomeColor[bi]` earlier in
 * the same fragment. The verifier proved it directly: zero Ocean-paint
 * pixels anywhere in the whole `pondside` frame under `?biomeid=1`, because
 * every pond world-gen has placed so far sits on Hills ground, not Ocean --
 * a fact about the current world, not a property of the shader. **THE
 * HAZARD THIS LEAVES:** if a future world-gen change ever classifies a
 * pond's bed as Ocean, `ofArtWetTint` will tint THIS row's new hex and no
 * code change would be needed to reach it silently. Nothing in this lane
 * closes that hazard; it is recorded so the next lane touching pond
 * placement or the Ocean row knows the two are not already separated.
 */
const HEX = [
  0x505564, // RN-2635: dry seabed, candidate B (see the block comment above):
            // the linear-albedo midpoint between the old blue and a
            // Beach-hue candidate that overshot into flattening; cool,
            // dark, no longer SATURATED deep-water blue. Was 0x14406e
            // (R5 audit rank 3, "the dry sea is a chroma boundary").
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
