// Pose only. Used to photograph the SAME camera with and without a feature.
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
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  if (OF_ARGS.props === false) of.propsVisible(false);
  if (OF_ARGS.fov) window.__ofBodies.setFov(OF_ARGS.fov);
  if (OF_ARGS.debug === true) window.__ofBodies.setDebug(true);
  of.setTime(OF_ARGS.sunT);
  of.look(OF_ARGS.yawDeg, OF_ARGS.pitchDeg);
  of.setTime(OF_ARGS.sunT);
  await of.settle(30);
  const r = window.__ofBodies.report();
  return { present: r.present, reason: r.reason, converged: of.world().chunks.converged };
})()
