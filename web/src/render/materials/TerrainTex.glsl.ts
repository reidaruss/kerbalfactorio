// THE TEXTURED SURFACE: the packed detail-texture sample (`of_ground`) and the
// specular lobe that reads its roughness, plus the three constants that scale
// them.
//
// Split out of TerrainArt.glsl.ts at the 400-line cap (2.2 rule 1), on the
// TerrainFine/TerrainMid precedent. A leaf module of GLSL text and tuning
// constants that imports nothing; TerrainArt.glsl.ts imports and RE-EXPORTS
// all of it, so every existing call site keeps working. Nothing here changed
// in the move.
//
// TEX and SPEC are one file because they are one chain: TEX_SCALE_GAIN and
// TEX_FINE_REPEATS set what the detail sample contains, and ROUGH_GRAIN reads
// that same sample's roughness channel into the lobe. Splitting them would put
// a producer and its only consumer in two files.

/**
 * THE GROUND TEXTURE MIX (RN-78), the fifth term: RN-77's four packed tiling
 * detail fields (R grass clump, G rock grain, B granular, A clod) combined
 * into ONE signed albedo modulation.
 *
 * THE COORDINATE DECISION, stated because the brief asked for it explicitly.
 * The texture is sampled on `vChunkUv`, RN-50's per-quad chunk UV, and NOT on
 * planet-centred metres, and at the near ring the UV can carry texture
 * lookups outright. Three facts make that true and each was the failure mode
 * of the alternative:
 *
 *  1. PRECISION. pM's float32 quantum at Forge's surface is 0.03125 m against
 *     this texture's 3.5 mm texel, so a pM-keyed lookup would quantise to ~9
 *     texels: stair-blocks wider than the near-field pixel footprint, plus a
 *     dead uv derivative that breaks hardware mip selection (RN-45's arcs,
 *     reached through the sampler instead of dFdx). The chunk UV's step is
 *     0.883 mm on a depth-14 chunk, a quarter of a ground pixel at 2 m.
 *  2. SEAMS. The repeat counts are INTEGERS per quad (16 and 5), so at a
 *     shared edge between same-depth chunks one chunk's fract(k*1.0) meets
 *     the other's fract(k*0.0) and the phase is continuous by arithmetic.
 *     Non-integer frequencies (the bump's 14.0/5.3 octaves get away with it
 *     on sub-metre lighting detail) would put a visible albedo step on every
 *     chunk edge.
 *  3. LOD. The UV normalises over the quad, so the texture's world size
 *     doubles at every LOD step; that is RN-50's honest cost unchanged. It is
 *     tolerable here for the same reason it was there, plus one better: the
 *     term fades over 45 to 90 m, inside which the streamer is at max depth,
 *     AND every channel is authored centred on 0.5, so a minified sample
 *     converges to the modulation identity on its own before either gate acts.
 *
 * THE MIX. `matW` is the per-biome channel amplitude vector (BiomePalette's
 * biomeMatWeights): weights, not a partition, so a biome states how much of
 * each material character it shows and the sum IS its texture amplitude. The
 * rock-grain branch rides `coverSel`, the same slope smoothstep that selects
 * rock albedo, so scree and cliff faces grain up exactly where they stop
 * being cover, with no second gate to disagree with the first. The 0.55 on
 * the second scale keeps the 11.6 m repeat subordinate to the 3.6 m one; the
 * 0.62 on the rock branch is the one number tuned by looking, and it is
 * higher-contrast than any biome's cover because a rock face is all edges.
 */
