// RN-846. The night SKY on an airless body, with the camera actually pointed at
// it. The previous reading took the top 10 per cent of a frame pitched 35
// degrees DOWN and called it sky; at a 60-degree FOV the top of that frame is
// still 5 degrees below the horizon, so it was ground, and the "sky p50" it
// produced was a ground p50 wearing a label. Pitch is +45 here and the band is
// the top 30 per cent, so every measured pixel is above the horizon by
// construction rather than by hope.
(async () => {
  const of = window.__of;
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
  const solve = of.setSunElev(OF_ARGS.sunDot);
  // Yaw AWAY from the other body, so its disc is not in the measured band.
  const a = window.__ofBodies.aim()[0];
  of.look((a ? a.yawDeg : 0) + 180, 45);
  await of.settle(30);
  return { solve, air: of.stats().sky.air, aimYaw: a ? a.yawDeg : null };
})()
