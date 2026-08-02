// RN-621: THE CREATURE MIXER ON PIXELS, AND THE FOOT SLIP AS AN ASSERTED
// NUMBER RATHER THAN A REMEMBERED ONE.
//
//   node tools/smoke/run.mjs --sandbox=1 --combat=1 --scenario=walk \
//     --sundot=0.30 --props=0 --water=0 --url=http://127.0.0.1:<port>/ \
//     --evalfile=tools/smoke/probes/spidergait.js \
//     --evalargs='{"expectAnim":true}' --out=docs/screenshots/RN621_live.png
//   and the SAME command with --anim=0 and expectAnim false.
//
// WHY THIS IS NOT animgate.js WITH A DIFFERENT SUBJECT, and the correction is
// worth writing down because the work was briefed the other way round.
// animgate.js proves the PLAYER's mixer using the IDLE clip's own 2.0 s cycle
// (its header says so): strong tile motion at half period, none at full period,
// nothing at all when frozen. It works because the subject is STATIONARY.
//
// A MARCHING CREATURE IS NOT, AND NO THRESHOLD FIXES THAT. EnemySwarm.march
// advances a creature at type.speedMps every tick with no arrival condition
// (tangentTowards returns null only at the degenerate goal), so a 6 m/s
// Skitterer crosses 2.2 m in one walk period and the frame at t and t+period
// shares no tiles with itself. The t/t+period identity test is structurally
// unavailable for a WALK cycle on screen, in this client, for every creature.
//
// So the cycle property is asserted on the one creature subject that does hold
// still: a creature inside reach of something is `biting`, SpiderFlock.pose
// gives it Spider_Idle at timeScale 1.0, and EnemySwarm.step `continue`s before
// march(). That is a stationary skinned creature playing an authored 2.0 s
// clip, which is animgate's fixture exactly, on this domain's other rig.
//
// The WALK's cycle closure is proved where it CAN be proved exactly, on the
// shipped bytes, by tools/blender/gait_check.py: it reads each Tibia tail out
// of spider.glb at phase 0.0 and phase 1.0 and reports the closure error in
// metres. A screen cannot beat a bone position at that job.
//
// NAMED FAILURE MODES (INSTRUMENTS.md), before measuring: rest pose on screen
// is the mixer not ticking, which ?anim=0 produces ON PURPOSE so the positive
// reading is attributable to the mixer and nothing else; a creature collapsed
// to a point at its origin is a bind-matrix mismatch; a pose that animates
// while the body slides is a timeScale that ignored the instance scale, which
// is check 3 and is the number this probe exists to stop being a memory.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const expect = OF_ARGS && typeof OF_ARGS.expectAnim === 'boolean'
    ? OF_ARGS.expectAnim : true;
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const E = () => of.enemies();
  const march = (secs) => of.run(secs, 60);

  await of.run(1.0);
  of.audio('unlock');
  await of.run(0.2);

  const e0 = E();
  if (!check('combat world', e0.enabled === true, e0.why)) {
    return { valid: false, fails, why: e0.why };
  }

  // ---- the cause: buildings for the wave to chew on. The stationary subject
  // has to be BUILT, not hoped for: a wave with nothing to attack marches past
  // the camera for ever and never plays the idle at all.
  const yaw0 = of.world().observer.yawDeg;
  for (let i = 0; i < 8; i++) {
    of.build(3);
    await of.run(0.08);
    of.look(yaw0 + i * 21, -24);
    await of.run(0.18);
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await of.run(0.32);
  }
  await of.run(1.2);

  let waves = 0;
  for (let k = 0; k < 30 && waves === 0; k++) {
    waves = of.enemies('advance', 3600).wavesDispatched;
  }
  if (!check('a wave dispatched', waves > 0, `${waves}`)) {
    return { valid: false, fails, enemies: E() };
  }
  await march(2);

  // ---- 1. THE FIXTURE, asserted before the behaviour (GP-142/GP-145): the
  // flag that came in on the URL is checked against the flock's own published
  // animLive, so a dropped ?anim=0 fails by name instead of quietly measuring
  // the wrong branch and calling it green.
  const s0 = E().spiders;
  const fixtureOk = check('the flock loaded', s0.state === 'ready', s0.error)
    && check('the flag reached the flock', s0.animLive === expect,
      `animLive ${s0.animLive}, expected ${expect}`);

  // ---- 2. THE DELIVERED FOOT SLIP, computed from the client's OWN published
  // fields and checked against the arithmetic rather than against a constant
  // typed into this file.
  //
  // SpiderFlock.pose sets timeScale = speedMps / (SPIDER_WALK_MPS * scale) and
  // CLAMPS it to WALK_TIMESCALE_MAX. Where the clamp bites, the legs cycle
  // slower than the ground passes and the planted foot skates backward at
  // exactly (required - delivered)/required of the body speed. That fraction is
  // a RECORDED TRADE (A-13: "31% slip accepted over unreadable legs") and a
  // recorded number that nothing asserts is a number that can rot silently, so
  // it is recomputed here every run and the worst offender is named.
  const TS_MAX = 2.2, TS_MIN = 0.4;
  const slip = [];
  for (const row of (E().types.rows ?? [])) {
    const scale = row.radiusM;
    const required = row.speedMps / (s0.walkMps * scale);
    const delivered = Math.min(TS_MAX, Math.max(TS_MIN, required));
    slip.push({
      type: row.name, speedMps: row.speedMps, scale: +scale.toFixed(3),
      required: +required.toFixed(4), delivered: +delivered.toFixed(4),
      slipPct: +(100 * (1 - delivered / required)).toFixed(2),
      skateMps: +(row.speedMps * (1 - delivered / required)).toFixed(4),
    });
  }
  check('the slip table was built', slip.length > 0, `${slip.length} rows`);
  const worst = slip.reduce((w, r) => (r.slipPct > w.slipPct ? r : w),
    { type: '', slipPct: -1 });

  // ---- 3. stand BESIDE the column, not inside it, and read the walkers.
  // spiderwalk.js paid for this line: teleporting onto the nearest creature put
  // 50 Skitterers in reach, every rig playing the IDLE because every one of
  // them was biting the player, and the run ended with the camera under a
  // spider standing over the corpse.
  const OFF_DEG = 55 / ((Math.PI * 600000) / 180);
  const near0 = of.enemies('near', 1)[0];
  if (near0 !== undefined) {
    of.teleport(near0.latDeg + OFF_DEG, near0.lonDeg, 30);
    await of.run(1.5);
    await of.settle(6);
  }
  const clipsSeen = new Set();
  const seeClips = () => {
    for (const p of E().spiders.playing) if (p.clip !== '') clipsSeen.add(p.clip);
  };
  seeClips();
  const walking = E().spiders.playing.filter((p) => p.clip === 'Spider_Walk');
  check('a marching claimed creature plays the walk', walking.length > 0,
    JSON.stringify(E().spiders.playing));
  // Every live walker's timeScale must appear in the table above. This is what
  // catches a scale that stopped being applied: the pose still animates, the
  // body still slides, and a still frame cannot tell.
  const offTable = walking.filter((p) => !slip.some(
    (r) => Math.abs(r.delivered - p.timeScale) < 1e-3));
  check('every walker timeScale is on the catalogue table',
    offTable.length === 0, JSON.stringify(offTable));

  // ---- 4. THE CYCLE, ON PIXELS, on the stationary biting subject. Let the
  // wave reach the smelters and chew: those creatures stop and take the idle.
  let idleSeen = 0;
  for (let k = 0; k < 30 && idleSeen === 0; k++) {
    await march(0.5);
    idleSeen = E().spiders.playing.filter((p) => p.clip === 'Spider_Idle').length;
  }
  check('a stopped creature plays the idle', idleSeen > 0, `${idleSeen}`);
  seeClips();

  const TX = 48, TY = 27;
  const grab = async () => { await of.settle(4); return of.framehash(TX, TY); };
  // The floor is RN-121's: this scene moves 13 to 32 tiles at up to 2.72 counts
  // per simulated second even fully frozen, so `strong` is thresholded at 3.0
  // and every claim below is made ABOVE that floor rather than against zero.
  const tileDiff = (a, b) => {
    let moved = 0, strong = 0, max = 0;
    for (let i = 0; i < a.tiles.length; i++) {
      const d = Math.abs(a.tiles[i] - b.tiles[i]);
      if (d > max) max = d;
      if (d > 0.25) moved++;
      if (d > 3.0) strong++;
    }
    return { moved, strong, max: +max.toFixed(3) };
  };

  const h0 = await grab();
  await of.run(1.0);            // half of the 2.0 s Spider_Idle cycle
  const h1 = await grab();
  await of.run(1.0);            // completes one full cycle from h0
  const h2 = await grab();
  const half = tileDiff(h0, h1);
  const full = tileDiff(h0, h2);
  const bitExact = h0.hash === h1.hash && h1.hash === h2.hash;

  // A playing cyclic clip: strong motion at half period, NONE at full period.
  // No static defect and no monotonic drift produces that pair, which is why
  // the property asserted is the CYCLE and never the magnitude. Note the frame
  // still contains marching creatures, so `moved` is not expected to be zero at
  // full period; `strong` is the pose-scale band and it is.
  const live = half.strong >= 8 && full.strong < half.strong * 0.4;
  const frozen = half.strong === 0 && full.strong === 0;
  check(expect ? 'idle cycle: strong at half period, collapsed at full'
    : 'frozen build shows no strong motion at either offset',
  expect ? live : frozen,
  `half ${half.strong} full ${full.strong} bitExact ${bitExact}`);

  const st = of.stats();
  return {
    valid: true,
    expectAnim: expect,
    fixture: { ok: fixtureOk, state: s0.state, animLive: s0.animLive,
      claimed: s0.claimed, maxRigs: s0.maxRigs, walkMps: s0.walkMps },
    clipsSeen: [...clipsSeen].sort(),
    walkers: walking.length,
    idleSeen,
    slip,
    worstSlip: worst,
    cycle: { half, full, bitExact, hashes: [h0.hash, h1.hash, h2.hash] },
    cost: { drawCalls: st.draw.calls, triangles: st.draw.triangles,
      programs: st.draw.programs ?? null },
    fails,
    ok: fails.length === 0,
  };
})()
