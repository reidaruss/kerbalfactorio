// RN-952. WHAT IS THE CONSTANT ON CINDER'S NIGHT GROUND MADE OF?
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --body=cinder \
//        --evalfile=tools/smoke/probes/nightfloor.js
//
// OF_ARGS { lat, lon, sunDot } all carry safe defaults (2, 144, -0.35), so no
// --evalargs is required to run this.
//
// RN-846 measured planetshine honestly (full Forge delivers 1.837e-4 of the
// sun's irradiance to Cinder's ground, about 0.9 of an 8-bit count at the
// shipped exposure) and then REFUSED to wire it, because the night it was
// supposed to light already sat at p50 15.93 counts, unmoved by `?lamp=0`,
// `?iblground=0` and `?bouncelit=0` and moved only 0.71 counts by
// `?horizonocc=0`, and constant at sun elevations -0.35, -0.60 and -0.85
// alike. Wiring a 0.9-count term on top of an unexplained 15.93-count one
// would have baked the unexplained one in permanently. That refusal was right.
//
// THE ANSWER IS TWO LITERALS IN TerrainAmbient.ts, AND THE REASON NOBODY FOUND
// THEM IS THAT ONLY ONE OF THEM HAD A SWITCH.
//
//   TERRAIN_AMBIENT  (0.030, 0.034, 0.045)   no control existed at all
//   STARLIGHT        (0.055, 0.065, 0.095)   `?starlight=0`
//
// `terrainNightAmbient` writes base + starlight * smoothstep, and the
// smoothstep SATURATES at elevation -0.05, so -0.35, -0.60 and -0.85 give the
// identical (0.085, 0.099, 0.140). That is the "constant at three elevations"
// exactly. It reaches the fragment as `uAmbient` in TerrainShader's
//   lit = albedo * (uAmbient + skyAmb * skyViewEff + ground * groundView + sun)
// unweighted by sky view, by horizon occlusion or by shadow, and `ground`
// carries a second copy of it, which is why nothing that weights those four
// moved it. And it never touches the sky shell, which is why the airless night
// sky is 0.00 across 144,000 pixels while the ground is not.
//
// THE PREDICTION THIS TESTS, stated before running so it can fail:
//   `?starlight=0`                 removes 0.055/0.065/0.095 of 0.085/0.099/
//                                  0.140, i.e. 65 to 68 per cent of the linear
//                                  floor. NOT to zero. Roughly 6 to 8 counts.
//   `?terrainfloor=0`              removes the other 32 to 35 per cent.
//   both off                       the ground goes to BLACK, and that is the
//                                  positive control for the whole attribution:
//                                  if anything survives both, there is a third
//                                  source and this explanation is incomplete.
//
// THE MASK IS GEOMETRIC, borrowed from probes/airless.js's argument: the
// camera is pitched down hard enough that the horizon is off the top of the
// band being read, so "ground" is a fixed set of rows rather than a threshold
// on brightness. A chromatic or luminance split would be a classifier that
// depends on the very quantity under test, which is the instrument defect
// INSTRUMENTS.md names.
(async (A) => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };

  // Hide the DOM overlay: the HUD is opaque text over the bottom of the frame
  // and the bands below are frame rows.
  const cv = document.querySelector('canvas');
  const walk = (el) => {
    for (const c of el.children) {
      if (c === cv) continue;
      if (c.contains(cv)) { walk(c); continue; }
      c.style.display = 'none';
    }
  };
  walk(document.body);

  of.teleport(A.lat ?? 2.0, A.lon ?? 144.0, 2.0);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  if (typeof of.propsVisible === 'function') of.propsVisible(false);

  // RN-844: solve the elevation AGAINST THIS SITE. A `?sundot=` solved at the
  // spawn is a different elevation here, and the whole point of this probe is
  // that the elevation decides the smoothstep.
  const solve = of.setSunElev(A.sunDot ?? -0.35);
  await of.settle(2);
  // Straight down at the ground. -60 rather than -35 so the horizon is well
  // clear of the read band even on a crater rim.
  of.look(0, -60);
  await of.settle(40);

  const amb = window.__ofAmbient?.report?.() ?? null;
  return {
    valid: true,
    pass: amb !== null,
    solve,
    // The LINEAR floor the shader is actually being handed this frame, which
    // is the number the pixel statistics have to be reconciled against.
    ambient: amb,
    sunDotAsked: A.sunDot ?? -0.35,
  };
})(OF_ARGS)
