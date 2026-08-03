// RN-845. THE SHADING OF A BODY YOU ARE NOT STANDING ON.
//
// Nothing in this client has ever drawn a second celestial body, so there is no
// prior art to follow and no material to reuse: `PlanetProxy` is a
// `MeshLambertMaterial` on the body you ARE on, seen from six units away, and
// every terrain material in the project shades a surface under the camera.
// A moon at 1.2e7 m is a different problem, and three of its properties decide
// the whole shader:
//
// 1. IT IS SMALL. At `FAR_SCALE` Cinder is a 2-unit sphere 120 units away and
//    subtends 1.91 degrees, which on a 60-degree vertical FOV at 1080 lines is
//    34 pixels. Everything here is therefore sized for a 34-pixel disc FIRST
//    and for the approach shot second, and the two want different things: the
//    disc wants a correct LIMB and a correct TERMINATOR, and the approach wants
//    relief. Both are here; only the first is cheap.
//
// 2. IT IS AIRLESS, OR IT IS NOT, AND /core ALREADY KNOWS. `uAirless` is
//    `PlanetBody.hasAtmosphere` inverted, i.e. `AtmosphereProfile::present()`
//    read back through `_of_atmo_*`. That is the same authority RN-840 used to
//    stop the moon being rendered with Earth's air, and re-using it here means
//    a third body authored in `atmosphere.h` gets the right disc with no edit.
//
// 3. A LAMBERT SPHERE DOES NOT LOOK LIKE A MOON, AND THAT IS PHYSICS RATHER
//    THAN TASTE. Lambert falls off as cos(incidence) and drives the limb of a
//    full moon to black; the real Moon is very nearly UNIFORM across its disc
//    at full phase, because regolith backscatters. The single-scattering law
//    for a dark, rough, airless regolith is LOMMEL-SEELIGER,
//
//        I  =  (w/4pi) * mu0 / (mu0 + mu)
//
//    with mu0 = cos(incidence) and mu = cos(emission), and it is flat across
//    the disc for exactly that reason. It costs one divide. Using Lambert here
//    would have produced the grey ball ART-DIRECTION.md calls a failure, and no
//    amount of texture would have fixed it, because the defect is in the falloff
//    and not in the albedo.
//
// A body WITH air keeps Lambert, because a Lambert-ish falloff plus a limb of
// forward-scattered air is what a planet with an atmosphere actually looks like
// from outside, and Lommel-Seeliger is a regolith law with no business there.
// The branch is a uniform and not two programs (DW-10: one more shader slot for
// a case that differs by four lines is not a trade worth making).

import * as THREE from 'three';

/** What the disc needs to know about the body it is drawing. */
export interface CelestialLook {
  /** Body radius, metres. The relief gradient needs a real length scale. */
  readonly radiusM: number;
  /** Peak-to-datum relief the height texture encodes, metres. */
  readonly reliefM: number;
  /** 1 when /core says the profile is absent. Chooses the photometric law. */
  readonly airless: boolean;
  /**
   * The SINE of the angle past the terminator at which the top of the
   * atmosphere is still in sunlight: sqrt(1 - (R/(R+T))^2), with T taken from
   * `_of_atmo_space_altitude`. Exactly 0 on an airless body, which is what
   * makes "no twilight, no limb" structural rather than a branch. Forge:
   * T/R = 60/600 km gives 0.4167, i.e. a 24.6 degree wedge, which is what a
   * 10-per-cent-of-radius air column geometrically buys.
   */
  readonly atmoSin: number;
  /** The air's scale height in metres, MEASURED from /core's density profile.
   *  It is what stops the twilight wedge being a 24.6-degree wash: the wedge is
   *  where sunlit air EXISTS, this is where there is enough of it to see. */
  readonly atmoScaleHM: number;
  /** Equirect height map, R channel, [0,1] over [-reliefM, +reliefM]. */
  readonly relief: THREE.Texture;
  /** Equirect albedo. */
  readonly albedo: THREE.Texture;
  readonly texW: number;
  readonly texH: number;
}

