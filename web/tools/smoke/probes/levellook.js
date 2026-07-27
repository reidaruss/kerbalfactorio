// The levelling tool from where the player stands. One site, one camera, one
// variable, so the pair is evidence rather than two pictures.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --scenario=walk \
//     --evalfile=tools/smoke/probes/levellook.js \
//     --evalargs='{"stage":"after"}' --out=docs/screenshots/x.png
//
// `stage` is "before" (teleport and look, touch nothing) or "after" (one real Q
// press first). The press is made at the pitch a person actually walks around
// at, NOT at the -72 degrees the old capture used: the whole finding was that
// the tool did nothing at any natural angle, so photographing it from a posture
// nobody adopts would prove the wrong thing.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const realKey = async (code, secs) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    await of.run(secs, 60);
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    await of.run(0.4, 60);
  };

  await settle(1.0);
  if (of.world().player === null) return { valid: false, why: 'no character' };
  await of.wipe();
  of.forgetTunnels();
  const t0 = of.world().tick;

  of.teleport(A.latDeg ?? 1.79040, A.lonDeg ?? 144.20960, 2.0);
  await settle(A.arriveSecs ?? 3.0);
  // The sun near the zenith for BOTH stages. A pad's cut walls face sideways, so
  // at the scenario's low default sun the foreground photographs as a black
  // mass; this changes only the light and it changes it identically either way.
  of.setTime(A.sunT ?? 0.3);
  of.look(A.yawDeg ?? 0, A.pitchDeg ?? -15);
  await settle(0.6);

  const stage = A.stage ?? 'after';
  if (stage === 'after') {
    await realKey('KeyQ', A.levelSecs ?? 1.6);
    await settle(1.5);
  }
  // The capture is taken from WHERE THE PLAYER PRESSED, looking the way they
  // were looking. Backing off for a prettier composition was tried and dropped:
  // this site's uphill neighbour is a 68 degree face, so the camera ended up
  // above the pad looking at a wall. Standing on it is also the honest frame,
  // because it is the view the person who pressed the key actually gets.
  of.look(A.yawDeg ?? 0, A.shotPitchDeg ?? A.pitchDeg ?? -15);
  await settle(1.5);

  const tf = of.terraform();
  return {
    valid: of.world().tick - t0 > 200,
    stage,
    removedCells: tf.removedCells,
    addedCells: tf.addedCells,
    levels: tf.action.levels,
    underfoot: tf.action.underfoot,
    flatnessM: tf.action.lastFlatnessM,
    said: tf.action.lastMessage,
    ring: tf.ring,
    surfaceHeightM: +of.world().surfaceHeightM.toFixed(2),
    slopeCos: +of.world().player.slopeCos.toFixed(3),
  };
})()
