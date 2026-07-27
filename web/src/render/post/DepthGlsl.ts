// Turning a depth sample back into a view-space position, for all three modes
// DepthPolicy can select. This is the one piece of post-processing GLSL that is
// NOT depth-mode agnostic, so it is isolated here and it is switched by a
// #define rather than by a uniform, so a mode that is not compiled cannot run.
//
// reversed: three sets clip control to ZERO_TO_ONE and flips the projection, so
//   the depth texture holds NDC z directly in [0,1] with near = 1, far = 0. The
//   inverse of the SAME flipped projection matrix undoes it exactly, which is
//   why nothing here has to know that it was reversed.
// plain:  NDC z is [-1,1], so the sample is remapped before unprojecting.
// log:    the value is NOT an NDC z at all. three's logdepthbuf_fragment writes
//   log2(1 + w) * logDepthBufFC * 0.5 to gl_FragDepth, so w is recoverable in
//   closed form and the view position is a ray scaled to that w. An inverse
//   projection applied to a log-encoded sample would be silently wrong rather
//   than visibly wrong, which is why this branch exists at all instead of the
//   stack refusing to run under `?depth=log`.
//
// `uProjInv` is the inverse of the camera's projection matrix, whatever
// DepthPolicy made it. `uLogFC` is three's logDepthBufFC = 2 / log2(far + 1).

export const DEPTH_GLSL = /* glsl */`
uniform mat4 uProjInv;
uniform float uLogFC;
/** The value the depth attachment is CLEARED to: 0.0 reversed, 1.0 otherwise. */
uniform float uDepthClear;

bool isBackground(float d) {
  return abs(d - uDepthClear) < 1e-6;
}

vec3 viewFromDepth(vec2 uv, float d) {
  #if defined(OF_DEPTH_LOG)
    // w = 2^(2d / logDepthBufFC) - 1, then scale the near-plane ray to it.
    float w = exp2(2.0 * d / uLogFC) - 1.0;
    vec4 r = uProjInv * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
    vec3 dir = r.xyz / r.w;
    return dir * (w / max(1e-6, -dir.z));
  #elif defined(OF_DEPTH_REVERSED)
    vec4 c = uProjInv * vec4(uv * 2.0 - 1.0, d, 1.0);
    return c.xyz / c.w;
  #else
    vec4 c = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return c.xyz / c.w;
  #endif
}
`;

export type DepthDefines = Record<string, string | number>;

export function depthDefines(mode: 'reversed' | 'log' | 'plain'): DepthDefines {
  if (mode === 'log') return { OF_DEPTH_LOG: 1 };
  if (mode === 'reversed') return { OF_DEPTH_REVERSED: 1 };
  return { OF_DEPTH_PLAIN: 1 };
}
