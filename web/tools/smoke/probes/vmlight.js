// vmlight.js (RN-1990). THE WIRING GATE ON PASS 4'S SHADOW TERM.
//
// `probes/vmsurface.js` proved the view model's MATERIALS bound at the right
// repeat; this proves its LIGHT is wired to the world's. Both exist for the
// same reason: a static gate on three tables cannot see whether the running
// client did the thing.
//
// It is the WIRING half. The BEHAVIOURAL half -- that the model darkens where
// the world's own cascade says the player is in a cast shadow -- is
// `probes/vmshade.js`, and the two are separate on purpose: the behavioural one
// has to teleport over a grid to find shade and costs a minute, while this one
// is four assertions on the boot state and belongs in a fast suite.
//
// WHAT IT ASSERTS, and every line is a failure this lane actually hit:
//
//   1. `wired` -- cascade 0 was found and pass 4's sun carries its map. False
//      means `?shadows=0` or a rename in `ShadowRig`/`Boot`.
//   2. `receivers > 0`. `receiveShadow` is the uniform three's own shader gates
//      the lookup on (`receiveShadow ? getShadow(...) : 1.0`), and the shipped
//      first-person rig had it FALSE on every mesh. A wired light with unwired
//      meshes is a silent identity that reads exactly like the defect.
//   3. THE PROGRAMS CARRY THE SAMPLER. `castShadow` set on the CPU and
//      `USE_SHADOWMAP` compiled into the shader are two different facts joined
//      by an ordering: the light has to be in the scene's `shadowsArray` at the
//      instant the material first compiled. `peekRead` reads the uniform names
//      out of the program three actually built.
//   4. THE EYE'S SHADOW COORDINATE IS INSIDE THE MAP. `getShadow`'s own
//      `frustumTest` is `x,y in [0,1] && z <= 1`, and a coordinate outside it
//      returns 1.0 for every occluder in the world. "Never looked" and "not in
//      shadow" are the same number in a ratio table.
//   5. THE SHADOW MAP HAS CONTENT. A correct lookup into a blank map is also a
//      silent identity, and this one is not hypothetical either: cascade 0 over
//      a forest site is 82 per cent empty, because the terrain does not cast
//      into it. The gate samples a 12 x 12 grid of the map's own colour
//      attachment and refuses a map with nothing in it.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const VL = window.__ofVmLight ?? null;
  if (VL === null) return { valid: false, why: 'no __ofVmLight' };
  await of.settle(24);

  const st = VL.state();
  if (st.wired !== true) {
    return { valid: false, state: st,
      why: 'pass 4 has no shadow term: cascade 0 was not found, so either '
        + '?shadows=0 is set or a light was renamed.' };
  }
  if (!(st.receivers > 0)) {
    return { valid: false, state: st,
      why: `receivers is ${st.receivers}: the light is wired and no mesh reads `
        + 'it, which is a silent identity.' };
  }
  const c = st.eyeCoord;
  if (c === null || c[0] < 0 || c[0] > 1 || c[1] < 0 || c[1] > 1 || c[2] > 1 || c[2] < 0) {
    return { valid: false, state: st,
      why: `the eye's shadow coordinate ${JSON.stringify(c)} is outside the map, `
        + 'so getShadow returns 1.0 whatever is in front of the sun.' };
  }

  VL.peek();
  await of.settle(6);
  const progs = VL.peekRead();
  const missing = (progs.out ?? []).filter(
    (p) => p.prog === null || !p.prog.includes('directionalShadowMap'));
  if (progs.shadowMapEnabled !== true || missing.length > 0) {
    return { valid: false, state: st, progs,
      why: `${missing.length} of ${(progs.out ?? []).length} view-model programs `
        + 'compiled without a directionalShadowMap sampler, so the lookup is not '
        + 'in the shader at all.' };
  }

  // The map's own content, sampled where the arms sample it and over a grid.
  const N = 12;
  let hit = 0;
  for (let j = 0; j < N; ++j) {
    for (let i = 0; i < N; ++i) {
      const cell = VL.mapAt((i + 0.5) / N, (j + 0.5) / N);
      if (cell.rgba !== undefined && cell.rgba[3] > 0) hit++;
    }
  }
  const eyeCell = VL.mapAt(c[0], c[1]);
  if (hit === 0) {
    return { valid: false, state: st, hit,
      why: 'cascade 0 is empty over the whole map, so a correct lookup into it '
        + 'is still an identity. Nothing casts here.' };
  }
  return {
    valid: true,
    why: 'pass 4 carries the world cascade: wired, received, compiled, in '
      + 'frustum, and the map it reads has casters in it.',
    state: st, coverage: hit / (N * N), casters: hit, cells: N * N,
    eyeCell, programs: (progs.out ?? []).length,
  };
})()
