// THE PER-INSTANCE FX CHANNEL'S GLSL (DW-8), lifted out of `MachineBatch` when
// RN-1478 split that batch into one mesh per authored family and pushed the file
// past the 400-line cap.
//
// SPLIT ALONG A SEAM THAT WAS ALREADY THERE, the same one `MachineGeometry` was
// cut on: `MachineBatch` owns the INSTANCE POOL and the materials, and this owns
// the pure string surgery that gives one of those materials the belt band, the
// belt curve and the status chip. Nothing here touches three's batching state,
// allocates a texture or reads a template.
//
// IT IS NOW APPLIED TO SEVERAL MATERIALS RATHER THAN ONE, and that is the reason
// it is a module-level function taking the uniforms rather than a closure over
// them. Every layer of a batch shares ONE uniforms object (one fx DataTexture,
// one clock), because a slot means the same machine in every layer, and three's
// program cache key stringifies `onBeforeCompile`, so the caller must also hand
// every layer the SAME hook function object or the layers compile one program
// each for a shader that is character-for-character identical.

/** The three uniforms the channel needs, owned by the batch. */
export interface FxUniforms {
  uFx: { value: unknown };
  uFxW: { value: number };
  uTime: { value: number };
}

export interface MachineShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, unknown>;
}

/**
 * Splice the per-instance channel into a compiling machine material.
 *
 * The per-instance channel is a DataTexture indexed by three's own batching id
 * (`getIndirectIndex(gl_DrawID)`), exactly the mechanism three uses for
 * per-instance colour, so it cannot fall out of step with the matrix texture.
 */
export function injectMachineFx(shader: MachineShader, uniforms: FxUniforms): void {
  shader.uniforms.uFx = uniforms.uFx;
  shader.uniforms.uFxW = uniforms.uFxW;
  shader.uniforms.uTime = uniforms.uTime;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
uniform sampler2D uFx;
uniform int uFxW;
attribute float aRole;
varying float vRole;
varying vec4 vFx;
varying vec3 vLocalPos;`)
    .replace('#include <batching_vertex>', `#include <batching_vertex>
vRole = aRole;
vLocalPos = position;
#ifdef USE_BATCHING
int fxId = int( getIndirectIndex( gl_DrawID ) );
vFx = texelFetch( uFx, ivec2( fxId % uFxW, fxId / uFxW ), 0 );
#else
vFx = vec4( 0.0 );
#endif`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float uTime;
varying float vRole;
varying vec4 vFx;
varying vec3 vLocalPos;`)
    // AFTER the emissive map, which is where totalEmissiveRadiance is set.
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if ( vRole > 2.5 ) {
  // A BELT CURVE (W7). Same flow row, same band, but the deck is a quarter
  // annulus about a cell CORNER, so the phase is arc length and not local z.
  // The corner is (-0.5,-0.5) for a left turn and (0.5,-0.5) for a right one,
  // which is the only thing the role has to carry; the centre-line radius is
  // 0.5 m, matching the straight tile's inlet and outlet exactly.
  vec2 c = vec2( vRole > 3.5 ? 0.5 : -0.5, -0.5 );
  vec2 d = vec2( vLocalPos.x, vLocalPos.z ) - c;
  float ang = atan( d.y, d.x );
  float s = 0.5 * ( vRole > 3.5 ? ( 3.14159265 - ang ) : ang );
  float f = fract( s * 2.0 - uTime * vFx.x );
  float blob = smoothstep( 0.38, 0.14, abs( f - 0.5 ) ) * step( 0.004, vFx.y );
  float lit = 0.30 + 0.70 * vFx.y;
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.66, 0.47, 0.21 ), blob * 0.95 );
  totalEmissiveRadiance += vec3( 0.44, 0.25, 0.06 ) * blob * lit;
} else if ( vRole > 1.5 ) {
  // THE BELT, straight off FFactoryBeltFlowState. vFx.x is the quantized flow
  // speed turned into bands per second, vFx.y the line's fill fraction: an
  // empty line shows a bare deck and a saturated one is solid with cargo.
  float f = fract( vLocalPos.z * 2.0 - uTime * vFx.x );
  float blob = smoothstep( 0.38, 0.14, abs( f - 0.5 ) ) * step( 0.004, vFx.y );
  float lit = 0.30 + 0.70 * vFx.y;
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.66, 0.47, 0.21 ), blob * 0.95 );
  totalEmissiveRadiance += vec3( 0.44, 0.25, 0.06 ) * blob * lit;
} else if ( vRole > 0.5 ) {
  // THE STATUS CHIP: entityVisualState, and nothing invented on top of it.
  vec3 c = vec3( 0.14, 0.55, 0.24 );
  if ( vFx.z > 2.5 )      c = vec3( 0.32, 0.32, 0.38 );
  else if ( vFx.z > 1.5 ) c = vec3( 0.90, 0.18, 0.08 );
  else if ( vFx.z > 0.5 ) c = vec3( 0.18, 0.74, 1.00 );
  diffuseColor.rgb = c * 0.22;
  totalEmissiveRadiance += c * ( 0.22 + 0.95 * vFx.w );
}`);
}
