// Ground-truth ambient occlusion from DEPTH ALONE, plus its denoise, its
// upsample and its application. Four full-screen passes, none of them touching
// a vertex of scene geometry.
//
// WHY DEPTH ALONE. The alternative is a normal buffer, and there are only two
// ways to get one: MRT out of every scene material (which means editing the
// terrain, atmosphere, starfield and plume shaders, and DW-10 caps those at
// five for a reason), or a second geometry pass with an override material
// (which doubles the near scene's draw calls against a 150 budget the surface
// already spends 53 of). Reconstructing the normal from four depth taps costs
// four texture reads and no draw calls.
//
// WHY FOUR PASSES AND NOT THREE. The obvious structure folds the upsample into
// the multiply: read half-resolution AO plus full-resolution depth, multiply
// into the scene colour. It does not work, and it fails LOUDLY, which is the
// only reason it is not still here: the depth texture is an ATTACHMENT of the
// scene framebuffer, so a pass that targets the scene and samples that depth is
// a feedback loop, and WebGL says so 256 times a frame
// (`GL_INVALID_OPERATION: glDrawArrays: Feedback loop formed between
// Framebuffer and active Texture`). So the depth-aware upsample resolves to its
// own full-resolution buffer first, and the pass that touches the scene colour
// samples exactly one texture that the scene framebuffer does not own.
//
// WHY EVERY FETCH IS `textureLod`. A `texture()` inside a loop that can exit
// early makes the compiler emit implicit derivatives it cannot prove uniform,
// and ANGLE warns `X3595: gradient instruction used in a loop with varying
// iteration`. The smoke runner fails on any WebGL warning, correctly. The depth
// texture has no mipmaps and nearest filtering, so an explicit level of 0 is
// not a workaround for the warning, it is what the code always meant.
//
// WHY NO TEMPORAL JITTER. Every other AO implementation rotates its sample
// pattern per frame and leans on TAA to resolve it. This project has probes
// that assert a settled frame is IDENTICAL to the previous one (FrameDiff's
// second difference, and wires.js requiring five consecutive draw-call reads to
// match), and a per-frame rotation would turn a still camera into a shimmering
// one. The rotation here is a pure function of gl_FragCoord with a period of
// exactly 4 pixels, and the denoise kernel is exactly 4x4, so the pattern is
// fully resolved in space and a still frame is still.

import { DEPTH_GLSL } from './DepthGlsl.js';

export const AO_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
/** 1 / full-resolution size. Normal taps must be full-res or the normal is a slope. */
uniform vec2 uFullTexel;
/** 1 / AO-buffer size. */
uniform vec2 uTexel;
uniform mat4 uProj;
uniform float uRadius;
uniform float uMaxScreen;
uniform float uFalloffInv;

${DEPTH_GLSL}

const float PI = 3.141592653589793;
const float HALF_PI = 1.5707963267948966;

float depthAt(vec2 uv) { return textureLod(tDepth, uv, 0.0).x; }

/** Rotation with a period of exactly 4 px in both axes, so a 4x4 denoise resolves it. */
float rotationOffset(vec2 p) {
  vec2 c = floor(mod(p, 4.0));
  float i = c.y * 4.0 + c.x;
  return mod(i * 5.0 + floor(i / 4.0) * 3.0, 16.0) / 16.0;
}

vec3 normalFromDepth(vec2 uv, vec3 P) {
  vec2 t = uFullTexel;
  vec2 ul = uv - vec2(t.x, 0.0);
  vec2 ur = uv + vec2(t.x, 0.0);
  vec2 ud = uv - vec2(0.0, t.y);
  vec2 uu = uv + vec2(0.0, t.y);
  vec3 Pl = viewFromDepth(ul, depthAt(ul));
  vec3 Pr = viewFromDepth(ur, depthAt(ur));
  vec3 Pd = viewFromDepth(ud, depthAt(ud));
  vec3 Pu = viewFromDepth(uu, depthAt(uu));
  // Pick the neighbour on the CONTINUOUS side of any silhouette, which is what
  // stops a normal at a depth edge from pointing along the edge.
  vec3 dx = abs(Pl.z - P.z) < abs(Pr.z - P.z) ? (P - Pl) : (Pr - P);
  vec3 dy = abs(Pd.z - P.z) < abs(Pu.z - P.z) ? (P - Pd) : (Pu - P);
  vec3 n = cross(dx, dy);
  float l = length(n);
  return l < 1e-12 ? vec3(0.0, 0.0, 1.0) : n / l;
}

float horizon(vec2 suv, vec3 P, vec3 V, float current) {
  vec2 c = clamp(suv, vec2(0.0), vec2(1.0));
  float inside = (c.x == suv.x && c.y == suv.y) ? 1.0 : 0.0;
  float d = depthAt(c);
  vec3 delta = viewFromDepth(c, d) - P;
  float len = length(delta);
  float ok = inside * (isBackground(d) ? 0.0 : 1.0) * (len < 1e-5 ? 0.0 : 1.0);
  float cosH = dot(delta / max(len, 1e-5), V);
  // Linear falloff to zero influence at uRadius. An occluder further away than
  // the radius contributes nothing at all rather than a little, which is what
  // keeps flat open ground at exactly 1.0 instead of at "nearly 1.0".
  float att = ok * clamp((uRadius - len) * uFalloffInv, 0.0, 1.0);
  return current + att * max(0.0, cosH - current);
}