export const TERRAIN_ART_TEX = /* glsl */`
  // RN-1257. THE THREE-TAP BLEND. Split out of ofArtTexMix so the per-biome
  // FREQUENCY partition and the per-biome CHANNEL amplitude stay two separate
  // questions with two separate tables, which is the whole reorganisation:
  // MAT_W says how much, SCALE_W says at what size.
  //
  // OF_TEX_SCALE_GAIN carries the total gain the shipped two-tap blend had
  // (1 + 0.55), so a scale row of (0, 1/1.55, 0.55/1.55) reproduces it to the
  // last bit and ?biomescale=0 is an EXACT control rather than a near one.
  vec4 ofArtTexBlend(vec4 gF, vec4 gM, vec4 gC, vec3 sw) {
    return OF_TEX_SCALE_GAIN * (sw.x * (gF - vec4(0.5))
                              + sw.y * (gM - vec4(0.5))
                              + sw.z * (gC - vec4(0.5)));
  }

  // Unchanged in meaning; it now takes the BLENDED signed field rather than
  // two raw samples, so the published shape of the mix (rock grain on the
  // steep branch, the biome dot on cover, one shared coverSel gate) is
  // untouched by RN-1257 and only its input widened.
  float ofArtTexMix(vec4 g, vec4 matW, float coverSel) {
    return mix(g.g * 0.34, dot(g, matW), coverSel);
  }
`;

/**
 * THE SPECULAR LOBE (RN-731), the seventh term, and the one that reaches every
 * frame rather than a band of ground.
 *
 * WHAT WAS ACTUALLY WRONG. Until this landed the terrain's entire lighting was
 *
 *     lit = albedo * irradiance
 *
 * i.e. pure Lambert with NO specular lobe of any kind and no roughness input at
 * all. Ground that cannot glint is a large part of why the world reads as
 * paper, and it is not a tuning problem: there was no term to tune. Wet sand,
 * wet rock inside the pond basin, mineral sparkle in scree and a sun raking
 * along a slope were all unreachable by construction.
 *
 * WHY THE ROUGHNESS NEEDS NO MAP, NO UNIFORM AND NO VARYING, which is what
 * makes this cheap enough to argue for. Every signal it needs has ALREADY been
 * computed by the fragment that calls it:
 *
 *   `matW`     the per-biome material weights (BiomePalette's MAT_W), whose
 *              channels are literally x grass clump, y rock grain, z granular,
 *              w clod. That is a material identity, interpolated across biome
 *              edges by the same vertex path the albedo uses, and it is free.
 *   `coverSel` the slope smoothstep that already decides rock against cover.
 *              ONE gate shared with the albedo, the grain and the relief, so
 *              roughness cannot disagree with them about where a cliff starts.
 *   `snow`     already computed for the albedo lerp.
 *   `wet`      RN-57's wet band, which until now only DARKENED the albedo. A
 *              water film is physically a smooth dielectric layer over the same
 *              pigment; the darkening was half of that and this is the other
 *              half. `ofArtWetness` is split out of `ofArtWet` so both halves
 *              read the identical scalar and cannot drift apart.
 *
 * THE WEIGHTS ARE NOT A PARTITION (BiomePalette says so: they are amplitudes
 * summing near 0.3), so they are normalised here rather than assumed. A biome
 * whose weights are all zero would divide by zero, so the sum is floored and
 * the fallback is the cover roughness rather than an accidental mirror.
 *
 * THE FLOOR IS SECTION 2.1's 0.15 AND IT IS LOAD-BEARING, not a safety rail: a
 * GGX denominator at roughness 0 is a delta function, and one texel of it under
 * a moving sun is a firefly that no amount of temporal smoothing removes.
 *
 * NAMED FAILURE MODES, BEFORE ANY MEASUREMENT (INSTRUMENTS.md):
 *   1. THE WHOLE GROUND GOES SATIN. If the roughness band lands too low the
 *      term stops being a highlight and becomes a uniform sheen, which reads as
 *      wet plastic and is worse than Lambert. The band is therefore authored
 *      HIGH (0.62 to 0.97 dry) and only the wet film and snow reach under it.
 *   2. IT ONLY SHOWS AT NOON, i.e. it is measured at one sun elevation and is
 *      invisible at the one that matters. A specular is a GRAZING phenomenon,
 *      so the calibration frame is a low sun, exactly as RELIEF_DEFAULT was
 *      calibrated at grazing rather than at noon.
 *   3. IT MOVES SECTION 2.1's REFERENCE LUMINANCES. It adds energy, so the four
 *      site luminances must be re-taken and any move over a few counts owed an
 *      explanation. That is what the amplitude uniform and `?terrainspec=0`
 *      exist for: the control is one flag on one build.
 *
 * COMPILED OUT OF THE SCALED SCENE. At 1e5 metres per unit the whole near
 * world is under a pixel, so the term would cost arithmetic to modulate
 * nothing. That is RN-45's confinement by the call graph and it is free.
 */
