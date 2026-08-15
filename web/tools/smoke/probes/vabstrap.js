// vabstrap.js: the bay as a player sees it after GP-115 to GP-122.
// A large stack through the adapter, a strap-on booster on a radial decoupler,
// the tabbed rail and the pre-flight verdict, all in one frame.
//
//   npx vite --config vite.probe.config.ts
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/vabstrap.js
(async () => {
  const of = window.__of;
  if (!of || typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };
  const PID = { Pod: 0x0100, TankS: 0x0101, TankSLong: 0x0102, EngineS: 0x0103,
                SolidBooster: 0x0105, DecouplerRadial: 0x0107, NoseCone: 0x0109,
                Fin: 0x010b, TankL: 0x0117, EngineL: 0x0118, Adapter: 0x011a };
  const cat = of.vab('catalogue');
  const idx = {};
  for (const k of Object.keys(PID)) {
    const r = cat.find((x) => x.id === PID[k]);
    idx[k] = r === undefined ? -1 : r.index;
  }
  of.vab('enter');
  await of.run(3);
  of.vab('press', 'clear');
  await of.run(2);
  const hold = async (p) => { of.vab('drop'); of.vab('take', idx[p]); await of.run(1); };
  const put = async (pred) => {
    const n = of.vab('nodes').filter(pred);
    if (n.length === 0) return false;
    of.vab('hover', n[0].ndc[0], n[0].ndc[1]);
    await of.run(1);
    const r = of.vab('place');
    await of.run(2);
    return r.ok;
  };
  await hold('TankL'); of.vab('place'); await of.run(2);
  await hold('EngineL'); await put((n) => n.kind === 'bottom');
  await hold('Adapter'); await put((n) => n.kind === 'top');
  await hold('TankS'); await put((n) => n.kind === 'top');
  await hold('Pod'); await put((n) => n.kind === 'top' && n.cls === 1.25);
  await hold('NoseCone'); await put((n) => n.kind === 'top' && n.cls === 1.25);
  // Two strap-ons through radial decouplers, which is the whole of complaint 2.
  for (const ang of [0, Math.PI]) {
    await hold('DecouplerRadial');
    const ring = of.vab('nodes')
      .filter((n) => n.kind === 'radial' && n.onScreen
                     && Math.abs(n.offsetM - 2.4) < 1.2
                     && Math.abs(Math.atan2(Math.sin(n.angleRad - ang),
                                            Math.cos(n.angleRad - ang))) < 0.5);
    if (ring.length === 0) continue;
    of.vab('hover', ring[0].ndc[0], ring[0].ndc[1]);
    await of.run(1);
    if (!of.vab('place').ok) continue;
    await of.run(2);
    await hold('SolidBooster');
    await put((n) => n.kind === 'pylon');
  }
  of.vab('drop');
  of.vab('tab', 'Engines');
  of.vab('frame');
  await of.run(6);
  const r = of.vab('report');
  return { valid: true, parts: r.parts.length, lengthM: r.stats.lengthM,
           verdict: r.verdict.summary, ok: r.verdict.ok,
           warnings: r.verdict.warnings.map((w) => w.code),
           stages: r.stages.map((s) => ({ e: s.engines, twr: Number(s.twr.toFixed(3)) })) };
})()
