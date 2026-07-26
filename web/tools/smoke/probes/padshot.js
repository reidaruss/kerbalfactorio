// One site, one camera, one variable. The framing half of the voxel-skin work.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --scenario=walk \
//     --evalfile=tools/smoke/probes/padshot.js --evalargs='{"stage":"after"}' \
//     --out=docs/screenshots/RN_pad_after.png
//
// `stage` is "before" (teleport and look, touch nothing), "after" (level a pad
// first) or "dig" (a few strikes instead). Everything else is fixed, so two
// captures differ only by what the probe did, which is the only way a
// before/after pair is evidence rather than two pictures.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const hold = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };

  await settle(1.0);
  if (of.world().player === null) return { valid: false, why: 'no character' };
  await of.wipe();
  of.forgetTunnels();
  const t0 = of.world().tick;

  of.teleport(A.latDeg ?? 1.832, A.lonDeg ?? 144.168, 2.0);
  await settle(A.arriveSecs ?? 3.0);

  const stage = A.stage ?? 'before';
  if (stage === 'after') {
    of.look(A.workYawDeg ?? 0, A.workPitchDeg ?? -72);
    await settle(0.3);
    await hold(A.levelSecs ?? 1.6, ['KeyQ']);
  } else if (stage === 'dig') {
    of.look(A.workYawDeg ?? 0, A.workPitchDeg ?? -45);
    await settle(0.3);
    for (let k = 0; k < (A.strikes ?? 6); ++k) { of.dig(); await settle(0.1); }
  }
  await settle(1.2);

  of.look(A.yawDeg ?? 0, A.pitchDeg ?? -26);
  await settle(1.0);

  const st = of.stats();
  const tf = of.terraform();
  const vx = of.voxels();
  return {
    valid: of.world().tick - t0 > 200,
    stage,
    ticks: of.world().tick - t0,
    removedCells: tf.removedCells,
    addedCells: tf.addedCells,
    mesh: vx.mesh,
    meshVisible: vx.meshVisible,
    drawCalls: st.draw.calls,
    triangles: st.draw.triangles,
    p50Ms: st.frameMs.p50,
    p99Ms: st.frameMs.p99,
    surfaceHeightM: +of.world().surfaceHeightM.toFixed(2),
    biome: of.world().biome,
  };
})()