export const TERRAIN_ART_SPEC = /* glsl */`
  // RN-1257. THE ROUGHNESS IS AUTHORED PER BIOME AND VARIES PER PIXEL.
  //
  // What this replaces, and why replacing it was not a preference: the old
  // body derived roughness as dot(normalise(matW), (0.95, 0.72, 0.86, 0.97)),
  // a weighted average of four constants spanning 0.25 taken over weight
  // vectors that were themselves clustered. Evaluated over the shipped table
  // it produced a band 0.131 wide across EVERY BIOME IN THE GAME and 0.027
  // wide across the five rock and airless ones (the numbers are in
  // BiomePalette's ROUGH_W note). Section 2.1 item 4 requires 0.15 of a mesh
  // family; the terrain is more screen area than every mesh family combined
  // and it was under half of that.
  //
  // AND IT WAS CONSTANT WITHIN A BIOME, which is the half that no widening of
  // the old expression could have fixed. A specular lobe over a constant
  // roughness produces one highlight shape across a whole hillside; what makes
  // scree read as scree is that SOME facets catch the sun and most do not. So
  // the second term here is per-pixel and rides the biome's own grain field,
  // which the caller has already computed for the albedo and passes in free.
  //
  // ROUGH_W.x is the base and ROUGH_W.y is var, which and is the PEAK swing in roughness
  // units: the grain is clamped to [-1, 1] before it is scaled, so a hot texel
  // cannot drive roughness to the floor. That clamp is load-bearing rather than
  // defensive: named failure mode of the specular is a firefly at low
  // roughness under a moving sun, and an unclamped multiply of a field with a
  // sparse hard-edged pebble population (RN-1256) is exactly how one arrives.
  //
  // The grain ARRIVES NORMALISED by the biome's own MAT_W sum, so it is a pure
  // shape in about [-0.25, 0.25] whatever the biome's texture amplitude is.
  // That division is the caller's and it is load-bearing: MAT_W's sums are
  // luminance-compensated and span 0.17 to 0.99, so without it this table
  // would be reading the albedo table's amplitude by the back door.
  // OF_ROUGH_GRAIN (3.2) then puts the ordinary range just inside saturation
  // and leaves the pebbles to clip.
  //
  // The rock, snow and wet mixes below are UNCHANGED to the character. Only
  // the number they start from moved.
  float ofArtRough(float base, float var, float grain,
                   float coverSel, float snow, float wet) {
    float r = base + var * clamp(grain * OF_ROUGH_GRAIN, -1.0, 1.0);
    // Steep ground is bare rock: smoother than the cover that would otherwise
    // sit on it, because what makes a cliff a cliff is that nothing soft stays
    // on it. Same gate as the albedo, so the two cannot disagree.
    r = mix(0.62, r, coverSel);
    // Snow is smoother than dirt and nowhere near a mirror.
    r = mix(r, 0.50, snow);
    // The water film. This is the term the wet band always implied and never
    // had, and it is the largest single move in the function.
    r = mix(r, 0.10, wet);
    return clamp(r, 0.15, 1.0);
  }

  // GGX/Trowbridge-Reitz with a Smith-Schlick height-correlated visibility and
  // a Schlick Fresnel at the dielectric F0 every natural ground surface has.
  // Returns the specular WEIGHT for the sun; the caller multiplies it by the
  // same sun radiance, transmittance and shadow the diffuse term uses, so the
  // highlight extinguishes in the terminator and under a cascade for free
  // rather than by a second set of rules.
  float ofArtSpec(vec3 n, vec3 v, vec3 l, float rough) {
    vec3 hv = normalize(l + v);
    float NoH = max(dot(n, hv), 0.0);
    float NoV = max(dot(n, v), 1e-4);
    float NoL = max(dot(n, l), 0.0);
    float VoH = max(dot(v, hv), 0.0);
    float a = rough * rough;
    float a2 = a * a;
    float d = NoH * NoH * (a2 - 1.0) + 1.0;
    float D = a2 / max(PI * d * d, 1e-8);
    float Vs = 0.5 / max(mix(2.0 * NoL * NoV, NoL + NoV, a), 1e-5);
    float F = 0.04 + 0.96 * pow(1.0 - VoH, 5.0);
    return D * Vs * F * NoL;
  }

  // The SKY half, and it is what stops wet ground from being dead whenever the
  // sun is not in the mirror direction. A smooth surface seen at a grazing
  // VIEW angle returns the sky rather than its own pigment; that is the sheen
  // on a wet road looking away from the sun, and the sky radiance it needs is
  // already computed one line above the call site for the diffuse ambient.
  //
  // THE ROUGHNESS WEIGHT IS SQUARED, and that is a correction rather than a
  // preference. Schlick's Fresnel goes to 1 at grazing, and a walking camera
  // sees ground at about 8 degrees of grazing by 12 m, so nearly ALL the
  // ground in an ordinary frame is at high F. With a linear (1 - rough) weight
  // dry ground at roughness 0.86 would still return 14 per cent of the sky,
  // and section 2.1 measures masked sky at p50 191 against masked ground at 33
  // to 55: 14 per cent of the sky is a quarter of the ground's own value,
  // applied to the whole middle distance. That is named failure mode 1 (the
  // whole ground goes satin) arriving through the ambient rather than through
  // the sun. Squared, dry ground returns 2.0 per cent and wet ground 81 per
  // cent, which is the shape the term is actually claiming: this is a WET
  // effect that dry ground is merely not exempt from.
  vec3 ofArtSkySpec(vec3 skyAmb, float NoV, float rough) {
    float F = 0.04 + 0.96 * pow(1.0 - NoV, 5.0);
    float g = 1.0 - rough;
    return skyAmb * F * g * g;
  }
`;

