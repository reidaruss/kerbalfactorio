// THE WATER SURFACE GLSL. This is the ONE DW-10 scene-shader slot Admin
// approved for water, and it buys all four of the brief's items rather than one.
//
// WHY ONE SLOT AND NOT FOUR. Surface motion, sun glint, refraction and the
// shoreline are not four effects, they are four QUESTIONS ABOUT ONE FRAGMENT:
// which way is this bit of surface facing, how much sun does it mirror, what is
// underneath it, and how close is it to the edge. Every one of them is answered
// from the same perturbed normal and the same water depth, so putting them
// anywhere but here would mean recomputing the normal in a second program.
//
// REFRACTION SPECIFICALLY DOES NOT NEED A SECOND SLOT, and that was the one that
// looked like it might. What refraction needs is not a program, it is a TEXTURE:
// a copy of the scene as it stood before the water drew over it. WaterSurface.ts
// takes that copy with one framebuffer grab at `onBeforeRender`, and this shader
// samples it. A pass costs a program; a grab costs a copy.
//
// FOUR THINGS ARE LOAD-BEARING AND ARE NOT PREFERENCES:
//
//  1. THE RIPPLE IS ANALYTIC IN A LOCAL PLANE COORDINATE. Not one `dFdx` appears
//     in this file. RN-45 measured what a screen-derivative field does on a
//     600 km body: planet-centred metres are float32 with a 0.03125 m quantum
//     against a 4.3 mm pixel footprint, so the derivative is exactly zero across
//     runs of pixels and steps on surfaces of constant range, which draws
//     concentric arcs centred on the eye. `aPlane` is metres from the POND
//     CENTRE, so it spans +/-11 m and float32 resolves it to about a micron.
//     The wave sum is a handful of sine trains whose gradient is written down in
//     closed form beside the height, so the normal is exact at any pixel size.
//  2. THE FINE OCTAVES FADE ON THE PIXEL FOOTPRINT AND THEIR LOST SLOPE BECOMES
//     ROUGHNESS. Dropping a sub-pixel ripple without paying for it converts a
//     smooth sheet of glitter into a field of flickering white dots, and bloom
//     then amplifies exactly those dots. The variance the fade throws away is
//     added back to the specular width instead, which is what makes distant
//     water read as a broad sheen rather than as sparkle noise.
//  3. THE REFLECTED SKY IS `ofAtmoScatter` ALONG THE REFLECTED RAY, at 1.0e9.
//     DW-22 says there is one atmosphere model; a pond that mirrored a
//     hand-picked blue would disagree with the sky it is standing under at every
//     sun angle. 1.0e9 is also RN-30's confinement: an ESCAPING ray, so it
//     cannot pick up the boundary-layer aerosol that only terminating rays get.
//  4. THE REFRACTION OFFSET IS SCALED BY THE WATER DEPTH AT THIS VERTEX, which
//     is zero at the shoreline. That makes shoreline bleed - grass smearing into
//     the pond because the offset sampled a pixel that is above water -
//     structurally impossible at the boundary rather than fixed by a depth test.

import type { DepthPolicy } from '../DepthPolicy.js';
import { ATMOSPHERE_PARS } from './Atmosphere.glsl.js';
import { CASCADE_GLSL } from './TerrainShader.js';

export function waterVertexShader(depth: DepthPolicy): string {
  return /* glsl */`
    #include <common>
    ${depth.vertexPars}
    #include <shadowmap_pars_vertex>
    /** Metres east/north of the pond centre, in the pond's tangent basis. */
    attribute vec2 aPlane;
    /** x = metres of water under this vertex, y = radius / shorelineM. */
    attribute vec2 aWater;
    varying vec2 vPlane;
    varying vec2 vWater;
    varying vec3 vWorld;
    varying vec3 vUpW;
    varying float vViewZ;
    varying vec4 vClip;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorld = worldPosition.xyz;
      // The mesh transform is a pure translation from FloatingOrigin, so the
      // shell normal in body frame IS the up direction in engine frame. The
      // normalize survives the day someone gives the mesh a scale.
      vUpW = normalize(mat3(modelMatrix) * normal);
      vPlane = aPlane;
      vWater = aWater;
      vec4 mv = viewMatrix * worldPosition;
      vViewZ = -mv.z;
      vec3 transformedNormal = normalize(normalMatrix * normal);
      #include <shadowmap_vertex>
      gl_Position = projectionMatrix * mv;
      vClip = gl_Position;
      ${depth.vertexBody}
    }
  `;
}

