// THE CARPET'S GLSL. RN-2145.
//
// WHY THIS IS A ShaderMaterial AND NOT A FOURTH onBeforeCompile, because the
// DW-10 ledger counts both and neither is free.
//
// Lane A1 measured, with a one-flag control, that `StockFill.stockFloor` lights
// every scattered prop from the TERRAIN_AMBIENT FLOOR ONLY: the sky-ambient
// weight that lights the terrain never reaches a scattered instance, and a
// 2.75x raise of the sky ambient moved prop-lit ground by 2 counts of 14. A
// carpet whose hard requirement is that cover and substrate cannot disagree
// about colour cannot be lit by a path that disagrees with the substrate about
// LIGHT. So the carpet lights itself the way the ground lights itself, from the
// same three shared objects TerrainAmbient.ts exports (uAmbient, uSkyAmbient,
// the 1.45 direct irradiance) and the same atmosphere uniform record, held BY
// REFERENCE rather than copied. That is RN-64's argument applied one layer out,
// and MeshStandardMaterial cannot host it: three's light list is exactly what
// the terrain does not read.
//
// The second reason is the vertex stage. The visible set is a per-instance
// function of live eye distance (GrassTuning's rebuild note), the card grows
// with range, and the whole thing sways. None of that is expressible as a patch
// of a stock shader either.
//
// WIND COHERENCE, and the copy is deliberate and bounded. The harmonics below
// are PropWind's, character for character in their coefficients, and the clock
// and amplitude are PropWind's own shared uniform OBJECTS (see
// PropWind.windUniforms). They are copied rather than factored out because
// PropWind's emitted GLSL must stay byte-identical: it is the props' program,
// and this lane's before/after depends on the props not moving. What actually
// makes the carpet sway WITH the trees is the shared clock and the shared phase
// derivation dot(org, vec3(0.331, 0.089, 0.397)), not the last decimal of a
// harmonic, so the coupling that matters is structural and the copy is not.

import type { DepthPolicy } from '../DepthPolicy.js';
import { ATMOSPHERE_PARS } from '../materials/Atmosphere.glsl.js';
import { CASCADE_GLSL } from '../materials/CascadeShadow.glsl.js';
import { TERRAIN_SUN_IRRADIANCE } from '../materials/TerrainAmbient.js';
import { EMIT_DECL_GLSL, EMIT_INSTALLED } from '../materials/EmissiveLight.js';

/** Inlined for TerrainFragLight's reason: it emits the same characters the
 *  ground emits, from the same exported constant, so the two cannot drift. */
const SUN_IRR = TERRAIN_SUN_IRRADIANCE.toFixed(2);