export interface CelestialUniforms {
  uSunDir: { value: THREE.Vector3 };
  uEyeObj: { value: THREE.Vector3 };
  uReliefM: { value: number };
  uRadiusM: { value: number };
  uTexel: { value: THREE.Vector2 };
  uAirless: { value: number };
  /** sqrt(1 - (R/(R+T))^2) from /core's own atmosphere ceiling. 0 = airless. */
  uAtmoSin: { value: number };
  uAtmoH: { value: number };
  uShine: { value: THREE.Color };
  uShineDir: { value: THREE.Vector3 };
  uSunIrr: { value: number };
  uReliefGain: { value: number };
  uDetailGain: { value: number };
  uAmbient: { value: THREE.Color };
  uRelief: { value: THREE.Texture };
  uAlbedo: { value: THREE.Texture };
  uDebug: { value: number };
  [k: string]: { value: unknown };
}

const VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN;
varying vec3 vObj;
void main() {
  vUv = uv;
  vN = normalize(normal);
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// `uDebug` 1 paints the UV-versus-position residual described in
// CelestialBodies.uvResidual. It is a SECOND reading of the same claim the boot
// check makes in JS, taken on the GPU where the sampling actually happens, and
// it exists because the failure it guards against (a bake whose parameterisation
// is a mirror or a quarter turn away from the mesh's) produces a picture that is
// wrong and a JS assertion that is silent.
const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uRelief;
uniform sampler2D uAlbedo;
uniform vec3  uSunDir;
uniform vec3  uEyeObj;
uniform float uReliefM;
uniform float uRadiusM;
uniform vec2  uTexel;
uniform float uAirless;
uniform float uAtmoSin;
uniform float uAtmoH;
uniform vec3  uShine;
uniform vec3  uShineDir;
uniform float uSunIrr;
uniform float uReliefGain;
uniform float uDetailGain;
uniform vec3  uAmbient;
uniform float uDebug;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vObj;

const float PI = 3.14159265359;

/* THE one parameterisation, and it is THREE.SphereGeometry's own. The bake
   walks texels through the JS twin of this function; uvResidualOf() measures
   the two against the geometry's shipped position attribute at every vertex. */
vec3 dirForUv(vec2 uvIn) {
  float phi   = (1.0 - uvIn.y) * PI;
  float theta = uvIn.x * 2.0 * PI;
  float sp = sin(phi);
  return vec3(-cos(theta) * sp, cos(phi), sin(theta) * sp);
}

float heightAt(vec2 uvIn) {
  /* Wrap in u, clamp in v: an equirect map is a cylinder, not a torus, and
     letting v wrap would fold the north pole onto the south. */
  vec2 t = vec2(fract(uvIn.x), clamp(uvIn.y, 0.5 * uTexel.y, 1.0 - 0.5 * uTexel.y));
  return (texture2D(uRelief, t).r * 2.0 - 1.0) * uReliefM;
}

/* Value noise on the sphere direction, three octaves. THIS IS NOT A SECOND
   HEIGHT FIELD and must not become one: it perturbs the NORMAL only, at scales
   strictly below the bake's own texel, and it never moves the silhouette. The
   bake is the authority on shape; this is the sub-texel roughness that stops a
   2.45 km texel reading as a polished ball when the body fills the screen. */
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i + vec3(0,0,0)), n100 = hash13(i + vec3(1,0,0));
  float n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1));
  float n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