/**
 * THE WAVE TRAINS. Five sine trains, height and plane gradient together, so the
 * normal never needs a screen derivative. Wavelengths are deliberately not
 * commensurate: any two that share a factor produce a stationary beat pattern
 * that reads as a woven mat rather than as water.
 *
 * The last two carry a WEIGHT, which is the footprint fade of note 2 above. The
 * function also returns the slope variance the fade discarded, in `.w`, so the
 * caller can spend it on roughness.
 */
const WAVES = /* glsl */`
  // height in .x, d(height)/d(plane) in .yz, discarded slope variance in .w.
  vec4 ofWaterWaves(vec2 p, float t, float fine, float chop) {
    vec4 acc = vec4(0.0);
    vec2 k; float ph, w2;
    #define OF_WAVE(LAM, AMP, SPD, DX, DY, W) \
      k = vec2(DX, DY) * (6.2831853 / (LAM)); \
      ph = dot(k, p) + (t) * (SPD) * (6.2831853 / (LAM)); \
      acc.x += (W) * (AMP) * sin(ph); \
      acc.yz += (W) * (AMP) * k * cos(ph); \
      w2 = (AMP) * (6.2831853 / (LAM)); \
      acc.w += (1.0 - (W)) * (1.0 - (W)) * w2 * w2 * 0.5;

    // The two long trains. These carry the swell and are never faded, because
    // at three metres they are still many pixels across at any range the pond
    // is visible from.
    OF_WAVE(3.10, 0.0300, 0.55,  0.970,  0.243, 1.0)
    OF_WAVE(1.73, 0.0180, 0.72, -0.416,  0.909, 1.0)

    // DOMAIN WARP. The short trains ride on the long ones rather than crossing
    // them at a fixed offset, which is what stops the sum reading as plaid. It
    // costs two multiplies and it is the single largest visual difference
    // between this and a sum of sines.
    vec2 q = p + acc.x * chop * vec2(1.0, 0.7);

    p = q;
    OF_WAVE(0.91, 0.0095, 0.95,  0.629, -0.777, 1.0)
    OF_WAVE(0.47, 0.0042, 1.20, -0.882, -0.471, fine)
    OF_WAVE(0.263, 0.0019, 1.55, 0.195,  0.981, fine)
    #undef OF_WAVE
    return acc;
  }
`;

/**
 * The shoreline breakup field. Value noise on the plane coordinate, so it is as
 * well conditioned as the waves are, and scrolled slowly so a foam line is never
 * a frozen decal.
 */
const FOAM_NOISE = /* glsl */`
  float ofWaterHash(vec2 c) {
    return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
  }
  float ofWaterNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(ofWaterHash(i), ofWaterHash(i + vec2(1.0, 0.0)), f.x),
               mix(ofWaterHash(i + vec2(0.0, 1.0)), ofWaterHash(i + vec2(1.0, 1.0)), f.x),
               f.y);
  }
`;

