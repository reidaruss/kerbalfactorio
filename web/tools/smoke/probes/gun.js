// gun.js: THE GUN FIRES, AND YOU CAN TELL (GP-86).
//
// The claim under test is not "damage was applied". It is Reid's: a gun that
// silently decrements a number will feel broken even when it is correct. So the
// assertions are about the four TELLS, counted separately, on the same shot:
//
//   MUZZLE FLASH  -> flashesDrawn rises AND the flash object is visible
//   REPORT        -> the audio bus played the `shot` voice
//   TRACER        -> tracersDrawn rises AND a tracer is live in the same frame
//   IMPACT        -> debris was spawned and the `impact` voice played
//
// Counting them separately is the whole design of this probe. One combined
// "the gun works" boolean cannot tell a silent gun from a broken one, and a
// silent gun is exactly the failure being guarded against.
//
// IT ALSO PROVES THE GUN IS A HAND. The eleventh hotbar slot decides what the
// left button does (GP-26), so the negative control is the SAME held click with
// the bare hand selected: it must fire NOTHING. A build that fired on every
// click would pass every positive assertion below.
//
// DW-20: the probe proves the world advanced and proves it aimed at ground
// before it claims a ground hit.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const log = [];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  };
  const G = () => of.game().gun;
  // `plays` is a Record keyed by VOICE NAME, so the sound assertions below name
  // the voice they expect rather than watching a total go up. A total rising is
  // satisfied by a footstep.
  const A = () => of.game().audio.plays ?? {};
  const played = (v, name) => (v[name] ?? 0);
  const FXd = () => of.game().fx;

  await sleep(1.0);
  // The audio graph will not start until a gesture unlocks it, and a headless
  // page has made none, so a `plays` counter of zero would otherwise be the
  // browser's policy rather than the gun's silence. Unlocking first is what
  // makes the sound assertion mean anything (DW-20 applied to audio).
  of.audio('unlock');
  await sleep(0.3);

  // --- 0. the gun has a home on the bar ------------------------------------
  const bar = of.game().hotbar;
  const gunSlot = bar.slots.findIndex((s) => s.label === 'sidearm');
  check('the gun has a hotbar slot', gunSlot >= 0,
        JSON.stringify(bar.slots.map((s) => s.label)));
  log.push(`gun in slot ${gunSlot + 1} of ${bar.slots.length}`);

  // --- 1. NEGATIVE CONTROL FIRST: the bare hand does not shoot -------------
  // First, deliberately: run after a burst and a stale counter would hide it.
  of.hotbar(1);
  await sleep(0.2);
  of.look(of.world().observer.yawDeg, -20);
  await sleep(0.1);
  const g0 = G();
  of.input.tape([{ hold: 30, actions: ['use'] }, { hold: 6, keys: [] }]);
  await sleep(0.7);
  const g1 = G();
  check('THE BARE HAND FIRES NOTHING', g1.shotsFired === g0.shotsFired,
        `${g0.shotsFired} -> ${g1.shotsFired} over a 30 tick held click`);
  check('and draws no tracer', g1.fx.tracersDrawn === g0.fx.tracersDrawn,
        `${g0.fx.tracersDrawn} -> ${g1.fx.tracersDrawn}`);
  log.push(`bare hand: ${g1.shotsFired - g0.shotsFired} shots over 30 held ticks`);

  // --- 2. ONE SHOT, and all four tells ------------------------------------
  of.hotbar(gunSlot + 1);
  await sleep(0.25);
  check('the gun is in hand', of.game().hotbar.label === 'sidearm',
        `"${of.game().hotbar.label}"`);
  // Aimed DOWN at the ground, so the shot has something to arrive on and the
  // impact assertion is not measuring a round that flew off into the sky.
  of.look(of.world().observer.yawDeg, -35);
  await sleep(0.15);

  const b = { gun: G(), audio: A(), fx: FXd() };
  // A short tap: 4 ticks is under one 150 ms shot interval at 400 rpm, so this
  // is exactly ONE round and the counters below are unambiguous.
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 2, keys: [] }]);
  await sleep(0.08);
  // Sampled while the tracer is still alive: TRACER_SECS is 0.06 and the flash
  // 0.045, so this frame is inside both. That timing IS the assertion, because
  // a tracer that is counted but never on screen is the exact defect.
  const mid = { gun: G(), fx: FXd() };
  await sleep(0.6);
  const a = { gun: G(), audio: A(), fx: FXd() };

  check('the trigger fired exactly one round', a.gun.shotsFired - b.gun.shotsFired === 1,
        `${b.gun.shotsFired} -> ${a.gun.shotsFired}`);
  check('TELL 1, the muzzle flashed',
        a.gun.fx.flashesDrawn - b.gun.fx.flashesDrawn === 1,
        `${b.gun.fx.flashesDrawn} -> ${a.gun.fx.flashesDrawn}`);
  // PAINTED, not merely counted, and measured over frames rather than at one
  // sample: a 45 ms flash gives a headless probe three frames to hit, and a
  // test that needs to win a race is a flaky test wearing a strict test's
  // clothes. `flashFrames` rises inside the same branch that sets `visible`.
  check('and the flash was actually PAINTED, not just counted',
        a.gun.fx.flashFrames > b.gun.fx.flashFrames,
        `${b.gun.fx.flashFrames} -> ${a.gun.fx.flashFrames} frames painted`);
  check('TELL 2, a tracer was drawn',
        a.gun.fx.tracersDrawn - b.gun.fx.tracersDrawn === 1,
        `${b.gun.fx.tracersDrawn} -> ${a.gun.fx.tracersDrawn}`);
  check('and it was on screen for at least one frame',
        a.gun.fx.tracerFrames > b.gun.fx.tracerFrames,
        `${b.gun.fx.tracerFrames} -> ${a.gun.fx.tracerFrames} frames painted`);
  check('and at least one tracer was live at the peak',
        a.gun.fx.peakLiveTracers >= 1, `${a.gun.fx.peakLiveTracers}`);
  check('TELL 3, the gun was HEARD, and it was the SHOT voice',
        played(a.audio, 'shot') - played(b.audio, 'shot') === 1,
        `${played(b.audio, 'shot')} -> ${played(a.audio, 'shot')} shot voices`);
  check('TELL 4, the round ARRIVED and threw debris',
        a.fx.debrisSpawned > b.fx.debrisSpawned,
        `${b.fx.debrisSpawned} -> ${a.fx.debrisSpawned}`);
  check('and it arrived on the GROUND, which is what it was aimed at',
        a.gun.groundHits - b.gun.groundHits === 1,
        `${b.gun.groundHits} -> ${a.gun.groundHits}`);
  // A shot that fires and hits requires TWO voices, the report and the arrival.
  // One would mean a hit is indistinguishable from a miss with the eyes shut.
  // TWO voices for one round, and they must be DIFFERENT voices: a hit that
  // sounded exactly like a miss would be indistinguishable with the eyes shut.
  check('a hit is TWO sounds, the report AND the arrival',
        played(a.audio, 'impact') - played(b.audio, 'impact') === 1,
        `${played(b.audio, 'impact')} -> ${played(a.audio, 'impact')} impact voices`);
  log.push(`one shot: +1 flash (visible ${mid.gun.fx.flashVisible}), +1 tracer `
    + `(${a.gun.fx.tracerFrames - b.gun.fx.tracerFrames} tracer / ${a.gun.fx.flashFrames - b.gun.fx.flashFrames} flash frames painted), ${played(a.audio, "shot")} shot / ${played(a.audio, "impact")} impact voices, `
    + `+${a.fx.debrisSpawned - b.fx.debrisSpawned} debris, `
    + `+${a.gun.groundHits - b.gun.groundHits} ground hits`);

  // --- 3. THE CADENCE IS THE WEAPON'S OWN, not the click's ----------------
  // A held trigger at 400 rpm is 150 ms a round. 60 ticks is 1.0 s, so the
  // count must be about 6 to 7 and NOT 60: a per-tick shot would be the bug
  // where the input rate is a second authority on the rate of fire.
  const c0 = G();
  of.input.tape([{ hold: 60, actions: ['use'] }, { hold: 4, keys: [] }]);
  await sleep(1.4);
  const c1 = G();
  const burst = c1.shotsFired - c0.shotsFired;
  const expected = 1.0 / c1.shotIntervalSecs;
  check('a held trigger fires at the WEAPON rate, not the tick rate',
        burst >= 5 && burst <= 9, `${burst} rounds in ~1.0 s against ~${expected}`);
  check('and the refusals in between are COUNTED, not silent',
        c1.refusals > c0.refusals, `${c0.refusals} -> ${c1.refusals}`);
  check('and every one of them drew its own tracer',
        c1.fx.tracersDrawn - c0.fx.tracersDrawn === burst,
        `${c1.fx.tracersDrawn - c0.fx.tracersDrawn} tracers for ${burst} rounds`);
  log.push(`held 1.0 s: ${burst} rounds at ${c1.shotIntervalSecs}s each, `
    + `${c1.refusals - c0.refusals} cycling refusals counted`);

  // --- 4. infinite ammo, said out loud -------------------------------------
  check('ammo is INFINITE and says so', c1.ammo === 'infinite', `${c1.ammo}`);

  return {
    valid: fails.length === 0,
    gun: c1,
    gunSlot: gunSlot + 1,
    burst,
    audio: A(),
    debrisSpawned: FXd().debrisSpawned,
    fails, log,
  };
})()
