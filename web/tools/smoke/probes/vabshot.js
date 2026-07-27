// vabshot.js: the picture probes/vab.js is about.
//
// Assembles "Ascender I" in the bay, frames it, and returns the readouts the
// screenshot is meant to show, so the numbers in the caption are the numbers on
// the screen rather than numbers somebody typed next to it.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --sandbox=1 --settle=6 \
//     --evalfile=tools/smoke/probes/vabshot.js --out=docs/screenshots/W10_vab.png
(async () => {
  const of = window.__of;
  if (!of || typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };
  const sleep = (n) => of.run(n);

  of.vab('enter');
  await sleep(0.4);
  of.vab('press', 'clear');
  await sleep(0.2);

  const cat = of.vab('catalogue');
  const idx = (pid) => {
    const row = cat.find((r) => r.id === pid);
    return row === undefined ? -1 : row.index;
  };
  const seq = [0x0100, 0x010a, 0x0101, 0x0104, 0x0106, 0x0102, 0x0103];
  for (const pid of seq) {
    of.vab('frame');
    of.vab('take', idx(pid));
    await sleep(0.1);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.15); continue; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const n = of.vab('nodes').filter((x) => x.parent === low.handle && x.onScreen
      && (x.kind === 'bottom' || x.kind === 'interstage'));
    if (n.length === 0) continue;
    of.vab('hover', n[0].ndc[0], n[0].ndc[1]);
    of.vab('place');
    await sleep(0.15);
  }

  // Four fins, one press.
  const sym4 = document.querySelector('[data-vab="sym"][data-n="4"]');
  if (sym4) sym4.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(0.1);
  of.vab('frame');
  of.vab('take', idx(0x010b));
  await sleep(0.1);
  const tank = of.vab('report').parts.find((p) => p.partId === 0x0102);
  const radial = of.vab('nodes').filter((x) => x.kind === 'radial' && x.onScreen
    && (tank === undefined || x.parent === tank.handle));
  if (radial.length > 0) {
    of.vab('hover', radial[0].ndc[0], radial[0].ndc[1]);
    of.vab('place');
    await sleep(0.25);
  }
  of.vab('drop');

  // Frame it three-quarter on, slightly above the middle, so the whole stack is
  // in shot with the readouts on the right rail legible beside it.
  of.vab('frame');
  of.vab('orbit', 0.85, 0.12);
  of.vab('zoom', -1);
  await sleep(0.6);

  const r = of.vab('report');
  return {
    valid: r.parts.length === 11,
    parts: r.parts.length,
    stages: r.stages.map((s) => ({
      i: s.index,
      dv: Math.round(s.deltaVVacuumMS * 100) / 100,
      twr: Math.round(s.twr * 1000) / 1000,
      burnS: Math.round(s.burnTimeS * 100) / 100,
    })),
    totalDeltaV: r.stats.totalDeltaV,
    massKg: r.stats.massKg,
    padTwr: r.stats.padTwr,
    lengthM: r.stats.lengthM,
    staticMarginM: r.stats.staticMarginM,
    stable: r.stats.stable,
    drawCalls: of.stats().draw.calls,
    triangles: of.stats().draw.triangles,
    camera: r.camera,
  };
})()