export function waterFragmentShader(depth: DepthPolicy): string {
  return /* glsl */`
    #include <common>
    ${depth.fragmentPars}
    // Same rule as TerrainShader: do NOT include the tonemapping or colorspace
    // PARS chunks. WebGLProgram injects both into every ShaderMaterial prefix
    // and a second copy is a hard compile failure. Only the BODY chunks belong.
    #include <shadowmap_pars_fragment>
    ${ATMOSPHERE_PARS}
    uniform vec3 uBodyCenter;
    uniform vec3 uCascadeFar;
    uniform vec3 uAmbient;
    uniform float uSkyAmbient;
    uniform float uTime;
    /** x ripple, y glint, z refraction, w foam. Master amplitudes, 0 disables. */
    uniform vec4 uWaterAmp;
    /** The pond's tangent basis, engine frame. Constant for the body's life. */
    uniform vec3 uPlaneE;
    uniform vec3 uPlaneN;
    /** Metres of ground covered per pixel, per metre of range. */
    uniform float uPixelScale;
    /** Screen-space span of one metre at one metre, x already over the aspect. */
    uniform vec2 uInvViewSpan;
    /** The scene as it stood before the water drew. See WaterSurface.grab(). */
    uniform sampler2D tGrab;
    uniform vec3 uSigma;
    uniform vec3 uTintDeep;
    uniform vec3 uShallow;
    uniform vec3 uDeep;
    /** x base roughness, y chop, z glint clamp, w refraction metres per unit slope. */
    uniform vec4 uWaterTune;
    /** x alphaShore, y alphaDeep, z alphaFullM, w shoreSoftM. */
    uniform vec4 uWaterAlpha;
    /** x foam depth m, y foam wave gain, z foam noise scale, w refraction full depth m. */
    uniform vec4 uWaterShore;
    varying vec2 vPlane;
    varying vec2 vWater;
    varying vec3 vWorld;
    varying vec3 vUpW;
    varying float vViewZ;
    varying vec4 vClip;
    // AFTER the uniform block, not before it, and that is not a style choice:
    // ofCascadeShadow reads uCascadeFar, and GLSL requires declaration before
    // use, so putting these three above the uniforms is eight compile errors.
    // TerrainShader has always had this order; the first cut of this file did
    // not, and a static check that compared the SET of uniforms used against the
    // set declared reported "none missing" because a set has no order. The
    // driver caught it in one line. Nothing but a compiler checks a compiler.
    ${CASCADE_GLSL}
    ${WAVES}
    ${FOAM_NOISE}

    void main() {
      ${depth.fragmentBody}

      vec3 pM = vWorld - uBodyCenter;
      vec3 camM = cameraPosition - uBodyCenter;
      vec3 toCam = camM - pM;
      float dist = max(length(toCam), 0.05);
      vec3 v = toCam / dist;
      vec3 up = normalize(vUpW);
      float depthM = max(vWater.x, 0.0);

      // THE FOOTPRINT FADE. One pixel covers dist * uPixelScale metres along
      // the view ray, and a surface seen at a grazing angle covers more than
      // that across the ground, which is exactly the case that aliases worst.
      // Dividing by the cosine is what makes the far shore of the pond settle
      // rather than crawl. Clamped, or a fragment exactly edge-on asks for an
      // infinite footprint and takes the whole term out with it.
      float grazing = max(dot(v, up), 0.12);
      float fpM = dist * uPixelScale / grazing;
      // The shortest unfaded train is 0.47 m; fade it out between a quarter and
      // a half of that, which is the Nyquist limit and a little either side.
      float fine = 1.0 - smoothstep(0.10, 0.24, fpM);

      vec4 wv = ofWaterWaves(vPlane, uTime, fine, uWaterTune.y);
      float amp = uWaterAmp.x;
      // The plane gradient becomes a world-space tilt of the shell normal. Both
      // basis vectors are constant over the pond, so this is a rotation and not
      // a re-derivation of anything.
      vec3 n = normalize(up - amp * (wv.y * uPlaneE + wv.z * uPlaneN));

      // The slope variance the fade threw away, plus the base roughness. This is
      // the Toksvig trade of note 2: a normal that stopped wobbling has to leave
      // its wobble somewhere, and the specular lobe is where it belongs.
      float rough = sqrt(uWaterTune.x * uWaterTune.x + amp * amp * wv.w * 4.0);
      rough = clamp(rough, 0.008, 0.6);

      vec3 sd = normalize(uSunDir);
      float shadow = ofCascadeShadow(vViewZ);
      vec3 sunT = uAtmosOn > 0.5 ? ofAtmoSunTransmittance(pM, sd, 3) : vec3(1.0);

      // FRESNEL, Schlick at F0 = 0.02, which is water at normal incidence. The
      // whole reason a pond reads as a pond and not as blue paint is that this
      // number is near zero looking down and near one looking along.
      float cosV = clamp(dot(n, v), 0.0, 1.0);
      float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);

      // THE REFLECTED SKY, from the shared model. Bent back above the local
      // horizon before the call: a ripple crest can turn the reflected ray into
      // the ground, and ofAtmoScatter answers a downward ray with the inside of
      // the planet, which reads as a black hole in the water.
      vec3 r = reflect(-v, n);
      r = normalize(r + up * max(0.0, 0.03 - dot(r, up)));
      vec3 skyTrans;
      vec3 sky = ofAtmoScatter(pM, r, 1.0e9, OF_W_VIEW, OF_W_LIGHT, skyTrans);
      sky += uAmbient;

      // THE GLINT. GGX normal distribution against the sun, clamped because an
      // unbounded specular peak on a rippled surface is a firefly generator and
      // the bloom pyramid downstream would smear every one of them.
      vec3 h = normalize(sd + v);
      float nh = max(dot(n, h), 0.0);
      float a2 = rough * rough * rough * rough;
      float dd = nh * nh * (a2 - 1.0) + 1.0;
      float ggx = a2 / max(3.14159265 * dd * dd, 1.0e-6);
      float ndl = max(dot(n, sd), 0.0);
      vec3 glint = uWaterAmp.y * min(ggx, uWaterTune.z)
        * fres * ndl * shadow * sunT * 2.6;

      // WHAT IS UNDER THE SURFACE, two ways, selected by one amplitude so both
      // live in ONE program and ?waterrefract=0 is a true isolation rather
      // than a second shader.
      float k = clamp(depthM / max(uWaterAlpha.z, 0.01), 0.0, 1.0);
      vec3 volume = mix(uShallow, uDeep, k);

      // The screen offset. Physically scaled: a world displacement of d metres
      // at range dist subtends d / dist * uInvViewSpan of the screen, so the
      // wobble neither grows nor shrinks with the viewport. The displacement is
      // the surface tilt times the depth, which is Snell's law linearised, and
      // it is ZERO AT THE SHORELINE because depthM is.
      float rDepth = min(depthM, uWaterShore.w);
      vec2 tilt = amp * wv.yz * uWaterTune.w * rDepth;
      vec3 tiltW = tilt.x * uPlaneE + tilt.y * uPlaneN;
      vec2 off = vec2(dot(tiltW, vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0])),
                      dot(tiltW, vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1])));
      off = clamp(off * uInvViewSpan / dist, vec2(-0.04), vec2(0.04));
      vec2 suv = clamp(vClip.xy / vClip.w * 0.5 + 0.5 + off, vec2(0.002), vec2(0.998));
      vec3 bed = textureLod(tGrab, suv, 0.0).rgb;
      // The column the bed's light climbed to reach the surface. Grazing views
      // get a long path and therefore see nothing, which is what a pond does.
      float pathM = depthM / grazing;
      vec3 tr = exp(-uSigma * pathM);
      vec3 through = bed * tr + uTintDeep * (1.0 - tr);
      vec3 below = mix(volume, through, uWaterAmp.z);

      // THE SHORELINE. The wave height is added to the depth before the band is
      // taken, so the foam line advances and retreats with the swell instead of
      // sitting on the geometry as a painted ring. The noise breaks it up; the
      // slow scroll stops it being a decal.
      float swell = depthM - wv.x * uWaterShore.y * amp;
      float band = 1.0 - smoothstep(0.0, max(uWaterShore.x, 0.01), swell);
      float breakup = ofWaterNoise(vPlane * uWaterShore.z + vec2(uTime * 0.06, uTime * -0.04));
      // BREAKUP IS NOT DECORATION HERE, IT IS MOST OF THE TERM. The band is a
      // band of DEPTH, and a depth band on a gentle beach is very wide in
      // metres: at the 6 degree slope this pond has, the shipped 0.10 m reaches
      // 0.95 m up the shore, and the 0.34 m first tried reached 3.2 m and read
      // as a solid white ring that hid the beach at any grazing angle. So the
      // noise gate is deliberately high: only the top slice of it foams, which
      // is what makes a broken line of surf instead of a painted rim.
      float foam = uWaterAmp.w * band * band
        * smoothstep(0.52, 0.88, breakup) * 0.85;
      vec3 foamLit = vec3(0.90, 0.94, 0.96)
        * (uAmbient + uSkyAmbient * 0.5 + sunT * (1.1 * shadow));

      vec3 col = mix(below, sky, fres) + glint;
      col = mix(col, foamLit, clamp(foam, 0.0, 1.0));

      // ALPHA. With refraction on, the bed already arrived through tGrab, so the
      // sheet is opaque and only the last few centimetres at the edge soften.
      // With it off, the WG-42 depth ramp is what carries the bed through, and
      // that is the pre-RN-53 image exactly.
      float aPlain = uWaterAlpha.x + (uWaterAlpha.y - uWaterAlpha.x) * k;
      float aRefr = smoothstep(0.0, max(uWaterAlpha.w, 0.001), depthM);
      float alpha = mix(aPlain, aRefr, uWaterAmp.z);
      alpha = clamp(max(alpha, foam), 0.0, 1.0);

      gl_FragColor = vec4(col, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;
}
