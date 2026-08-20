// RN-2175 (fidelity lane A4). A CLOUD LAYER, inside the sky material.
//
// Audit gap 9 and the charter's difference 3: "SE has a blue gradient sky with
// clouds". We had no cloud system at all, and an empty sky is most of why a
// vista reads as a render rather than as weather.
//
// WHY IT IS NOT A DOME MESH. A dome is a second draw call, a second program and
// a second thing to sort against the star field, and it buys nothing: the sky
// box already paints every pixel of the sky with the fragment's own view ray in
// hand, so the layer is a ray-shell intersection and a texture fetch in a shader
// that is already running. Draw calls and program count do not move (DW-10).
//
// WHY THE TEXTURE IS SYNTHESISED AT RUNTIME AND NOT BY texgen.py. Three reasons,
// in the order they decided it. (1) `SkyPass.discTexture` is the standing
// precedent in this exact file's neighbourhood: a small procedural DataTexture
// built in TypeScript, no manifest, no PNG. (2) texgen's byte-identical rebuild
// gate (DW-5) exists to protect SHIPPED BYTES, and a texture that is never
// written to disk has no bytes to protect; adding a family would put a new row
// in `surfaces.json` and a new sha256 in a gate, for a field whose determinism
// is better established by rebuilding it in a fresh process and hashing the
// result. (3) texgen's own determinism discipline is what is copied here rather
// than its machinery: NO RNG (every value comes from a 32-bit integer hash), and
// NO TRANSCENDENTALS IN THE FIELD (only + - * / and the hash), because DW-14 is
// this project's own scar from a 1-ULP `tan` divergence between two libms.
//
// WHAT IT DELIBERATELY IS NOT. It casts no shadow on the terrain, it is not
// volumetric, and a player cannot fly through it. Shadowing a cloud layer needs
// a fourth cascade or a projected mask and belongs with the shadow-reach lane;
// flying through one is class (c) in the audit's own table and is not pre-alpha
// work. This is the "textured layer is enough; SE's own clouds are simple" half
// of A4's brief and nothing more.

import * as THREE from 'three';

/** Texels per side. 256 is 256 KB as RGBA and resolves a 40 km field at ~160 m. */
const N = 256;

/**
 * Cloud deck altitude above the layer base, metres, and the width of one tile of
 * the field. Both are set BY EYE against the vista pose, which is what the
 * charter's process asks for, and the pair is what controls the only thing that
 * matters here: how big a cell looks overhead against how fast it converges at
 * the horizon. The first attempt at 2,600 m over a 42 km tile read as cirrus
 * smeared into streaks, because a low deck with a wide tile spends almost all of
 * its screen area at grazing incidence. 4,200 m over 20 km puts a cell at about
 * 4.5 km across seen from beneath, which reads as a broken cumulus deck.
 */
export const CLOUD_ALT_M = 4200;
const CLOUD_TILE_M = 20000;

/**
 * The hash texgen calls `_hash01`, transcribed as arithmetic rather than
 * imported, because the two live on opposite sides of a language boundary and a
 * shared implementation is not available. Pure 32-bit integer work, so it is
 * identical on every platform that runs JavaScript.
 */
