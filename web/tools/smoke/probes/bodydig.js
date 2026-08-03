// PS-42 setup probe for `twobody.mjs`: DIG, THEN SAVE, on whichever body the
// page was booted on, and hand the runner the numbers that identify this body's
// work so the other body's boot can be checked for it.
//
// DRIVEN. `of.dig()` is the player's own strike through the same action the
// pick uses; nothing here writes an edit set directly. The strikes go straight
// down, which is the one aim that always finds ground on either body, because
// this probe has to be identical on Forge and on Cinder for the comparison to
// mean anything.
//
// THE FIXTURE IS ASSERTED BEFORE THE BEHAVIOUR (GP-142). A dig that struck
// nothing produces an empty edit set, and an empty edit set restores as an empty
// edit set on the other body, which is EXACTLY what a correct fix looks like. So
// a run that failed to dig would prove the fix while proving nothing, and the
// probe refuses rather than reporting a pass: `valid` is false unless the strike
// count, the removed-cell count and the saved byte count are all above zero.
(async () => {
  const of = window.__of;
  const strikes = OF_ARGS.strikes ?? 10;

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };

  await settle(1.5);
  const w0 = of.world();
  if (of.voxels() === null) {
    return { valid: false, fail: 'no character on this body, nothing can dig' };
  }

  of.look(0, -85);
  const shots = [];
  for (let i = 0; i < strikes; ++i) {
    shots.push(of.dig());
    await of.run(0.25, 60);
  }
  const struck = shots.filter((s) => s !== null && s.cells > 0).length;
  const v = of.voxels();
  const saved = await of.save();

  const out = {
    valid: true,
    // The body is read off its RADIUS and not off a flag, because the radius is
    // what every colliding key in the save is derived from: the voxel lattice,
    // the rock and tree cells, and discovery's grid resolution. 600000 is Forge
    // and 200000 is Cinder; the runner asserts the pair rather than trusting a
    // URL it wrote itself.
    bodyRadiusM: w0.bodyRadiusM,
    lat: +w0.observer.latDeg.toFixed(4),
    lon: +w0.observer.lonDeg.toFixed(4),
    surfaceHeightM: +w0.surfaceHeightM.toFixed(2),
    struck,
    removedCells: v.removedCells,
    addedCells: v.addedCells,
    ops: v.ops,
    savedVoxelBytes: saved && typeof saved === 'object' ? saved.voxelBytes : -1,
    savedVoxelOps: saved && typeof saved === 'object' ? saved.voxelOps : -1,
    saves: of.game().persist ? of.game().persist.saves : -1,
  };
  if (!(struck > 0)) return { ...out, valid: false, fail: `no strike landed: ${struck}` };
  if (!(out.removedCells > 0)) {
    return { ...out, valid: false, fail: `nothing was removed: ${out.removedCells}` };
  }
  if (!(out.savedVoxelBytes > 0)) {
    return { ...out, valid: false, fail: `the save carried no edits: ${out.savedVoxelBytes}` };
  }
  return out;
})()
