// RN-846. What is the ground actually lit BY, on Cinder, at night?
// Planetshine is only worth wiring into the ground ambient if the ground has
// somewhere to go. This measures the headroom rather than assuming it.
(async () => {
  const of = window.__of; const B = window.__ofBodies;
  let node = document.querySelector('canvas');
  while (node !== null && node.parentElement !== null) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib !== node) sib.style.display = 'none';
    }
    node = node.parentElement;
  }
  of.teleport(OF_ARGS.lat, OF_ARGS.lon, 2.0);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  of.propsVisible(false);
  // RN-844: solve the elevation AGAINST THIS SITE, and report the miss, because
  // a ?sundot= solved at the spawn is a different elevation here.
  const solve = of.setSunElev(OF_ARGS.sunDot);
  await of.settle(2);
  const a = B.aim()[0];
  // Look DOWN at the ground, so the measured pixels are ground and not sky. The
  // aim is only used for its yaw: pointing at the body would photograph the sky.
  of.look(a.yawDeg, -35);
  await of.settle(30);
  return { solve, aim: a, shine: B.planetshine(),
    lampOn: of.stats().headlamp ?? null };
})()
