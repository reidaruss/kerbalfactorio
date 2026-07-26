// W7: the world is not silent between actions.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/ambience.js --out=docs/screenshots/W7_ambience.png
//
// TWO CLAIMS, CHECKED SEPARATELY, because either one alone is easy to fake.
//
//   THE BEDS MAKE A SOUND. Rendered offline through an OfflineAudioContext,
//   which no autoplay policy blocks, and measured by RMS rather than by peak: a
//   bed with a peak and no body is a click, and a bed that runs for ever
//   producing silence is exactly what a play counter would report as working.
//
//   THE LEVELS FOLLOW THE WORLD. The player is driven from open ground into a
//   dug tunnel and back out, and the assertion is the CROSSOVER: wind down and
//   the underground up when there is rock overhead, and the reverse when there
//   is not. A build that simply played all three beds at a constant level would
//   pass a "beds exist" check and fail this one.
(async () => {
  const of = window.__of;
  const settle = (secs) => of.run(secs, 60);
  const amb = () => of.game().audio.ambience;

  await settle(1.0);
  const t0 = of.world();
  if (of.voxels() === null) return { valid: false, why: 'no character' };

  // --- 1. the beds, rendered and measured ----------------------------------
  const rendered = await of.audioRender();
  const beds = rendered.beds.beds ?? {};
  const voices = rendered.voices.voices ?? {};
  const bedNames = Object.keys(beds);
  const silentBeds = bedNames.filter((n) => beds[n].rms < 0.01);

  // --- 2. the surface: wind up, underground silent --------------------------
  const yaw = of.world().observer.yawDeg;
  of.look(yaw, 0);
  await settle(2.5);
  const surface = { ...amb() };

  // --- 3. dig in and stand under the rock -----------------------------------
  let landed = 0;
  for (let i = 0; i < 6; ++i) {
    of.look(yaw, -85);
    const r = of.dig();
    if (r !== null && r.cells > 0) landed++;
    await settle(0.3);
  }
  for (let i = 0; i < 10; ++i) {
    of.look(yaw, -12);
    const r = of.dig();
    if (r !== null && r.cells > 0) landed++;
    await settle(0.2);
    of.input.tape([{ hold: 20, keys: ['KeyW'] }]);
    await settle(0.24);
  }
  // Long enough for the one-second ease to have arrived: a level read mid-fade
  // measures the smoothing, not the world.
  await settle(3.0);
  const underground = { ...amb() };

  // --- 4. back out into the open --------------------------------------------
  // Walked out first, and then teleported clear if the shaft beat the walk.
  // Climbing a vertical bore is the character controller's problem and not this
  // probe's claim; what has to be shown is that the levels come BACK, and a
  // teleport puts the player on open ground through the observer's own path.
  for (let i = 0; i < 8; ++i) {
    of.input.tape([{ hold: 30, keys: ['KeyS'] }]);
    await settle(0.4);
  }
  await settle(1.0);
  const walkedOut = !amb().underRock;
  if (!walkedOut) {
    const o = of.world().observer;
    of.teleport(o.latDeg + 0.004, o.lonDeg + 0.004, 2);
  }
  await settle(3.0);
  const back = { ...amb() };

  const w = of.world();
  return {
    valid: landed > 0 && (w.tick - t0.tick) > 900 && bedNames.length === 3,
    // --- THE ACCEPTANCE -----------------------------------------------------
    bedsMakeSound: silentBeds.length === 0
      && Object.values(voices).every((v) => v.peak > 0.01),
    // Wind and the underground trade places, and the trade reverses.
    levelsFollowTheWorld:
      surface.wind > 0.2 && surface.cave < 0.05 && !surface.underRock
      && underground.underRock && underground.cave > 0.7
      && underground.wind < surface.wind * 0.35
      && back.wind > underground.wind && back.cave < underground.cave,
    beds,
    voicePeaks: Object.fromEntries(
      Object.entries(voices).map(([k, v]) => [k, v.peak])),
    silentBeds,
    surface,
    underground,
    back,
    strikes: landed,
    walkedOut,
    // The whole audio layer's CPU, so "negligible" is a number.
    audio: of.audio(),
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw.calls },
  };
})()