export function grassVertexShader(depth: DepthPolicy): string {
  return /* glsl */`
    #include <common>
    ${depth.vertexPars}
    #include <shadowmap_pars_vertex>

    attribute float aBend;
    attribute vec3 iPos;
    attribute vec4 iParam;   // yaw, widthM, heightM, wantPerM2
    attribute vec4 iCol;     // sRGB cover colour, w = value jitter

    uniform vec3 uBodyCenter;
    /** viewportH / (2 tan(fovY/2)). What turns metres into pixels. */
    uniform float uPxPerRad;
    uniform vec2 uFadePx;    // hi (full), lo (gone)
    uniform vec2 uGrow;      // x metres per doubling, y cap
    uniform vec2 uDensK;     // x instances per m2 at the eye, y half-distance
    uniform vec2 uIn;        // metres: fade IN lo, hi
    uniform vec2 uOut;       // metres: hand OVER lo, hi
    uniform float uWindTime;
    uniform float uWindAmp;
    uniform float uWindGain;
    /** x common lean, y per-instance lean scatter. Both in card heights. */
    uniform vec2 uLean;

    varying vec3 vWorld;
    varying vec3 vUp;
    varying vec3 vNrm;
    varying vec3 vCol;
    varying vec2 vUv;
    varying float vTip;
    varying float vViewZ;

    void main() {
      vec3 upW = normalize(iPos - uBodyCenter);
      vec3 toCam = iPos - cameraPosition;
      float dist = max(length(toCam), 0.05);

      // GROWTH WITH RANGE, capped. Buys back screen coverage per instance as
      // density falls, the same trade ScatterTuning.DETAIL_FAR_GROW makes.
      float grow = min(uGrow.y, 1.0 + dist / uGrow.x);
      float hM = iParam.z * grow;
      float wM = iParam.y * grow;

      // THE DEMAND, in instances per square metre, at THIS instance's own live
      // range. Everything that retires the carpet multiplies here, so there is
      // one expression and not four places a ring can appear:
      //   the inverse-square falloff (uDensK), which is what keeps SCREEN
      //     density flat rather than ground density flat;
      //   a fade IN, which the far rung uses to let the near tufts own the
      //     first twelve metres unopposed;
      //   a hand OVER, which the near tufts use to leave once the far rung is
      //     established (a HANDOVER, not a Nyquist fade: a tuft at 26 m still
      //     subtends about 14 px and is retired because it has been replaced,
      //     which is worth saying out loud so nobody reads it as an aliasing
      //     limit that it is not);
      //   and the PIXEL fade, which is the Nyquist-respecting one and is the
      //     only fade in this file whose constant is not in metres.
      float px = hM * uPxPerRad / dist;
      float kk = 1.0 + dist / uDensK.y;
      float dens = (uDensK.x / (kk * kk))
        * smoothstep(uIn.x, uIn.y, dist)
        * (1.0 - smoothstep(uOut.x, uOut.y, dist))
        * smoothstep(uFadePx.y, uFadePx.x, px);

      // THE THRESHOLD. iParam.w is the density at which this instance becomes
      // wanted, assigned once at build time from its own index inside its cell.
      // The visible set is therefore a pure function of where the eye is, and a
      // rebuild can only change which instances EXIST, never which are SEEN: an
      // instance a rebuild adds is born above the current demand and grows in
      // when the eye earns it. That is the whole reason there is nothing to
      // hide at a band boundary.
      float show = smoothstep(iParam.w * 0.70, iParam.w, dens);
      hM *= show;
      wM *= show;

      // A stable tangent basis about local up, then the instance's own yaw.
      vec3 ref = abs(upW.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 t0 = normalize(cross(upW, ref));
      vec3 t1 = cross(upW, t0);
      float cs = cos(iParam.x), sn = sin(iParam.x);
      vec3 dx = t0 * cs + t1 * sn;
      vec3 dz = t1 * cs - t0 * sn;

      vec3 world = iPos
        + dx * (position.x * wM) + upW * (position.y * hM) + dz * (position.z * wM);

      // THE LEAN, and it is the single change that stopped the carpet reading
      // as a pin cushion. THIRD CAPTURE: with every card standing dead vertical
      // the field came back as rows of green plastic pins, because a vertical
      // alpha-cut card has a straight silhouette and nothing in a meadow does.
      // Real grass arcs, and a real meadow is COMBED: most blades lean the same
      // way because the same weather has been over all of them, with enough
      // per-blade scatter that it is not a texture.
      //
      // uLean.x is the common bearing's weight and uLean.y the per-instance
      // scatter, and the bearing is derived from the SAME vector PropWind takes
      // its phase from, so the set of the field and the direction gusts travel
      // are one fact and not two. It rides aBend, so it is a bend and not a
      // shear and the root does not move.
      float leanH = fract(iParam.x * 7.31);
      float leanA = leanH * 6.2831853;
      vec2 leanV = uLean.x * vec2(0.83, 0.56)
                 + uLean.y * (vec2(cos(leanA), sin(leanA)) * 2.0 - 1.0) * 0.5;
      float leanK = aBend * hM * (0.55 + 0.9 * leanH);
      world += (t0 * leanV.x + t1 * leanV.y) * leanK;
      // Keep the tip on its own arc rather than letting the blade stretch: a
      // bend conserves length, and without this a hard lean makes every card
      // visibly longer than the one beside it.
      world -= upW * (leanK * dot(leanV, leanV) * 0.5);

      // WIND. PropWind's harmonics and PropWind's clock; see this file's header
      // for why the text is copied and what the coupling actually is. The reach
      // is aBend (a cantilever profile, GrassCard), so displacement is ZERO at
      // the root by construction, which is the property PropWind's own note
      // says retires "the grass detaches from the ground" before it is measured.
      float wPh = dot(iPos, vec3(0.331, 0.089, 0.397));
      float wT = uWindTime;
      float wSx = sin(wT * 1.31 + wPh)
                + 0.52 * sin(wT * 2.17 + wPh * 1.41 + 1.9);
      float wSz = 0.71 * cos(wT * 1.09 + wPh * 0.77)
                + 0.37 * sin(wT * 2.53 + wPh + 4.2);
      float wFl = sin(wT * 3.1 + wPh + dot(position.xz, vec2(1.83, 1.31)));
      vec2 sway = uWindAmp * uWindGain * aBend * hM
                * (vec2(wSx, wSz) + 0.22 * wFl * vec2(0.7, -0.6));
      world += t0 * sway.x + t1 * sway.y;

      vWorld = world;
      vUp = upW;
      vNrm = normalize(dx * normal.x + upW * normal.y + dz * normal.z);
      // sRGB byte -> linear, then the per-instance value jitter. The texture is
      // decoded by the sampler (SRGBColorSpace, hardware sRGB internal format);
      // an attribute is not, so it is decoded here.
      vec3 srgb = iCol.rgb;
      vCol = mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)),
                 step(vec3(0.04045), srgb))
           * (0.84 + 0.32 * iCol.a);
      vUv = vec2(uv.x + fract(iParam.x * 0.61803), uv.y);
      vTip = position.y;

      vec4 worldPosition = vec4(world, 1.0);
      vec4 mv = viewMatrix * worldPosition;
      vViewZ = -mv.z;
      // <shadowmap_vertex> reads this for its normal-bias offset only.
      vec3 transformedNormal = normalize(mat3(viewMatrix) * vNrm);
      #include <shadowmap_vertex>
      gl_Position = projectionMatrix * mv;
      ${depth.vertexBody}
    }
  `;
}

