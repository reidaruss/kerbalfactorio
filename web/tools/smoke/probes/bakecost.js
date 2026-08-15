// RN-849. What the bake costs, per body and per resolution. A number that is
// paid at boot has to be published at boot, not estimated afterwards.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/bakecost.js
//
(async () => {
  const B = window.__ofBodies;
  const r = B.report();
  const s = window.__of.stats();
  return { texW: r.texW, texH: r.texH, bakeMs: r.bakeMs,
    oracleSamples: r.oracleSamples, drawn: r.drawn,
    msPerSample: r.bakeMs * 1000 / Math.max(1, r.oracleSamples),
    bootMs: s.boot ? s.boot.bootMs : null,
    texelM: r.bodies.map((b) => ({ name: b.name, texelM: b.texelM })),
    drawCalls: s.draw.calls, triangles: s.draw.triangles,
    programs: s.draw.programs, vramEstimateMB: s.vramEstimateMB };
})()