void main() {
  float d = depthAt(vUv);
  if (isBackground(d)) { gl_FragColor = vec4(1.0); return; }

  vec3 P = viewFromDepth(vUv, d);
  vec3 N = normalFromDepth(vUv, P);
  vec3 V = normalize(-P);

  // World radius projected to UV. uProj[0][0] survives both the reversed-Z flip
  // and the log-depth path untouched, because both rewrite only row 2.
  float radiusUV = min(0.5 * uProj[0][0] * uRadius / max(0.05, -P.z), uMaxScreen);
  if (radiusUV < uTexel.x) { gl_FragColor = vec4(1.0); return; }

  float noise = rotationOffset(gl_FragCoord.xy);
  float visibility = 0.0;

  for (int s = 0; s < OF_AO_SLICES; ++s) {
    float phi = (float(s) + noise) * (PI / float(OF_AO_SLICES));
    vec2 dir = vec2(cos(phi), sin(phi));
    vec3 sliceDir = vec3(dir, 0.0);
    vec3 axis = normalize(cross(sliceDir, V));
    vec3 projN = N - axis * dot(N, axis);
    float projNLen = max(length(projN), 1e-4);
    vec3 projNn = projN / projNLen;
    vec3 ortho = normalize(sliceDir - dot(sliceDir, V) * V);
    float n = sign(dot(ortho, projNn)) * acos(clamp(dot(projNn, V), -1.0, 1.0));

    float c1 = -1.0;
    float c2 = -1.0;
    for (int t = 0; t < OF_AO_STEPS; ++t) {
      vec2 off = dir * radiusUV * ((float(t) + 0.5 + noise) / float(OF_AO_STEPS));
      c1 = horizon(vUv - off, P, V, c1);
      c2 = horizon(vUv + off, P, V, c2);
    }
    float h1 = n + max(-acos(clamp(c1, -1.0, 1.0)) - n, -HALF_PI);
    float h2 = n + min( acos(clamp(c2, -1.0, 1.0)) - n,  HALF_PI);
    float cosN = cos(n);
    float sinN = sin(n);
    // The GTAO arc integral. Cosine-weighted, so it cannot over-darken a
    // surface the way a hemisphere-occlusion count does.
    visibility += projNLen * 0.25 * (
      (-cos(2.0 * h1 - n) + cosN + 2.0 * h1 * sinN) +
      (-cos(2.0 * h2 - n) + cosN + 2.0 * h2 * sinN));
  }

  gl_FragColor = vec4(clamp(visibility / float(OF_AO_SLICES), 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

/** 4x4 depth-weighted box at AO resolution, matching the rotation period exactly. */
export const AO_BLUR_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uDepthSigma;

${DEPTH_GLSL}

void main() {
  float dC = textureLod(tDepth, vUv, 0.0).x;
  if (isBackground(dC)) { gl_FragColor = vec4(1.0); return; }
  float zC = viewFromDepth(vUv, dC).z;
  float sum = 0.0;
  float wsum = 0.0;
  for (int y = -2; y <= 1; ++y) {
    for (int x = -2; x <= 1; ++x) {
      vec2 uv = vUv + (vec2(float(x), float(y)) + 0.5) * uTexel;
      float d = textureLod(tDepth, uv, 0.0).x;
      float z = viewFromDepth(uv, d).z;
      float w = (isBackground(d) ? 0.0 : 1.0) * exp(-abs(z - zC) * uDepthSigma);
      sum += textureLod(tAo, uv, 0.0).x * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4(wsum > 0.0 ? sum / wsum : 1.0, 0.0, 0.0, 1.0);
}
`;

/**
 * Joint bilateral upsample to full resolution. Four taps weighted by how well
 * each half-resolution sample's depth agrees with this pixel's. A plain
 * bilinear upsample puts a one-texel halo around every silhouette, which is
 * precisely the artefact that reads as cheap AO.
 *
 * This is a pass of its own rather than part of the multiply because the
 * multiply targets the scene framebuffer and depth is one of its attachments.
 */
export const AO_UPSAMPLE_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform vec2 uAoTexel;
uniform float uDepthSigma;

${DEPTH_GLSL}

void main() {
  float dC = textureLod(tDepth, vUv, 0.0).x;
  if (isBackground(dC)) { gl_FragColor = vec4(1.0); return; }
  float zC = viewFromDepth(vUv, dC).z;
  float sum = 0.0;
  float wsum = 0.0;
  for (int y = 0; y < 2; ++y) {
    for (int x = 0; x < 2; ++x) {
      vec2 uv = vUv + (vec2(float(x), float(y)) - 0.5) * uAoTexel;
      float d = textureLod(tDepth, uv, 0.0).x;
      float w = (isBackground(d) ? 0.0 : 1.0)
        * exp(-abs(viewFromDepth(uv, d).z - zC) * uDepthSigma);
      sum += textureLod(tAo, uv, 0.0).x * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4(wsum > 0.0 ? sum / wsum : 1.0, 0.0, 0.0, 1.0);
}
`;

/**
 * The only pass that touches the scene colour. One texture, one tap, and that
 * texture is not an attachment of the framebuffer it writes to.
 *
 * Background is handled with no depth test at all: the AO pass writes exactly
 * 1.0 where there is no geometry, and the strength and power curves both fix
 * 1.0, so a sky pixel is multiplied by 1.0 and is bit-identical.
 */
export const AO_APPLY_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tAo;
uniform float uStrength;
uniform float uPower;

void main() {
  float ao = clamp(textureLod(tAo, vUv, 0.0).x, 0.0, 1.0);
  gl_FragColor = vec4(vec3(mix(1.0, pow(ao, uPower), uStrength)), 1.0);
}
`;
