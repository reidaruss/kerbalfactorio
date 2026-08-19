// vmcost.js (RN-1990). WHAT PASS 4'S SHADOW TERM COSTS, by WG-189's method.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --evalfile=tools/smoke/probes/vmcost.js
//
// BT-225 to BT-239: unlike `vmlight.js`/`vmshade.js`, this probe does not care
// where it boots. `__ofVmLight` is published unconditionally (`ViewModelLight.
// installVmLightDiag`'s own comment: "called unconditionally... every default
// here is the shipped frame") and the price is of the PASS, not of any one
// scene's caster count, so the plain walk default is enough; `OF_ARGS.pairs`/
// `secs` carry their own safe defaults (5 pairs of 4 s) and need no
// `--evalargs`. Verified green at the default site.
//
// WG-189's rule, learned the hard way in that lane: a SERIAL sweep lets thermal
// and background drift land entirely on one arm, and its first two runs
// disagreed on the SIGN. So the two arms are INTERLEAVED inside one page load,
// several times, and the off-arm's own drift across the run is reported beside
// the delta so a reader can see whether the delta is bigger than the machine's
// mood.
//
// THE OFF ARM IS `receive(false)`, NOT `shadow(false)`. Clearing the shadow
// INTENSITY is the right control for a look measurement and the wrong one for a
// price: three's shader still calls `getShadow` and still takes its five PCF
// taps, so `shadow(false)` would price the change at zero by construction.
// Clearing `receiveShadow` takes the `: 1.0` arm of three's own ternary, which
// removes the fetch, AND makes `ViewModelLight.sync` skip its per-frame
// traverse. That is every scrap of work this lane added. It is a uniform, so
// neither arm recompiles and the interleave is legal.
(async () => {
  const of = window.__of;
  const VL = window.__ofVmLight ?? null;
  if (VL === null) return { valid: false, why: 'no __ofVmLight' };
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const pairs = A.pairs ?? 5;
  const secs = A.secs ?? 4;
  const r2 = (x) => (Number.isFinite(x) ? Number(x.toFixed(2)) : null);
  await of.settle(30);

  const phase = async (on) => {
    VL.receive(on);
    await of.run(1.0, 60);          // discard: let the state settle
    of.stats();
    await of.run(secs, Math.round(secs * 60));
    const s = of.stats();
    return { on, p50: r2(s.frameMs.p50), p95: r2(s.frameMs.p95),
      vmMs: r2(s.passMs.viewModel), nearMs: r2(s.passMs.near),
      calls: s.draw.calls, tris: s.draw.triangles, programs: s.draw.programs,
      receivers: VL.state().receivers };
  };
  const rows = [];
  for (let i = 0; i < pairs; ++i) {
    rows.push({ i, ...(await phase(false)) });
    rows.push({ i, ...(await phase(true)) });
  }
  VL.receive(true);
  const med = (a) => {
    const v = [...a].sort((x, y) => x - y);
    return v.length === 0 ? null : r2(v[Math.floor(v.length / 2)]);
  };
  const spread = (a) => (a.length === 0 ? null : r2(Math.max(...a) - Math.min(...a)));
  const pick = (on, k) => rows.filter((r) => r.on === on).map((r) => r[k]);
  return {
    valid: true, pairs, secs,
    off: { p50: med(pick(false, 'p50')), spread: spread(pick(false, 'p50')),
      vmMs: med(pick(false, 'vmMs')), vmSpread: spread(pick(false, 'vmMs')),
      receivers: pick(false, 'receivers')[0] },
    on: { p50: med(pick(true, 'p50')), spread: spread(pick(true, 'p50')),
      vmMs: med(pick(true, 'vmMs')), vmSpread: spread(pick(true, 'vmMs')),
      receivers: pick(true, 'receivers')[0] },
    deltaP50: r2(med(pick(true, 'p50')) - med(pick(false, 'p50'))),
    deltaVmMs: r2(med(pick(true, 'vmMs')) - med(pick(false, 'vmMs'))),
    // The off arm's own drift across the run, which is the yardstick the delta
    // has to beat before it means anything.
    offDrift: r2(pick(false, 'p50')[pick(false, 'p50').length - 1] - pick(false, 'p50')[0]),
    draw: { calls: pick(true, 'calls')[0], tris: pick(true, 'tris')[0],
      programs: pick(true, 'programs')[0],
      callsOff: pick(false, 'calls')[0], programsOff: pick(false, 'programs')[0] },
    rows,
  };
})()
