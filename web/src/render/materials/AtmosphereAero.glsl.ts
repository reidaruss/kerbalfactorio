// RN-2175 (fidelity lane A4). THE AEROSOL AND CHAPMAN HALF OF THE SCATTERING
// MODEL, split out of Atmosphere.glsl.ts because that file went 479 code lines
// against ARCHITECTURE.md 2.2's 400-line cap and this lane will not ship the
// board one check short.
//
// THE SPLIT IS BY SUBJECT AND NOT BY LINE COUNT. Atmosphere.glsl keeps the
// molecular model -- Rayleigh, Mie, the ray march, the sphere intersection --
// and this file holds the two things RN-2175 added on top of it: the ANALYTIC
// COLUMN (`ofErfcx`, `ofChapman`, `ofSunOD`), which replaced a three-step
// uniform march over a path hundreds of kilometres long, and the BOUNDARY
// LAYER (`ofAeroColumn`, `ofAeroPhase`, and the three entry points that use
// them).
//
// TWO CHUNKS AND NOT ONE, because GLSL ES 1.00 requires declaration before use
// and the two halves interleave: `ofSunOD` is called BY `ofAtmoScatter`, and
// `ofAtmoSkyAmb` calls it. `ATMOSPHERE_PARS` splices them in at the two points
// that satisfy both, so the emitted source is character-identical to what the
// single file emitted and no program in the DW-10 ledger recompiles differently.
// Every uniform these functions read is declared in Atmosphere.glsl's own
// preamble, which is the chunk before this one.

/** Between `ofAtmoOD` and `ofAtmoSunTransmittance`. */
export const ATMOSPHERE_CHAPMAN = /* glsl */`
  /**
   * RN-2175. exp(x*x) * erfc(x), the scaled complementary error function, for
   * x >= 0 (and usably wrong for x < 0; see ofSunOD). EXACT at x = 0 and
   * asymptotically exact; worst error about six per cent near x = 0.9. GLSL ES
   * 1.00 has no erfc and a Hastings series would cost five multiplies to buy
   * accuracy a sky cannot show.
   */
  float ofErfcx(float x) {
    return 2.0 / (1.7724539 * (x + sqrt(x * x + 1.2732395)));
  }

  /**
   * RN-2175. THE CHAPMAN COLUMN: the density-weighted path length from a point
   * at altitude h0 out to space, for an exponential atmosphere of scale height
   * H over a body of curvature radius R, with the sun at elevation
   * (sinZ, cosZ) against the local horizontal.
   *
   * This replaces a THREE-STEP UNIFORM MIDPOINT RULE over a path that is 65 km
   * long at noon and over 200 km long at dawn, through an atmosphere whose
   * density is concentrated in its first ten. That rule under-integrated by
   * about 38 per cent at a 67 degree sun and by more at a 6 degree one, which
   * is the mechanism behind audit gap 8: the sun's own light was never
   * extinguished enough for the sky to redden, at any hour.
   *
   * The closed form is
   *   exp(-h0/H) * sqrt(pi*r0*H/2) / cosZ * erfcx(tanZ * sqrt(r0/(2H)))
   * and its high-sun limit is exactly H/sinZ, the plane-parallel airmass,
   * INDEPENDENT OF R. That is the property the curvature choice rests on: R can
   * only change the answer at grazing angles, so a scattering curvature larger
   * than the collision radius lengthens the dawn path and cannot move noon.
   */
  float ofChapman(float h0, float sinZ, float cosZ, float R, float H) {
    float hh = max(h0, 0.0);
    float r0 = R + hh;
    float c = max(cosZ, 1e-3);
    float u = (sinZ / c) * sqrt(r0 / (2.0 * H));
    return exp(-hh / H) * sqrt(1.5707963 * r0 * H) * ofErfcx(u) / c;
  }

  /** (Rayleigh, Mie) optical depth along the SUN ray from p out to space. */
  vec2 ofSunOD(vec3 p, vec3 dir, int steps) {
    // ONE return, and it is not a style preference: the two-return form makes
    // the HLSL translator behind ANGLE emit "use of potentially uninitialized
    // variable f_ofSunOD_int", which run.mjs correctly treats as a console
    // warning and fails the probe on.
    vec2 od = vec2(0.0);
    if (uSunArc.y < 0.5) {
      vec2 h = ofAtmoHit(p, dir, uAtmoR);
      od = ofAtmoOD(p, dir, 0.0, max(h.y, 0.0), steps);
    } else {
    float r = length(p);
    vec3 up = p / max(r, 1.0);
    float sinZ = dot(dir, up);
    // Clamped because the approximation above is only usably accurate for
    // u >= about -1: below the local horizontal it understates a path that is
    // truly diverging, i.e. it leaves the deep terminator a little too bright.
    // Bounded, and the occlusion test at the call site removes every sample
    // whose sun ray actually meets the ground.
    float cosZ = sqrt(max(1.0 - sinZ * sinZ, 0.0));
    float h0 = r - uPlanetR;
    od = vec2(ofChapman(h0, sinZ, cosZ, uSunArc.x, uScaleH.x),
              ofChapman(h0, sinZ, cosZ, uSunArc.x, uScaleH.y));
    }
    return od;
  }

`;

