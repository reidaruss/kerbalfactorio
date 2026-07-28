// shot_pad.js: the launch guide on the pad (GP-139). Not an acceptance;
// probes/launchguide.js is.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  await sleep(0.7);
  const PID = [0x0100, 0x0101, 0x0103];
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of PID) {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const n = of.vab('nodes').filter((x) => x.parent === low.handle
      && x.onScreen && (x.kind === 'bottom' || x.kind === 'interstage'));
    if (n.length === 0) continue;
    of.vab('hover', n[0].ndc[0], n[0].ndc[1]);
    of.vab('place');
    await sleep(0.12);
  }
  of.vab('leave');
  await sleep(0.4);
  of.flight('rollout');
  await sleep(0.8);
  for (let i = 0; i < 16 && of.flight('report').distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.flight('board');
  await sleep(1.2);
  return { valid: true, status: of.flight('report').flight.status,
    chip: of.flight('navball').step };
})()