function hash01(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Bilinear value noise on a wrapping lattice, so the field tiles exactly. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  // Smoothstep on the cell fraction: polynomial, so no transcendental.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (a: number, b: number): number =>
    hash01(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const a = w(xi, yi);
  const b = w(xi + 1, yi);
  const c = w(xi, yi + 1);
  const d = w(xi + 1, yi + 1);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

/**
 * The coverage field. Four octaves of tiling value noise, then a coverage
 * threshold with a soft edge, then one more octave used to ERODE the edges,
 * which is what stops the result reading as a blurred blob field. Alpha carries
 * coverage; RGB carries a cheap self-shadow term (the field's own value used as
 * a depth proxy), so a cloud is brighter on top than underneath without a
 * second texture or a second fetch.
 */
function cloudField(seed: number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  // TWO PASSES, AND THE FIRST ONE IS NOT AN OPTIMISATION. Thresholding the raw
  // octave sum against a fixed number makes the COVERAGE a property of where
  // that seed's hash values happened to land: measured, the default seed gave a
  // mean alpha of 91.2 and `?seed=99` gave 27.1, i.e. overcast against nearly
  // clear, with nothing in the design choosing either. Stretching each field to
  // its own [0, 1] first makes the threshold mean one thing on every world, and
  // the weather is then authored rather than accidental. (RN-2167's lesson from
  // the terrain generator, inverted: THERE a percentile stretch destroyed an
  // authored intention; HERE the absence of one destroys the only constant that
  // was authored. The rule is the same one -- know which side of the stretch
  // your intention lives on.)
  const field = new Float32Array(N * N);
  let lo0 = Infinity;
  let hi0 = -Infinity;
  for (let y = 0; y < N; ++y) {
    for (let x = 0; x < N; ++x) {
      let v = 0;
      let amp = 0.5;
      let per = 4;
      for (let o = 0; o < 4; ++o) {
        v += amp * valueNoise(x * per / N, y * per / N, per, seed + o * 101);
        amp *= 0.5;
        per *= 2;
      }
      field[y * N + x] = v;
      if (v < lo0) lo0 = v;
      if (v > hi0) hi0 = v;
    }
  }
  const span = (hi0 - lo0) || 1;
  for (let y = 0; y < N; ++y) {
    for (let x = 0; x < N; ++x) {
      const v = (field[y * N + x] - lo0) / span;
      const erode = valueNoise(x * 24 / N, y * 24 / N, 24, seed + 977);
      // Coverage: below `lo` is clear sky, above `hi` is solid deck.
      const lo = 0.42 + 0.10 * erode;
      const hi = lo + 0.22;
      const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      const cov = t * t * (3 - 2 * t);
      const i = (y * N + x) * 4;
      // The depth proxy, so the underside of a thick cell reads darker.
      const lit = Math.round(255 * (0.55 + 0.45 * cov));
      data[i] = lit;
      data[i + 1] = lit;
      data[i + 2] = lit;
      data[i + 3] = Math.round(255 * cov);
    }
  }
  let sum = 0;
  for (let i = 3; i < data.length; i += 4) sum += data[i];
  lastCover = Math.round(sum / (N * N) * 1000) / 1000;
  lastDigest = digestOf(data);
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  // The deck is read at extreme grazing near the horizon, where an isotropic
  // mip is chosen off the LONG axis of the footprint and blurs the field into a
  // band. Anisotropy is the whole difference between a cloud deck and a smear.
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  tex.name = 'ofSkyClouds';
  return tex;
}

export interface CloudUniforms {
  uCloudTex: { value: THREE.Texture | null };
  /** (deck altitude m, field period m, coverage gain, drift metres/second). */
  uCloud: { value: THREE.Vector4 };
  /** Seconds on the sim clock, so pausing the sim stops the weather. */
  uCloudTime: { value: number };
}

/** `?clouds=0` removes the layer; `?cloudamp=` sweeps its opacity. */
const Q = new URLSearchParams(self.location.search);
const CLOUDS_ON = Q.get('clouds') !== '0';
const CLOUD_AMP = ((): number => {
  const f = Q.get('cloudamp') === null ? NaN : Number(Q.get('cloudamp'));
  return Number.isFinite(f) ? f : 1;
})();

export function createCloudUniforms(seed: number): CloudUniforms {
  return {
    uCloudTex: { value: CLOUDS_ON ? cloudField(seed | 0) : null },
    uCloud: {
      value: new THREE.Vector4(
        CLOUD_ALT_M, CLOUD_TILE_M, CLOUDS_ON ? CLOUD_AMP : 0, 6.0),
    },
    uCloudTime: { value: 0 },
  };
}

export const CLOUDS_ENABLED = CLOUDS_ON;

/**
 * A digest of the field's own bytes, published so the determinism claim is a
 * ROUND TRIP through a fresh process rather than a re-read inside one (the
 * standing rule in NUMBERS.md: a same-process comparison measures process
 * determinism, not source equivalence). Two 32-bit FNV-1a accumulators over the
 * whole buffer, printed as hex, plus the field's own coverage mean so a digest
 * change can be told from a coverage change.
 */
let lastDigest = '';
let lastCover = 0;

function digestOf(d: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < d.length; ++i) {
    a = Math.imul(a ^ d[i], 16777619) >>> 0;
    b = Math.imul(b + d[i] + i, 2246822519) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}-${b.toString(16).padStart(8, '0')}`;
}

(window as unknown as { __ofClouds: unknown }).__ofClouds = {
  report: (): { on: boolean; amp: number; size: number; altM: number;
    tileM: number; digest: string; cover: number } => ({
    on: CLOUDS_ON, amp: CLOUD_AMP, size: N, altM: CLOUD_ALT_M,
    tileM: CLOUD_TILE_M, digest: lastDigest, cover: lastCover,
  }),
};

/**
 * The GLSL half. `ofSkyClouds` composites the deck over an escaping sky ray.
 *
 * THE PROJECTION IS A SHELL INTERSECTION AND NOT A DOME UV, and that is what
 * makes the horizon read: cells converge and flatten toward the horizon the way
 * a real deck does, because the ray really does travel further to reach the
 * shell at a shallow angle. A dome mapping would put the same cell size
 * everywhere and the layer would read as wallpaper on a bowl.
 *
 * THE HORIZON IS FADED OUT rather than allowed to run to infinity. Below about
 * two degrees the intersection distance grows without bound, the texture
 * footprint outruns its own mip chain and the deck turns to a grey band exactly
 * where the ground meets the sky. The fade is on the ray's OWN elevation, so it
 * is the same number at every altitude.
 */
export const SKY_CLOUDS_GLSL = /* glsl */`
  uniform sampler2D uCloudTex;
  uniform vec4  uCloud;
  uniform float uCloudTime;

  vec3 ofSkyClouds(vec3 col, vec3 ro, vec3 rd, vec3 up, vec3 sunT, float base) {
    if (uCloud.z <= 0.0) return col;
    float sinE = dot(rd, up);
    if (sinE <= 0.02) return col;
    float eye = length(ro) - uPlanetR - base;
    if (uCloud.x - eye <= 0.0) return col;
    // THE REAL SHELL INTERSECTION, not deck / sin(elevation). The two differ by
    // nothing overhead and by tens of kilometres at five degrees, which is
    // exactly the band the eye reads as perspective; ofAtmoHit is already
    // here and is exact.
    vec2 sh = ofAtmoHit(ro, rd, uPlanetR + base + uCloud.x);
    if (sh.y <= 0.0) return col;
    vec3 hit = ro + rd * sh.y;
    // Two orthogonal axes in the local tangent plane, built from the ray so the
    // mapping has no seam and no pole.
    vec3 e0 = normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0)
                                                  : vec3(1.0, 0.0, 0.0)));
    vec3 e1 = cross(up, e0);
    vec3 d = hit - up * dot(hit, up);
    vec2 uv = vec2(dot(d, e0), dot(d, e1)) / uCloud.y;
    uv.x += uCloudTime * uCloud.w / uCloud.y;
    uv.y += uCloudTime * uCloud.w * 0.37 / uCloud.y;
    vec4 c = texture2D(uCloudTex, uv);
    // The deck thins toward the horizon (see the note) and toward the zenith
    // only in that a vertical ray crosses less of it, which the slant already
    // carries. 0.02 to 0.09 in sine is about 1.1 to 5.2 degrees.
    float edge = smoothstep(0.02, 0.09, sinE);
    float a = clamp(c.a * uCloud.z * edge, 0.0, 1.0);
    if (a <= 0.001) return col;
    // LIT BY THE SUN'S OWN TRANSMITTANCE, which is the whole of "white at noon,
    // warmed at dawn": sunT is the same vector the terrain's direct term and the
    // haze use, so the deck cannot disagree with the ground about the hour. The
    // forward lobe is the silver lining, and it is deliberately mild.
    float fwd = 0.6 + 0.8 * max(dot(rd, uSunDir), 0.0);
    vec3 lit = uSunColor * (0.055 * fwd) * sunT * c.rgb;
    return mix(col, lit, a);
  }
`;