/** After `ofAtmoScatter`: everything that reads the layer. */
export const ATMOSPHERE_LAYER = /* glsl */`
  /**
   * BOUNDARY-LAYER AEROSOL HAZE OVER A PATH THAT TERMINATES ON GEOMETRY.
   *
   * THIS IS THE SECOND ATTEMPT AND THE ONLY THING THAT CHANGED IS THE
   * CONFINEMENT. The first one added the aerosol INSIDE ofAtmoScatter and relied
   * on a 400 m scale height to keep it off the sky. That is confinement by
   * HEIGHT and it does not work, because a near-horizon sky ray lies inside the
   * layer for tens of kilometres: the ground hazed correctly (far-band red 70.2
   * to 60.9, blue over red 0.393 to 0.460) and the term then failed its own
   * control, moving sky saturation 0.494 to 0.410 and sky red 81.9 to 97.0. It
   * was reverted whole, and the sky control is what made that call possible.
   *
   * The confinement here is by PATH, and the seam it needs already existed:
   * every escaping ray in this codebase passes tMax = 1.0e9 and every
   * terminating ray passes a real metre distance. So the rule is that this is a
   * SEPARATE ENTRY POINT, called only from the one call site that has a finite
   * distance to geometry (TerrainShader's aerial perspective). The sky quad, and
   * the terrain's own upward sky-ambient ray, cannot reach it at all. "The sky
   * did not move" stops being a tuning result and becomes a property of the call
   * graph. Note that a #define keyed on "is this the terrain material" would
   * have got it WRONG, because the sky-ambient ray IS a terrain fragment issuing
   * an escaping ray; the distinction that matters is the ray, not the material.
   *
   * THE OPTICAL DEPTH IS ANALYTIC, NOT MARCHED, and that is what makes it safe
   * from orbit. For a height profile that is linear along the segment,
   * INTEGRAL exp(-h/H) ds = L * H / (h1 - h0) * (exp(-h0/H) - exp(-h1/H)), which
   * self-limits correctly: a viewer 100 km up looking down collects about H
   * worth of dense air no matter how long the ray is, while a viewer standing on
   * the ground looking horizontally collects the whole length of it. A midpoint
   * or Simpson rule would weight its samples by the FULL path length and would
   * produce an enormous optical depth for a scaled planet seen from space, which
   * is a failure this closed form structurally cannot have.
   */
  /**
   * RN-2175. Path length weighted by exp(-max(h, 0) / H) for a height that ramps
   * LINEARLY from hA to hB over a segment of length L. Heights are relative to
   * the layer's base and MAY BE NEGATIVE: ground below the base sits inside the
   * densest air there is, so the layer's density is CLAMPED at 1 there rather
   * than allowed to grow as exp(+h/H). That clamp is what lets the base be a
   * single altitude for the whole frame instead of sliding to meet each ray.
   *
   * The segment is split at the crossing, so the two halves are each exact and
   * the result is continuous in hA, hB and L. The d < 1e-3 arm is the limit of
   * the closed form as the ramp flattens, taken explicitly because a horizontal
   * ray is the most common case here and is exactly the one that divides by zero.
   */
  float ofAeroColumn(float L, float hA, float hB, float H) {
    float lo = min(hA, hB);
    float hi = max(hA, hB);
    if (hi <= 0.0) return L;
    float under = lo < 0.0 ? L * (-lo) / max(hi - lo, 1e-3) : 0.0;
    float a = max(lo, 0.0);
    float d = (hi - a) / H;
    float mean = d < 1e-3
      ? exp(-a / H) * (1.0 - 0.5 * d)
      : H / (hi - a) * (exp(-a / H) - exp(-hi / H));
    return under + (L - under) * mean;
  }

  /**
   * RN-2400 (lane M1, THE DISTANCE GOES BLUE). THE TINT AS A FUNCTION OF
   * OPTICAL DEPTH, one authority for both entry points exactly the way
   * ofAeroPhase below is.
   *
   * A THRESHOLD RAMP ON od, NOT AN EXPONENT ON tr, and that correction is
   * inside this lane rather than before it. The first attempt blended by
   * 1 - tr^K, reusing the transmittance both entry points already compute;
   * it fails structurally, because tr^K is monotonic in K in the SAME
   * direction at every tr in (0, 1), so no single exponent can hold the
   * blend near zero at a near-field od while pushing it large at a far-field
   * one -- turning K up to protect the near field pushed the far field the
   * same way it pushed everywhere else, measured rather than assumed (see
   * Atmosphere.glsl.ts's own note on aerosolTintOd0). A threshold buys the
   * one thing an exponent cannot: EXACTLY zero below it, whatever the far
   * end needs.
   *
   * uAeroTintOd is (the od the ramp starts at, its span to reach a weight of
   * 1), so the ramp weight is
   * clamp((od - uAeroTintOd.x) / uAeroTintOd.y, 0, 1).
   *
   * floor IS THE ONE PLACE THIS FUNCTION IS NOT SHARED BLIND BETWEEN THE TWO
   * ENTRY POINTS, and the asymmetry has the SAME justification ofAeroPhase's
   * two floors already have two screens down: the ground entry's col is a
   * lit terrain albedo that dilutes any small tint shift, so it can run at
   * floor 0, a PURE THRESHOLD with no floor-driven blend BELOW uAeroTintOd.x.
   * That is NOT "the ground entry is protected at ground ranges": ABOVE the
   * threshold the ground entry blends exactly as far as the sky entry does,
   * and any ground ray whose own optical depth clears it moves, not only the
   * flyover family's. meadow's own horizon band clears od 1.0 too (whole-
   * frame warm 20.22 -> 17.40, hzBand 32.13 -> 25.48) and so does mtnslope
   * (24.08 -> 22.62, GLSL ground entry, by eye the SAME improvement: the
   * cream treeline bar recedes and goes cool). Floor 0 only says the ground
   * entry has no SEPARATE low-od exception the way the sky entry does. The
   * sky entry's col is ITSELF scattered light of the same order as the haze,
   * so even a ray whose own boundary-layer optical depth is nearly zero (an
   * elevated dawn sky ray well off the horizon, RN-2400's own dawnsun.skyUp
   * and vistadawn.skyR) still shows a real hue shift from a small tint
   * blend, which the K = 2.4 first attempt (a smooth exponent, never exactly
   * zero) reproduced and a hard threshold cannot, by construction, at od
   * this small. Measured rather than reasoned: see rendering.md 2.25 for the
   * floor this lane shipped.
   *
   * uAeroTintOn < 0.5 restores the flat RN-2320 blend exactly: uAeroTint
   * whatever od is. ?aerodepth=0.
   */
  vec3 ofAeroTintAt(float od, float floor) {
    if (uAeroTintOn < 0.5) return uAeroTint;
    float ramp = clamp((od - uAeroTintOd.x) / max(uAeroTintOd.y, 1e-3), 0.0, 1.0);
    float k = max(ramp, floor);
    return mix(uAeroTint, uAeroTintFar, k);
  }

  /**
   * The aerosol's phase. One authority for both entry points, with the
   * isotropic floor passed IN rather than read from the uniform, because the
   * two entries want different floors for a reason that is not tuning.
   *
   * THE GROUND ENTRY floors at uAerosol.z = 0.55, and that floor exists so the
   * haze is brighter than the ground it veils in EVERY direction: a single
   * scatter lobe at g = 0.55 spans 45:1 solar to anti-solar, which would make
   * the distance alternately glow and darken as the player turned round, and
   * haze darker than what it covers is a shadow rather than haze.
   *
   * THE SKY ENTRY (RN-2175) floors much lower, because the constraint that
   * argued for 0.55 does not exist there: the haze IS the sky, so it cannot be
   * darker than what it covers. Floored at the ground's 0.55 the layer warms
   * the WHOLE dome at dawn, and the measurement said so -- the anti-solar
   * skyR went from warm -80.70 to +5.12, i.e. the side of the sky that should
   * stay blue-violet at sunrise went neutral. The audit's own honest green is
   * that the integral already resolves the sun's direction at 1.84x, and a
   * near-isotropic haze throws that away.
   */
  float ofAeroPhase(float mu, float iso) {
    float gg = uAeroG * uAeroG;
    float den = max(1.0 + gg - 2.0 * uAeroG * mu, 1e-4);
    float hg = 0.0795775 * (1.0 - gg) / (den * sqrt(den));
    return mix(hg, 0.0795775, iso);
  }

  /**
   * RN-2175. THE BOUNDARY LAYER OVER A RAY THAT ESCAPES, i.e. the SKY, and this
   * is the term that makes a dawn redden.
   *
   * Audit gap 8: "the sky brightens toward the sun by 1.84x and never reddens".
   * The reason is structural rather than a tuning miss. Forge is a 600 km body
   * with a 5.6 km scale height, so an exact Rayleigh integral gives it about
   * half of Earth's grazing airmass, and half the airmass is half the reddening.
   * Correcting the sun-path integral (ofSunOD) is worth a real 72 per cent in
   * the linear red-to-blue ratio at a 5.85 degree sun and under one count of
   * display warm, because ACES compresses a 170-luma sky toward white. On a
   * real planet the colour of a low sky is largely AEROSOL and not molecules,
   * and this model had none in the sky at all.
   *
   * WHY THIS IS NOT THE FIRST ATTEMPT REPEATED. That attempt added the aerosol
   * INSIDE ofAtmoScatter's march, per view sample, and relied on the 400 m scale
   * height to keep it off the sky; a near-horizon sky ray lies inside the layer
   * for tens of kilometres, so it did not stay off the sky and moved zenith
   * saturation 0.494 -> 0.410. This is the SAME ANALYTIC COLUMN the ground half
   * uses, which self-limits at H / sin(elevation): the zenith collects exactly
   * sigma * H, which at 1.4e-4 and 400 m is 0.056 of optical depth, i.e. five
   * per cent, and no march can make it more. The confinement is arithmetic now
   * instead of a hope, and ?skyaero=0 is the control.
   *
   * IT MEETS THE GROUND HALF AT THE HORIZON BY CONSTRUCTION, which is the
   * property this file exists for. A terrain fragment on the tangent horizon and
   * a sky fragment one pixel above it evaluate the same layer integral, one
   * truncated at the surface and one escaping, so the two cannot seam.
   */
  /**
   * RN-2175. THE AMBIENT SKY RADIANCE AT A SURFACE. Every consumer that used to
   * write ofAtmoScatter(p, up, 1.0e9, 2, 2, t) calls this instead, so the
   * fallback and the probe cannot diverge across four shaders.
   *
   * The zenith is the WORST single sample of a dawn sky: it is the one part of
   * the dome that has not reddened, so the fill in every shadow was midnight
   * blue while the horizon burned. uSkyIrr is the cosine-weighted hemisphere,
   * nine directions, sampled on the CPU (SkyProbe.ts) from the same params.
   */
  vec3 ofAtmoSkyAmb(vec3 p, vec3 up, int viewSteps, int lightSteps) {
    vec3 t;
    vec3 marched = ofAtmoScatter(p, up, 1.0e9, viewSteps, lightSteps, t);
    return mix(marched, uSkyIrr.rgb, uSkyIrr.w);
  }

  vec3 ofAtmoSkyAero(vec3 col, vec3 ro, vec3 rd, vec3 sunT) {
    if (uAtmosOn < 0.5 || uAerosol.x <= 0.0 || uSkyAero < 0.5) return col;
    float r = length(ro);
    vec3 up = ro / max(r, 1.0);
    float sinZ = dot(rd, up);
    // A downward sky ray is under the terrain in every frame that has any, and
    // its column diverges. Floored at the horizon rather than branched, so the
    // horizon pixel itself is continuous.
    float cosZ = sqrt(max(1.0 - sinZ * sinZ, 0.0));
    float h0 = max(r - uPlanetR - uAeroRef.x, 0.0);
    float od = uAerosol.x
      * ofChapman(h0, max(sinZ, 0.0), cosZ, uPlanetR, uAerosol.y);
    float tr = exp(-od);
    // RN-2400. Floored at 0.3, NOT 0: see ofAeroTintAt's own note for why the
    // sky entry cannot run at a pure threshold the way the ground entry does.
    vec3 haze = uSunColor * ofAeroTintAt(od, 0.3) * ofAeroPhase(dot(rd, uSunDir), 0.15) * sunT;
    return col * tr + haze * (1.0 - tr);
  }

  vec3 ofAtmoAerial(vec3 col, vec3 ro, vec3 rd, float distM, vec3 sunT) {
    if (uAtmosOn < 0.5 || uAerosol.x <= 0.0) return col;
    float H = uAerosol.y;
    float a0 = max(length(ro) - uPlanetR, 0.0);
    float a1 = max(length(ro + rd * distM) - uPlanetR, 0.0);
    // RN-2175. ONE LAYER FOR THE WHOLE FRAME, referenced to the ground under the
    // OBSERVER, replacing a reference that was recomputed PER RAY as
    // min(a0, a1).
    //
    // The old reference had the right instinct and the wrong quantifier. A
    // boundary layer does sit on the terrain rather than on the datum, and
    // measuring from the datum makes one pair of constants wrong at every
    // elevation but one (the first attempt's note below records that). But
    // taking the lower END OF EACH RAY as the reference means the layer is a
    // DIFFERENT layer for every pixel: whatever a ray happens to land on is
    // declared to be at the bottom of the densest air, so a ridge at 500 m and
    // the valley floor 300 m below it are hazed identically. That is what
    // removes the structure from distant relief, and it is why the haze reads as
    // a flat white sheet rather than as air with depth in it. It also inverts
    // the altitude behaviour the audit named: an eye at 1,200 m looking at a
    // ridge at 500 m had the WHOLE ray declared to be at sea-level density,
    // so climbing thickened the haze instead of thinning it.
    //
    // The base is uAeroRef.x, written once per frame from the observer's own
    // ground altitude, so the layer is a property of the world and not of the
    // ray. Ground below it is clamped to full density by ofAeroColumn rather
    // than super-dense, which is what a valley filling with haze looks like.
    // On the calibrated ground poses this is a NO-OP by construction: a standing
    // eye looking at ground of its own altitude has a0 = a1 = base under either
    // rule, which is why section 2.1's reference luminances do not move.
    //
    // ?aerobase=0 puts min(a0, a1) back, and it is an EXACT restoration:
    // with that base every height is >= 0, the clamp never fires, and
    // ofAeroColumn reduces algebraically to the closed form it replaced.
    float base = uAeroRef.y > 0.5 ? uAeroRef.x : min(a0, a1);
    // THE TRUE RAY GEOMETRY, in two pieces rather than one. A straight ray over
    // a sphere does not change altitude linearly: it bows, by about L^2 / (8 R)
    // at the midpoint, which is 21 m over 10 km and 300 m over 38 km against a
    // 400 m scale height. One linear segment ignores that entirely and
    // understates the column of every long ray; splitting at the true midpoint
    // altitude captures the bow to first order for one extra length().
    float aM = max(length(ro + rd * (0.5 * distM)) - uPlanetR, 0.0);
    float hL = 0.5 * distM;
    float colDepth = ofAeroColumn(hL, a0 - base, aM - base, H)
                   + ofAeroColumn(hL, aM - base, a1 - base, H);
    float od = uAerosol.x * max(colDepth, 0.0);
    float tr = exp(-od);

    float ph = ofAeroPhase(dot(rd, uSunDir), uAerosol.z);
    // sunT is the transmittance along the SUN ray at the shaded fragment, handed
    // in by the caller rather than recomputed. It costs nothing, it is the right
    // order of magnitude for the whole path at these ranges, and it means the
    // haze reddens through the terminator and goes out at night with the sun
    // instead of hanging in the frame as a grey sheet after sunset.
    //
    // RN-2400. THE TINT ITSELF now depends on this SAME od: near ground
    // (below uAeroTintOd.x) keeps uAeroTint's warmth EXACTLY, far ground
    // (past the ramp) converges toward uAeroTintFar's cool, which is what
    // closes the horizon seam against the sky ray above it. Floored at 0,
    // NOT the sky entry's 0.3: the flyover family's own nearer ground is
    // what a pure threshold protects (Atmosphere.glsl.ts's own sweep note),
    // and this is the entry that protection has to run through.
    vec3 haze = uSunColor * ofAeroTintAt(od, 0.0) * ph * sunT;
    return col * tr + haze * (1.0 - tr);
  }
`;
