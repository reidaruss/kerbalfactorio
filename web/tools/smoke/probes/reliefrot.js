// RN-954. Pose a Beach frame for the ripple-direction measurement.
//
// THE PICTURE IS THE MEASUREMENT HERE, so the pose has to remove every way the
// frame could move for a reason that is not the change:
//
//   STEEP PITCH, not a level horizon. The instrument reads the ORIENTATION of
//   the ripple in each local window, and a perspective projection maps one
//   world direction to different screen directions across the frame. That
//   confound cannot be removed, only bounded: a steep look makes the ground
//   plane nearly affine in screen space, and the BEFORE frame's own window
//   spread is then the control for whatever is left. It is reported, not
//   assumed away.
//
//   PROPS OFF AND ANIMATION FROZEN. Grass cards and wind are the two things
//   that move between runs, and a card lying across the sand is a directional
//   feature the window statistic cannot tell from a ripple.
//
//   SUN PINNED AFTER THE LAST DATA-DEPENDENT WAIT (RN-13). The relief is a
//   BUMP: it is invisible at noon and it is the entire image at a grazing sun,
//   so an unpinned sun does not change the measurement slightly, it decides it.
//
//   THE SITE IS TELEPORTED TO AND CONVERGED. A window statistic over a frame
//   that is still streaming reads the LOD ring rather than the ground.
(async (A) => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };

  const cv = document.querySelector('canvas');
  const walk = (el) => {
    for (const c of el.children) {
      if (c === cv) continue;
      if (c.contains(cv)) { walk(c); continue; }
      c.style.display = 'none';
    }
  };
  walk(document.body);

  of.teleport(A.lat, A.lon, 2.0);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  if (typeof of.propsVisible === 'function') of.propsVisible(false);

  let aim = null;
  for (let i = 0; i < 120; i++) {
    aim = of.aim?.();
    if (aim && typeof aim.pitchDeg === 'number') break;
    await of.run(0.1);
  }
  if (aim === null) return { valid: false, why: 'no player' };
  of.look(A.yaw ?? 0, A.pitch ?? -62);
  await of.run(0.5);
  // A grazing sun, set LAST. `sundot` solves against the site (RN-844).
  const solve = of.setSunElev(A.sunDot ?? 0.10);
  await of.settle(30);

  const w = of.world();
  return {
    valid: true,
    pass: w.chunks.converged === true,
    solve,
    biome: w.biome ?? null,
    lat: A.lat, lon: A.lon,
    pitch: of.aim().pitchDeg,
    converged: w.chunks.converged,
  };
})(OF_ARGS)