/**
 * RN-1257. The total gain the shipped two-tap ground-texture blend carried
 * (1.0 on the 16-repeat tap plus 0.55 on the 5-repeat one). It is a CONSTANT
 * here, not a tuning knob, and its whole job is to let `SCALE_W`'s rows sum to
 * 1: with it, a row of (0, 1/1.55, 0.55/1.55) reproduces the pre-RN-1257 blend
 * exactly, which is what makes `?biomescale=0` an exact negative control and
 * not an approximate one. Change this and every biome's texture amplitude
 * moves, which is `MAT_W`'s job and not this constant's.
 */
export const TEX_SCALE_GAIN = 1.55;

/**
 * RN-1257. Maps the NORMALISED grain field onto the [-1, 1] that the per-biome
 * roughness variation saturates over.
 *
 * The caller divides the biome-dotted grain by that biome's own MAT_W sum
 * before it arrives here, so what this scales is a pure shape running about
 * +/-0.25 for every biome in the game rather than a number six times larger on
 * Forest than on Polar. 3.2 therefore puts ordinary ground just inside
 * saturation and leaves RN-1256's sparse pebbles to clip, which is what keeps
 * a hot texel from driving roughness to the floor and firing a firefly under a
 * moving sun.
 */
export const ROUGH_GRAIN = 3.2;

/**
 * RN-1257. The FINE ground-texture tap, in repeats per quad. INTEGER, for
 * RN-78's seam argument (a shared chunk edge must meet at fract == 0), and 47
 * rather than 48 so the fine lattice shares no cell boundary with the
 * 16-repeat one. At a depth-14 chunk of 57.856 m this is a 1.231 m tile and a
 * 1.2 mm texel, which is what finally puts RN-1256's authored hard edges under
 * a ground pixel instead of inside a mip average.
 */
export const TEX_FINE_REPEATS = 47.0;