void main() {
  vec3 N = normalize(vN);

  if (uDebug > 0.5) {
    /* R,G are the uv the shader will sample with, so the SILHOUETTE and the
       map's orientation are both visible; B is the uv-versus-position residual
       amplified 1e5, so the check the boot pass makes in JS is also legible on
       the GPU. A frame that is black in blue and smooth in red/green is the
       pass. Painting the residual alone (the first version) produced a
       correctly black frame that could not distinguish "the residual is zero"
       from "the mesh is not being drawn", which is the exact failure mode a
       debug view exists to rule out. */
    vec3 d = dirForUv(vUv);
    float resid = length(d - normalize(vObj));
    gl_FragColor = vec4(vUv.x, vUv.y, clamp(resid * 1e5, 0.0, 1.0), 1.0);
    return;
  }

  /* Relief gradient in METRES, so the slope is a real slope. du shrinks as
     cos(latitude) and goes to zero at the poles, which would make the finite
     difference explode there; the clamp is one texel of arc at the equator,
     named rather than fudged, and it caps the pole slope at the same value the
     equator's finest representable feature has. */
  float phi = (1.0 - vUv.y) * PI;
  float cosLat = max(sin(phi), uTexel.x * 2.0);
  float duM = 2.0 * PI * uRadiusM * cosLat * uTexel.x;
  float dvM = PI * uRadiusM * uTexel.y;
  float hL = heightAt(vUv - vec2(uTexel.x, 0.0));
  float hR = heightAt(vUv + vec2(uTexel.x, 0.0));
  float hD = heightAt(vUv - vec2(0.0, uTexel.y));
  float hU = heightAt(vUv + vec2(0.0, uTexel.y));
  float dhdu = (hR - hL) / (2.0 * duM);
  float dhdv = (hU - hD) / (2.0 * dvM);

  /* The equirect tangent frame, analytic from the same parameterisation. */
  float theta = vUv.x * 2.0 * PI;
  vec3 T = vec3(sin(theta), 0.0, cos(theta));                       /* d/du */
  vec3 B = vec3(-cos(theta) * cos(phi), -sin(phi), sin(theta) * cos(phi));
  B = -B;                                                           /* d/dv */
  vec3 n = normalize(N - uReliefGain * (T * dhdu + B * dhdv));

  /* Sub-texel roughness. Frequency is set from the texel so it can never
     compete with the baked field: three octaves starting one octave finer. */
  if (uDetailGain > 0.0) {
    float f0 = 1.0 / max(uTexel.x, 1e-5);
    vec3 p = N * f0 * 0.5;
    float e = 0.35;
    vec3 g = vec3(
      vnoise(p + vec3(e,0,0)) - vnoise(p - vec3(e,0,0)),
      vnoise(p + vec3(0,e,0)) - vnoise(p - vec3(0,e,0)),
      vnoise(p + vec3(0,0,e)) - vnoise(p - vec3(0,0,e)));
    vec3 p2 = p * 3.7;
    g += 0.45 * vec3(
      vnoise(p2 + vec3(e,0,0)) - vnoise(p2 - vec3(e,0,0)),
      vnoise(p2 + vec3(0,e,0)) - vnoise(p2 - vec3(0,e,0)),
      vnoise(p2 + vec3(0,0,e)) - vnoise(p2 - vec3(0,0,e)));
    g -= n * dot(g, n);                       /* tangential only */
    n = normalize(n + uDetailGain * g);
  }

  vec3 V = normalize(uEyeObj - vObj);
  vec3 L = normalize(uSunDir);
  vec3 albedo = texture2D(uAlbedo, vUv).rgb;

  float mu0 = dot(n, L);
  float mu  = max(dot(n, V), 0.0);

  /* The soft terminator. 0.00465 rad is the Sun's angular RADIUS at 1 AU, so a
     facet within that of the terminator sees a partly risen disc. It is written
     as a cosine band because that is what the dot product is; at these disc
     sizes it is a pixel or two, and it is here so the terminator does not
     alias into a staircase rather than to make it soft. */
  float lit = smoothstep(-0.00465, 0.00465, mu0);
  float m0 = max(mu0, 0.0);

  /* THE TWILIGHT ARC, AND BOTH OF ITS NUMBERS ARE THE BODY'S OWN AIR.
     Past the geometric terminator the GROUND is in shadow and the air above it
     is not. The lowest sunlit altitude at an angle theta past the terminator is
     h = R * (1/cos(theta) - 1), and the wedge ENDS where that reaches the
     ceiling, at sin(theta) = uAtmoSin.

     THE FIRST VERSION USED ONLY THAT WEDGE AND IT WAS WRONG BY EYE: Forge's
     ceiling is 10 per cent of its radius, so the wedge is 24.6 degrees, and a
     flat ramp across it painted two fifths of the disc a dull blue. The wedge
     says where sunlit air EXISTS; what you can SEE is weighted by how much of
     it there is, which is the density at that altitude. exp(-h/uAtmoH), with
     uAtmoH measured from /core's own profile concentrates the arc into the
     first few degrees, which is what a terminator seen from orbit looks like.

     IT IS DRIVEN BY THE GEOMETRIC NORMAL, not the relief-perturbed one, for the
     same reason the limb is: where the planet's shadow falls on its own air is
     a property of the sphere. Using the bumped normal made this a band of blue
     speckle, because the relief term moves mu0 by more than the arc is wide.

     THE CEILING IS NOT USED AS A CUTOFF, and that is the third version. Cutting
     the arc off at uAtmoSin left a HARD STRAIGHT EDGE across the night side,
     because at Forge's numbers exp(-h/H) is still 6e-3 there, which against a
     black sky is a visible 13/255 after the tone curve. "Too small to see in
     linear" and "too small to see on a black background" are different claims
     and only the second one matters here. The exponential is the whole falloff
     now: by the ceiling it is 2e-5 and the edge cannot be seen because there is
     nothing at it. uAtmoSin still gates the LIMB, where a hard boundary at the
     silhouette is what a limb IS.

     WHY THIS BAND IS WIDER THAN EARTH'S, which is worth writing down before
     someone "fixes" it: the arc's angular half-width is about sqrt(2H/R), so
     Forge (H 5.6 km, R 600 km) gets 7.8 degrees against Earth's 3.0. Forge's
     air is seven times thicker relative to its own radius. The band is wide
     because this world is small, not because the term is wrong. */
  float mu0G = dot(N, L);
  float twi = 0.0;
  if (uAtmoSin > 0.0 && mu0G < 0.0) {
    float c = max(0.05, sqrt(max(1e-6, 1.0 - mu0G * mu0G)));
    float hT = uRadiusM * (1.0 / c - 1.0);
    twi = exp(-hT / uAtmoH);
  }

  /* THE PHOTOMETRY. Lommel-Seeliger for regolith, Lambert for a body with air.
     The 2.0 renormalises L-S so the sub-solar point matches Lambert's 1.0
     (at mu0 = mu = 1 the law returns 0.5), which keeps the two bodies on one
     exposure and stops the choice of law reading as a brightness change. */
  float ls = 2.0 * m0 / max(m0 + mu, 1e-4);
  float shade = mix(m0, ls, uAirless) * lit;

  vec3 col = albedo * uSunIrr * shade;

  /* A body WITH air gets a limb: the line of sight grazes a long air column, it
     forward-scatters, and the edge of the disc goes pale and blue.

     THE GRAZING ANGLE IS TAKEN FROM THE GEOMETRIC NORMAL N AND NOT FROM THE
     PERTURBED n, and that is a correction rather than a shortcut. How much air
     the line of sight crosses is a property of the SHELL, which is a sphere; it
     has nothing to do with the slope of the ground underneath. Driving it from
     the bumped normal made the first Forge frame's sunward limb a band of
     bright speckle, because a 4th-power rim amplifies every wiggle the relief
     term puts into the emission cosine. */
  float muG = max(dot(N, V), 0.0);
  if (uAtmoSin > 0.0) {
    float rim = pow(1.0 - muG, 4.0);
    col += vec3(0.35, 0.52, 0.95) * rim * uSunIrr * 0.55 * clamp(mu0 * 3.0, 0.0, 1.0);
    /* Lit air over unlit ground. THE RAMP RUNS THE OTHER WAY FROM THE FIRST
       VERSION AND THE FIRST VERSION WAS BACKWARDS. Where the arc is BRIGHTEST
       (twi near 1) the sunlit air is at h near 0, so that sunlight has grazed
       the entire dense lower column and arrives deep orange. Where the arc is
       faint the sunlit air is tens of kilometres up, the path is thin, and what
       is left is Rayleigh blue. Sunset colours run red at the bottom, not at
       the top.

       THE PATH FACTOR IS WHAT MAKES THIS AN ARC AND NOT A SLAB. What reaches
       the eye is (density at the shadow line) x (how much of that air the line
       of sight crosses), and the second factor is 1/cos(emission): looking
       straight down through the terminator you cross one scale height, and at
       the limb you cross the whole slant chord. Without it the term is uniform
       along the terminator, which is exactly the flat orange band the previous
       frame showed, and no amount of retuning the brightness would have fixed
       it because the defect was that it had no shape. Clamped at 4, which is
       the emission cosine hitting 0.25; past that the thin-shell approximation
       stops being one and the honest answer is a limb, which is the term
       above. */
    float path = clamp(1.0 / max(muG, 0.05), 1.0, 4.0);
    col += mix(vec3(0.30, 0.46, 0.92), vec3(0.72, 0.30, 0.10), twi)
         * twi * path * uSunIrr * 0.055;
  }

  /* PLANETSHINE. The parent body is a lit disc in this body's sky and it is the
     only thing lighting the night side. uShine is the irradiance, computed on
     the CPU from the parent's radius, distance, albedo and phase (see
     CelestialBodies.planetshine) rather than invented here, so the same number
     can be handed to the ground the player is standing on and the two cannot
     disagree. It arrives already multiplied by the sun's, so it is a few parts
     in ten thousand: correctly almost invisible beside a sunlit crescent, and
     the whole of the light on the dark limb. */
  col += albedo * uShine * (1.0 - lit) * max(dot(n, uShineDir), 0.0);

  col += albedo * uAmbient;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** JS twin of `dirForUv`. The bake and the shader share this parameterisation
 *  and nothing else; `CelestialBodies.uvResidual` measures the pair. */
export function dirForUv(u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = (1 - v) * Math.PI;
  const theta = u * 2 * Math.PI;
  const sp = Math.sin(phi);
  return out.set(-Math.cos(theta) * sp, Math.cos(phi), Math.sin(theta) * sp);
}

export function createCelestialMaterial(look: CelestialLook): {
  material: THREE.ShaderMaterial; uniforms: CelestialUniforms;
} {
  const uniforms: CelestialUniforms = {
    uRelief: { value: look.relief },
    uAlbedo: { value: look.albedo },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uEyeObj: { value: new THREE.Vector3() },
    uReliefM: { value: look.reliefM },
    uRadiusM: { value: look.radiusM },
    uTexel: { value: new THREE.Vector2(1 / look.texW, 1 / look.texH) },
    uAirless: { value: look.airless ? 1 : 0 },
    uAtmoSin: { value: look.atmoSin },
    uAtmoH: { value: Math.max(1, look.atmoScaleHM) },
    uShine: { value: new THREE.Color(0, 0, 0) },
    uShineDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunIrr: { value: 1.0 },
    uReliefGain: { value: 1.0 },
    uDetailGain: { value: 0.0 },
    uAmbient: { value: new THREE.Color(0, 0, 0) },
    uDebug: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERT,
    fragmentShader: FRAG,
    // The far scene is depth-tested against the observer's own planet proxy, so
    // this writes depth like anything else in the pass. It is opaque: a moon is.
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });
  material.name = 'celestialBody';
  return { material, uniforms };
}