export function grassFragmentShader(depth: DepthPolicy): string {
  return /* glsl */`
    #include <common>
    ${depth.fragmentPars}
    // NOT <tonemapping_pars_fragment> or <colorspace_pars_fragment>: three
    // injects both into every ShaderMaterial prefix and a second copy is a hard
    // compile failure. TerrainFragPars carries the same note for the same trap.
    #include <shadowmap_pars_fragment>
    ${ATMOSPHERE_PARS}

    uniform sampler2D uCard;
    uniform float uAlphaTest;
    /** 1 / albedo_mean_linear. The card is a VALUE field (blades at 0.55 to
     *  1.0) and the colour is the ground's, so without this the carpet would
     *  sit darker than the ground it is standing on by the card's own mean.
     *  Measured over the OPAQUE texels of of_grass_a.png (alpha >= 0.35):
     *  0.4750, against the manifest's whole-texture 0.4757. They agree to
     *  0.15 per cent, so the manifest's number is used and there is no second
     *  authority on what the card's mean is. */
    uniform float uCardMean;
    /** Alpha sharpen about the cutoff. 1 is the raw comparison. */
    uniform float uSharp;
    uniform vec3 uBodyCenter;
    uniform vec3 uAmbient;
    uniform float uSkyAmbient;
    uniform vec3 uCascadeFar;
    /** x wrap width, y forward-scatter gain, z unused (see uRamp). */
    uniform vec3 uTrans;
    /** The root-to-tip value ramp: x at the root, y at the tip. */
    uniform vec2 uRamp;
    /** RN-2220. How far the SHADING normal is blended toward local up, on top of
     *  GrassCard's own geometric BEND_UP (0.74, chosen for a tuft's own lit
     *  side). See the note beside its one use below. ?grassbend=0 is the
     *  exact pre-RN-2220 control (mix identity). */
    uniform float uBendUp;
    // RN-2735. THE SAME GROUND ISOLATOR the terrain reads, ?firelightground=0
    // (TerrainAmpQuery.emitGroundFromQuery, TerrainFragPars.glsl.ts's own
    // declaration beside this note's twin). Declared unconditionally, exactly
    // as the terrain declares it, so the pre/post-splice programs differ only
    // in whether ofEmitIrradiance exists below, not in this uniform's
    // presence. GrassMaterial.ts binds it to tu.uEmitGround, the SAME object
    // TerrainProgram.ts assigns to the terrain material it was built beside,
    // not a second query read: one flag, one value, both materials.
    uniform float uEmitGround;

    varying vec3 vWorld;
    varying vec3 vUp;
    varying vec3 vNrm;
    varying vec3 vCol;
    varying vec2 vUv;
    varying float vTip;
    varying float vViewZ;

    ${CASCADE_GLSL}
    // RN-2735. The emissive-irradiance model, one copy, imported from the same
    // module the terrain and the machine programs take it from
    // (EmissiveLight.ts). Under ?firelight=off the declaration is not spliced
    // at all, on TerrainFragPars's own precedent, so the pre-splice arm is the
    // exact pre-RN-2735 program and the per-fragment cost is measured against
    // the same three-state flag every other emissive consumer uses.
    ${EMIT_INSTALLED ? EMIT_DECL_GLSL : ''}

    void main() {
      ${depth.fragmentBody}
      vec4 card = texture2D(uCard, vUv);
      // MIP-SHARPENED ALPHA (RN-2145, and the first capture is why it exists).
      //
      // of_grass_a.png was authored so that "distant mips converge toward
      // solid rather than dissolving" (texgen.py's own note, RN-177/178): the
      // blade width was widened until the coverage cleared the 0.35 cutoff, so
      // a box-filtered mip fills the gaps between blades instead of eroding the
      // blades. That is right for a card that must not disappear at range and
      // wrong for a carpet, whose whole subject is the gaps.
      //
      // Rescaling the sampled alpha about the cutoff restores the separation
      // the mip flattened, without touching the texture and therefore without
      // moving a single prop that uses the same family. It cannot recover
      // structure a very high mip has destroyed entirely, and it is not asked
      // to: the pixel fade has retired the card by then. ?grasssharp=1
      // restores the raw comparison exactly, which is the control for this term.
      float ca = (card.a - uAlphaTest) * uSharp + uAlphaTest;
      if (ca < uAlphaTest) discard;

      vec3 pM = vWorld - uBodyCenter;
      vec3 camM = cameraPosition - uBodyCenter;
      vec3 toCam = pM - camM;
      float dist = max(length(toCam), 1.0);
      vec3 rd = toCam / dist;
      vec3 up = normalize(vUp);
      // NO gl_FrontFacing FLIP, and that is deliberate rather than an omission.
      // A bent normal points mostly UP on both faces of a card, which is what a
      // tuft's outgoing radiance actually looks like; flipping it on the back
      // face would point it at the ground and make every second blade black.
      vec3 n = normalize(vNrm);

      // The card is a value field; the colour is the GROUND's, already rotated
      // toward cover green at constant luminance (GrassPalette.coverAlbedo).
      // The tip lift is the one place a blade is allowed to disagree with the
      // ground, and it is a thin-tissue effect rather than a colour choice.
      // THE ROOT-TO-TIP GRADIENT, and it is doing two jobs at once.
      //
      // A carpet is a volume, and the light that reaches the bottom of one has
      // been through the top of it. Without a gradient every blade is one flat
      // colour over its whole length, which is what made the second capture
      // read as plastic: no cue that there is anything BETWEEN the blades. This
      // is the cheap standing approximation for that occlusion, and it is the
      // same term that gives a blade its tip highlight, so one expression buys
      // the depth and the translucency read together.
      //
      // It is VALUE-NEUTRAL BY CONSTRUCTION over a uniformly-sampled card
      // (the mean of the ramp is 1 within a per cent), so it moves the spread
      // and not the level: RN-1900's rule for a variation term, applied here
      // because the level is what the luminance-matched cover colour is
      // carefully holding and this must not spend it.
      float tipRamp = mix(uRamp.x, uRamp.y, smoothstep(0.0, 0.55, vTip));
      vec3 albedo = vCol * (card.rgb * uCardMean) * tipRamp;

      // ---- THE SAME LIGHTING EXPRESSION THE GROUND USES ----
      // Not a similar one. uAmbient and uSkyAmbient are the SHARED OBJECTS
      // TerrainAmbient exports, the atmosphere record is the sky's own, and the
      // 1.45 is inlined from the same exported constant TerrainFragLight
      // inlines. A carpet that shaded itself by its own rules would be exactly
      // the disagreement between cover and substrate this layer exists to end.
      // RN-2220. THE SHADING-NORMAL BEND, closing the forestfloor residual
      // (rendering.md 2.12.1): "the same lighting expression the ground uses"
      // (this file's header) implicitly assumes an up-facing normal, because
      // that is what the ground beside the blade has. GrassCard's own BEND_UP
      // bends the GEOMETRIC normal 0.74 of the way there already, for a
      // different reason (a tuft's own lit side, so a field of yawed cards does
      // not read as salt-and-pepper), and still leaves an upright card taking
      // measurably less near-zenith ndl than the flat terrain plane it stands
      // on. ns is a SECOND, independent blend toward up, spent only on the two
      // terms that stand in for the ground's own diffuse response (ndl and
      // skyView below); the wrap/forward translucency term two blocks down
      // stays on the UNBENT n, because that term is the facet's own thin-tissue
      // read (why a real meadow glows into a low sun) and is not this
      // residual's subject -- bending it too would flatten exactly the
      // variation that lets the wind shimmer read.
      vec3 ns = normalize(mix(n, up, uBendUp));

      vec3 sd = normalize(uSunDir);
      float ndl = max(dot(ns, sd), 0.0);
      float shadow = ofCascadeShadow(vViewZ);
      vec3 sunT = uAtmosOn > 0.5 ? ofAtmoSunTransmittance(pM, sd, 3) : vec3(1.0);

      vec3 skyAmb = ofAtmoSkyAmb(pM, up, 2, 2) * uSkyAmbient;

      // The ground BESIDE the blade, which is what a blade's lower half is
      // actually lit by, computed the way TerrainFragLight computes it
      // (RN-841's unshadowed bounce source, same argument: the lit ground
      // around a blade is not extinguished by the blade's own shadow).
      float skyView = 0.5 + 0.5 * dot(ns, up);
      vec3 ground = vCol * (uAmbient + skyAmb
        + sunT * (${SUN_IRR} * max(dot(up, sd), 0.0)));

      // TRANSLUCENCY, as a wrap plus a forward lobe, which is the cheap
      // standing approximation for a thin leaf and the reason a real meadow
      // GLOWS into a low sun instead of going to silhouette.
      //   The WRAP widens the diffuse terminator: a blade edge-on to the sun
      //   still receives, because light entering one face leaves the other.
      //   The FORWARD lobe is the bright rim you get looking INTO the sun
      //   through the field, and it rides sunT and shadow so it reddens through
      //   the terminator and dies under a cascade for free.
      // Both are ADDITIVE and the diffuse is not reduced by what they take;
      // the error is bounded by uTrans and is stated rather than assumed away,
      // on the same terms TerrainFragLight states for its specular.
      float wrapN = max((dot(n, sd) + uTrans.x) / (1.0 + uTrans.x), 0.0);
      float fwd = pow(max(dot(rd, sd), 0.0), 3.0);
      vec3 trans = albedo * uTrans.y * (wrapN * 0.35 + fwd * 0.65)
                 * sunT * ${SUN_IRR} * mix(shadow, 1.0, 0.35);

      vec3 lit = albedo * (uAmbient + skyAmb * skyView + ground * (1.0 - skyView)
        + sunT * (${SUN_IRR} * ndl * shadow)) + trans;

      // RN-2735. THE SAME TERM THE GROUND TAKES (TerrainFragLight.glsl.ts's own
      // lit += albedo * ofEmitIrradiance(pM + uBodyCenter, n) * uEmitGround;),
      // not a parallel one: pM + uBodyCenter is that seam's own round-trip
      // back to engine-space world position (2.47(d) measured the round-trip
      // exact and the float32 cancellation below the instrument's noise floor),
      // and vWorld already IS that position here, so this is the identical
      // computation written without re-deriving it.
      //
      // THE NORMAL IS n, not ns: it carries GrassCard's own baked BEND_UP
      // (0.74 toward local up, GrassCard.ts) as every use of n in this file
      // does, and what is skipped here is only this file's SECOND blend,
      // uBendUp, on the trans term's own precedent four lines up. A firebox
      // is a LOCAL, mostly-horizontal source, and applying that second blend
      // toward up before this dot product would wash every blade to the same
      // faint reading regardless of which way it faces the fire, which is
      // the one thing a standing blade near a furnace should NOT do. ns
      // stays reserved for ndl/skyView, the ground-substitute terms this
      // residual (GrassGlsl's own RN-2220 note) was written for.
      ${EMIT_INSTALLED ? `
      lit += albedo * ofEmitIrradiance(vWorld, n) * uEmitGround;
      ` : ''}

      // Aerial perspective and the boundary-layer aerosol, same functions and
      // same parameters as the ground under it, so a carpet at 80 m and the
      // ground at 80 m go blue together instead of separating.
      vec3 apTrans;
      vec3 apIn = ofAtmoScatter(camM, rd, dist, 4, 2, apTrans);
      lit = lit * apTrans + apIn;
      lit = ofAtmoAerial(lit, camM, rd, dist, sunT);

      gl_FragColor = vec4(lit, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;
}
