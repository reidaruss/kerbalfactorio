// qolbuild2.js: QOL SURVEY, stage 2. PLACING THINGS and THE FACTORY.
// Records the DRAWN prompt/toast for every gesture and every refusal.
// --evalargs={"stage":"place"|"slope"|"drill"|"onore"|"belt"|"machine"
//                     |"chest"|"power"|"pad"}
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/qolbuild2.js
//
// BT-190: this probe never carried a real invocation; `extractCmd()`'s old
// first-match rule took a prose line further down ("...a returned `fails:
// [...]` or `valid:false` exits 0 and run.mjs prints `smoke: PASS`...") as
// the command, which held zero real flags, so every prior sweep ran this at
// the runner's bare defaults. `--sandbox=1` per `qolflight1.js`'s own
// rationale for the same family: several stages here place an assembler, a
// chest, a generator and a launch pad straight from the build menu with no
// crafting step, which needs the full catalogue unlocked to reach the UI
// question this survey is actually asking.
//
// GP-401, AMENDED BT-260 to BT-264. Every stage still asserts, but a failed
// assertion no longer THROWS. It used to, on the theory that a returned
// `fails: [...]` exits 0 and run.mjs prints `smoke: PASS`, so only a throw
// (which rejects page.evaluate) reached the exit code. That was true for a
// human driving run.mjs by hand, and false for the sweep: run.mjs's
// try/catch drops the ENTIRE report on a page.evaluate throw, not just the
// eval field, so probeall.mjs sees zero bytes on stdout and records
// NO_OUTPUT -- identical to a hard crash -- for what was actually a
// specific, named, correctly-diagnosed failure sitting in `fails`. Found
// live: the 'place' stage's own "press aimed at the SKY places nothing"
// check failing threw, and the sweep's own record of that run was
// indistinguishable from a hang. `finish()` below now returns `{ fails,
// valid: fails.length === 0, log }` instead (verdictOf()'s convention 1,
// the same shape terrainspec.js/carrier.js use), which probeall.mjs reads
// as a real RED verdict with the failing check name intact. The exit-code
// honesty for a standalone `node run.mjs` run is kept a different way: every
// failure still gets its own `console.error` line below, and run.mjs fails
// its OWN exit code on any page console.error independent of the report
// content, so `smoke: FAILURES` and a non-zero exit still happen either way.
//
// Two stages were DEAD before this pass and are fixed here:
//   * `machine` opened a SMELTER and then looked for a recipe menu. A smelter
//     has no recipe to pick; FS-56 says the ASSEMBLER is the machine whose
//     recipe the player must choose, so that is what this stage now places.
//   * `power` placed a generator, never placed the POLE its own comment
//     promised, and then read the power panel as though a grid existed.
(async () => {
  const of = window.__of;
  // A THROW, not `return {valid:false}`: a returned flag exits 0 and prints PASS.
  if (!of) throw new Error('probe: window.__of is missing, the client did not boot');
  const sleep = (n) => of.run(n);
  const stage = (OF_ARGS && OF_ARGS.stage) || 'place';

  // A DRAWN string, or null. `innerText` falls back to `textContent` on a
  // display:none element, so the old `txt()` reported hidden panels' stale
  // contents as though a player could read them. Measured: a game-hidden
  // #of-prompt returned a string naming the PREVIOUS item.
  // getClientRects() is the base test rather than offsetParent, because
  // offsetParent is null for position:fixed elements that ARE visible.
  const drawn = (el) => {
    if (el === null || el === undefined) return null;
    if (el.getClientRects().length === 0) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.02) return null;
    const s = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return s === '' ? null : s;
  };
  // The raw text REGARDLESS of visibility, for when a stage wants to prove a
  // panel holds the right content while deliberately hidden. Never use this to
  // claim a player read something.
  const raw = (el) => (el === null || el === undefined ? null
    : (el.textContent || '').replace(/\s+/g, ' ').trim());
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  [${detail}]`}`);
    if (!ok) fails.push(`${name} :: ${detail}`);
  };
  const finish = (out) => {
    // Each failure ALSO on its own console.error line, kept from the old
    // throwing version: run.mjs fails a standalone run's own exit code on
    // any page console.error, independent of what's in the returned report,
    // so `node run.mjs ... qolbuild2.js` by hand still prints `smoke:
    // FAILURES` and exits non-zero when a check fails. dedups on the first
    // 160 characters, so one line per failure survives that where one long
    // combined message would not.
    for (const f of fails) console.error(`probe FAIL: ${f}`);
    // RETURNED, NOT THROWN (BT-260 to BT-264, see the header comment): a
    // throw here drops the whole report before run.mjs ever prints it, so
    // the sweep read every real failure here as indistinguishable from a
    // crash. `fails: [...]` is verdictOf()'s convention 1, so a non-empty
    // array is read as a real RED verdict with every failing check's name
    // intact instead of NO_OUTPUT with none of them.
    return { ...out, valid: fails.length === 0, fails, log };
  };

  // Every HUD channel read BOTH ways at the same instant. `drawn` is what a
  // player could have read; a `*RawOnly` twin appears only when the element
  // holds text that is NOT on screen, i.e. exactly the string the old `txt()`
  // would have reported as though it were. #of-toast, #of-gain and #of-banner
  // are all `opacity:0` when idle rather than display:none (styles/game.css),
  // so raw() keeps handing back the LAST message for the rest of the run.
  const CHROME = { prompt: '#of-prompt', toast: '#of-toast', banner: '#of-banner',
    carry: '#of-carry', gain: '#of-gain', mode: '#of-mode' };
  const chrome = () => {
    const o = {};
    for (const k of Object.keys(CHROME)) {
      const el = document.querySelector(CHROME[k]);
      const d = drawn(el);
      const r = raw(el);
      o[k] = d;
      if (d === null && r !== null && r !== '') o[`${k}RawOnly`] = r;
    }
    return o;
  };

  const out = { probe: 'qolbuild2', stage, sandbox: of.sandbox().sandbox };
  const STAGES = ['place', 'slope', 'drill', 'onore', 'belt', 'machine',
    'chest', 'power', 'pad'];
  check(`'${stage}' is a stage this probe implements`, STAGES.indexOf(stage) !== -1,
    `not one of ${STAGES.join(' | ')}`);

  const press = async (frames) => {
    of.input.tape([{ hold: frames || 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await sleep(0.35);
  };
  const yaw0 = () => of.world().observer.yawDeg;
  const PITCHES = [-75, -70, -65, -60, -55, -50, -45, -40, -35, -30, -25, -20, -15];
  /** Sweep yaw x pitch for an aim that satisfies `want`. Returns null if none. */
  const sweepFor = async (want, yaws, pitches) => {
    const y0 = yaw0();
    let tried = 0;
    for (const dy of (yaws || [0, 40, 80, 120, 160, 200, 240, 280, 320])) {
      for (const p of (pitches || PITCHES)) {
        of.look((y0 + dy + 360) % 360, p);
        await sleep(0.05);
        tried += 1;
        if (want()) return { yaw: (y0 + dy + 360) % 360, pitch: p, tried };
      }
    }
    return { yaw: null, pitch: null, tried };
  };
  /** Take a buildable OUT OF THE BUILD MENU, which is how a player reaches the
   *  eight things that are not on the default hotbar (assembler, chest, pole,
   *  generator, electric smelter, the two hand furnaces, launch pad). */
  const pickFromMenu = async (id) => {
    of.buildMenu(true);
    await sleep(0.5);
    const root = document.querySelector('#of-build');
    const tile = root === null ? null : root.querySelector(`.of-btile[data-build="${id}"]`);
    const r = { id, menuDrawn: drawn(root) !== null, tileFound: tile !== null,
      tileDrawn: drawn(tile) };
    if (tile !== null) { tile.click(); await sleep(0.6); }
    if (of.buildMenu().open) { of.buildMenu(false); await sleep(0.3); }
    r.holding = of.buildMenu().holding;
    r.hotbarPart = of.hotbar().part;
    r.hotbarLabel = of.hotbar().label;
    return r;
  };
  /** Aim at a placed thing bare-handed and open it. Fails LOUDLY if the aim
   *  never lands, which is the difference between "the panel said nothing" and
   *  "the probe never got in front of the machine". */
  const aimAndOpen = async (label) => {
    of.hotbar(1);
    await sleep(0.4);
    const hit = await sweepFor(() => of.game().aimed.build !== null,
      [0, 20, 340, 40, 320, 60, 300], PITCHES);
    const r = { label, aimTried: hit.tried, aimYaw: hit.yaw, aimPitch: hit.pitch,
      aimed: of.game().aimed, promptAtAim: chrome() };
    check(`bare-handed aim REACHED the placed ${label} (fixture)`,
      hit.yaw !== null, `no aim in ${hit.tried} of ${hit.tried} yaw x pitch samples put game().aimed.build non-null`);
    if (hit.yaw === null) return r;
    of.input.act(['interact'], 4);
    await sleep(0.8);
    r.screen = of.game().screen;
    r.furnaceOpen = of.game().furnaceOpen;
    return r;
  };

  await sleep(0.9);

  // ---- INSTRUMENT SELF-TEST, every run ------------------------------------
  // #of-panel (the Tab pack) is always in the DOM and `display:none` until it
  // gains `.open` (styles/game.css), so shut it must satisfy both halves at
  // once: raw() still returns its hint sentences and drawn() returns null.
  {
    const p = document.querySelector('#of-panel');
    out.instrument = {
      selector: '#of-panel',
      display: p === null ? null : getComputedStyle(p).display,
      clientRects: p === null ? null : p.getClientRects().length,
      rawChars: raw(p) === null ? null : raw(p).length,
      rawHead: raw(p) === null ? null : raw(p).slice(0, 110),
      drawn: drawn(p),
    };
    check('instrument: #of-panel is in the DOM', p !== null, 'querySelector returned null');
    check('instrument: the SHUT pack computes to display:none',
      out.instrument.display === 'none', `display=${out.instrument.display}`);
    check('instrument: raw() STILL reports the shut pack’s text (the old txt() bug)',
      out.instrument.rawChars !== null && out.instrument.rawChars > 40,
      `rawChars=${out.instrument.rawChars}`);
    check('instrument: drawn() returns null for that same shut element',
      out.instrument.drawn === null, `drawn=${JSON.stringify(out.instrument.drawn)}`);
  }

  if (stage === 'place') {
    // ---- a foundation, the first thing a player builds ------------------
    of.hotbar(6);
    await sleep(0.4);
    out.holdingFoundation = { chrome: chrome(), label: of.hotbar().label,
      part: of.hotbar().part };
    check('slot 6 puts a FOUNDATION in hand (fixture)',
      out.holdingFoundation.part === 'foundation',
      `hotbar().part=${JSON.stringify(out.holdingFoundation.part)}`);
    const sweep = [];
    const y0 = yaw0();
    const feet = of.world().player.feet;
    const dOf = (g) => Math.round(Math.hypot(g.pos[0] - feet[0],
      g.pos[1] - feet[1], g.pos[2] - feet[2]) * 100) / 100;
    // PITCH ONLY: does aiming further away move the preview further away?
    for (let p = -85; p <= -5; p += 10) {
      of.look(y0, p);
      await sleep(0.06);
      const g = of.build().structGhost;
      sweep.push({ what: 'pitch', v: p, key: g && g.key, distM: g && dOf(g),
        ok: g && g.ok, reason: g && g.reason, ba: of.buildAim() });
    }
    // YAW: does turning move it?
    for (const dy of [0, 45, 90, 135, 180]) {
      of.look((y0 + dy + 360) % 360, -20);
      await sleep(0.06);
      const g = of.build().structGhost;
      sweep.push({ what: 'yaw', v: dy, key: g && g.key, distM: g && dOf(g),
        ok: g && g.ok, reason: g && g.reason, ba: of.buildAim() });
    }
    of.look(y0, -20);
    await sleep(0.1);
    out.aimSweep = sweep;
    out.aimSamples = sweep.length;
    out.aimWithGhost = sweep.filter((s) => s.key !== null && s.key !== undefined).length;
    check(`a foundation in hand draws a PREVIEW at some aim (${out.aimWithGhost} of ${out.aimSamples} samples)`,
      out.aimWithGhost > 0, `0 of ${out.aimSamples} aims produced a structGhost`);
    out.pitchDistances = sweep.filter((s) => s.what === 'pitch' && s.distM !== null)
      .map((s) => s.distM);
    out.distinctPitchDistances = [...new Set(out.pitchDistances)].length;
    check(`pitching the camera MOVES the preview (${out.distinctPitchDistances} distinct distances over ${out.pitchDistances.length} pitch samples)`,
      out.distinctPitchDistances > 1,
      `${out.distinctPitchDistances} of ${out.pitchDistances.length} distances were distinct`);

    // FIXTURE: find an aim the game will actually accept, and fail if there is
    // none rather than pressing into a refusal and calling the result a
    // measurement of placement.
    const site = await sweepFor(() => {
      const g = of.build().structGhost;
      return g !== null && g.ok === true;
    });
    out.placeableAim = site;
    check('found an aim at which the foundation preview is PLACEABLE (fixture)',
      site.yaw !== null,
      `no ok=true structGhost in ${site.tried} of ${site.tried} yaw x pitch samples`);
    if (site.yaw !== null) {
      out.beforeFirst = { chrome: chrome(), ghost: of.build().structGhost };
      const p0 = of.game().structures.parts.length;
      await press(4);
      out.afterFirst = { chrome: chrome(),
        parts: of.game().structures.parts.length, delta: of.game().structures.parts.length - p0 };
      check('one press on an OK foundation preview placed exactly one part',
        out.afterFirst.delta === 1, `${out.afterFirst.delta} parts placed`);
      out.firstPlacementSaid = out.afterFirst.chrome.toast;
      check('the game SAYS OUT LOUD that the foundation went down (drawn toast)',
        out.firstPlacementSaid !== null,
        `#of-toast drawn=null; raw-only=${JSON.stringify(out.afterFirst.chrome.toastRawOnly)}`);

      // PRESS AGAIN WITHOUT MOVING THE AIM. The first version of this asserted
      // that the second press placed nothing and it FAILED, correctly: the
      // preview does not sit still on an occupied cell, it snaps to the
      // neighbouring socket (`snapped: "#1 socket_edge_e"`, `carryRun: 1`) and
      // the run chains outward. So the question is not "does it refuse at once"
      // but "how many presses of a motionless aim does it take to reach the
      // refusal, and is the refusal then said out loud".
      const chain = [];
      let refusedAt = null;
      for (let i = 0; i < 8 && refusedAt === null; i += 1) {
        const before = of.game().structures.parts.length;
        const g = of.build().structGhost;
        await press(4);
        const after = of.game().structures.parts.length;
        chain.push({ press: i + 1, key: g && g.key, ok: g && g.ok,
          reason: g && g.reason, snapped: g && g.snapped,
          carryRun: g && g.carryRun, delta: after - before,
          toast: drawn(document.querySelector('#of-toast')) });
        if (after === before) refusedAt = i + 1;
      }
      out.motionlessChain = chain;
      out.motionlessPresses = chain.length;
      out.motionlessPlaced = chain.reduce((a, c) => a + c.delta, 0);
      out.refusedAtPress = refusedAt;
      check(`a motionless aim eventually REFUSES (${refusedAt === null ? '0' : '1'} of ${out.motionlessPresses} presses placed nothing)`,
        refusedAt !== null,
        `all ${out.motionlessPresses} of ${out.motionlessPresses} presses placed a part; `
        + `the run chained to keys ${JSON.stringify(chain.map((c) => c.key))}`);
      const last = chain[chain.length - 1];
      out.sameCellReason = last === undefined ? null : last.reason;
      out.sameCellRefusalDrawn = last === undefined ? null : last.toast;
      if (refusedAt !== null) {
        check('the game SAYS OUT LOUD why the refused press was refused (drawn toast)',
          out.sameCellRefusalDrawn !== null,
          `#of-toast drawn=null; model reason=${JSON.stringify(out.sameCellReason)}; `
          + `raw-only=${JSON.stringify(chrome().toastRawOnly)}`);
      }
    }

    // aim at the sky: a placement with nothing under it
    of.look(yaw0(), 45);
    await sleep(0.3);
    const p2 = of.game().structures.parts.length;
    out.skyGhost = { ghost: of.build().structGhost, chrome: chrome() };
    await press(4);
    out.skyPress = { chrome: chrome(), parts: of.game().structures.parts.length,
      delta: of.game().structures.parts.length - p2 };
    check('a press aimed at the SKY places nothing', out.skyPress.delta === 0,
      `${out.skyPress.delta} parts placed at pitch +45`);

    // A WALL. Aimed above the horizon it usually has no deck under it, but by
    // now this stage has BUILT a deck, so the preview may legitimately be OK.
    // The assertion therefore follows the preview's own verdict rather than
    // assuming a refusal: an earlier version asserted "places nothing" and
    // failed because the wall correctly landed on the foundation just built.
    of.hotbar(8);
    await sleep(0.3);
    check('slot 8 puts a WALL in hand (fixture)', of.hotbar().part === 'wall',
      `hotbar().part=${JSON.stringify(of.hotbar().part)}`);
    of.look(yaw0(), 20);
    await sleep(0.3);
    const p3 = of.game().structures.parts.length;
    out.wallInAir = { ghost: of.build().structGhost, chrome: chrome() };
    const wallOk = out.wallInAir.ghost !== null && out.wallInAir.ghost.ok === true;
    out.wallGhostOk = wallOk;
    await press(4);
    out.wallInAirPress = { chrome: chrome(),
      delta: of.game().structures.parts.length - p3 };
    check(wallOk ? 'a press on an OK wall preview placed a wall'
      : 'a press on a REFUSED wall preview placed nothing',
      wallOk ? out.wallInAirPress.delta >= 1 : out.wallInAirPress.delta === 0,
      `${out.wallInAirPress.delta} parts placed, ghost.ok=${wallOk}, `
      + `reason=${JSON.stringify(out.wallInAir.ghost && out.wallInAir.ghost.reason)}`);
    out.wallInAirRefusalDrawn = out.wallInAirPress.chrome.toast;
    out.wallInAirReason = out.wallInAir.ghost === null ? null : out.wallInAir.ghost.reason;
    check('the wall press was SAID OUT LOUD either way (drawn toast)',
      out.wallInAirRefusalDrawn !== null,
      `#of-toast drawn=null; ghost.ok=${wallOk}; `
      + `raw-only=${JSON.stringify(out.wallInAirPress.chrome.toastRawOnly)}`);

    // ROTATE, with a part in hand. FS-27 splits the key two ways and the first
    // version of this check watched the wrong half: `turns` counts turning a
    // building ALREADY IN THE WORLD (BuildDrag.turnAimed, empty hand only) and
    // stayed at 0 forever with a wall in hand. What a held part turns is
    // `rotation`, 0..3 (BuildMode.ts line 176).
    const t0 = of.build().turns;
    const r0 = of.build().rotation;
    of.input.act(['rotate'], 4);
    await sleep(0.4);
    out.rotate = { turns0: t0, turns1: of.build().turns,
      rotation0: r0, rotation1: of.build().rotation, chrome: chrome() };
    check('the rotate key turns the HELD part (rotation advances 0..3)',
      out.rotate.rotation1 === (r0 + 1) % 4,
      `rotation ${r0} -> ${out.rotate.rotation1}; turns ${t0} -> ${out.rotate.turns1}`);
    // RECORDED: with a part in hand nothing on screen says which way it faces.
    out.rotateSaidOnScreen = out.rotate.chrome.toast;
    // free snap key
    const f0 = of.build().freePlace;
    of.input.act(['freeSnap'], 4);
    await sleep(0.4);
    out.freeSnap = { before: f0, after: of.build().freePlace, chrome: chrome() };
    check('the free-snap key TOGGLES free placement',
      out.freeSnap.after !== out.freeSnap.before,
      `freePlace ${JSON.stringify(out.freeSnap.before)} -> ${JSON.stringify(out.freeSnap.after)}`);
    out.buildAim = of.buildAim();
    out.ranStage = 'place';
  }

  if (stage === 'slope') {
    // THE SLOPE REFUSAL, which no earlier run ever reached. Its whole purpose is
    // that one sentence, so failing to find uneven ground is a FAILED stage and
    // not a shrug: the report would otherwise say "no refusal seen" about a
    // probe that never stood anywhere a refusal was possible.
    //
    // AND THE PLAYER CANNOT STAND ANYWHERE IT IS POSSIBLE AT SPAWN. Measured:
    // 120 of 120 aims around the spawn point returned ok=true with
    // unevennessM 0, because Boot grows a harvest clearing and levels it, and
    // the ring out to ~900 m only reaches 0.49 m against a 0.50 m bury
    // tolerance (StructureTolerance.ts). Digging does not help either: eight
    // `of.dig()` craters in front of the player produced 0 refusals in 56 aims,
    // because structure placement samples the terrain oracle and not the voxel
    // edits. So this stage FIRST FINDS ROUGH GROUND with the same oracle the
    // placement check uses, then stands on it.
    const f = of.world().player.feet;
    const R = Math.hypot(f[0], f[1], f[2]);
    const u = [f[0] / R, f[1] / R, f[2] / R];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => { const m = Math.hypot(a[0], a[1], a[2]); return [a[0] / m, a[1] / m, a[2] / m]; };
    const ref = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = norm(cross(u, ref));
    const e2 = norm(cross(u, e1));
    const dirAt = (D, bearDeg) => {
      const b = (bearDeg * Math.PI) / 180;
      const t = [e1[0] * Math.cos(b) + e2[0] * Math.sin(b),
        e1[1] * Math.cos(b) + e2[1] * Math.sin(b),
        e1[2] * Math.cos(b) + e2[2] * Math.sin(b)];
      return norm([u[0] * R + t[0] * D, u[1] * R + t[1] * D, u[2] * R + t[2] * D]);
    };
    const cands = [];
    for (const D of [100, 200, 300, 400, 600, 800, 1100, 1500, 2000, 2600, 3400,
      4400, 5600, 7000]) {
      for (const b of [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]) {
        const d = dirAt(D, b);
        const h0 = mustNum(of.surface(d[0], d[1], d[2]), 'surfaceM', 'of.surface()');
        let lo = h0;
        let hi = h0;
        // The spread over a 5 m ring, which is the span a foundation's
        // footprint is judged over in checkGround (StructurePlacement.ts).
        for (const bb of [0, 45, 90, 135, 180, 225, 270, 315]) {
          const d2 = dirAt(D + 5 * Math.cos((bb * Math.PI) / 180),
            b + ((5 * Math.sin((bb * Math.PI) / 180)) / D) * (180 / Math.PI));
          const h = mustNum(of.surface(d2[0], d2[1], d2[2]), 'surfaceM', 'of.surface()');
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
        cands.push({ D, bear: b, h0, spread: +(hi - lo).toFixed(3), dir: d });
      }
    }
    cands.sort((a, b) => b.spread - a.spread);
    out.terrainCandidates = cands.length;
    out.roughest = cands.slice(0, 5).map((c) => ({ D: c.D, bear: c.bear, spread: c.spread }));
    out.flattest = cands.slice(-3).map((c) => ({ D: c.D, bear: c.bear, spread: c.spread }));
    check(`the oracle found rough ground somewhere in ${cands.length} of ${cands.length} sampled spots`,
      cands.length > 0 && cands[0].spread > 0.5,
      `the roughest of ${cands.length} spots spans only ${cands[0] && cands[0].spread} m over 5 m`);

    const reasons = new Map();
    let samples = 0;
    const visited = [];
    let maxUnSeen = 0;
    for (const c of cands.slice(0, 6)) {
      const h = mustNum(of.surface(c.dir[0], c.dir[1], c.dir[2]), 'surfaceM', 'of.surface()');
      of.standAt(c.dir[0] * (h + 1.2), c.dir[1] * (h + 1.2), c.dir[2] * (h + 1.2));
      await sleep(1.6);
      of.hotbar(6);
      await sleep(0.3);
      check('slot 6 puts a FOUNDATION in hand (fixture)', of.hotbar().part === 'foundation',
        `hotbar().part=${JSON.stringify(of.hotbar().part)}`);
      const y0 = yaw0();
      let here = 0;
      for (const dy of [0, 45, 90, 135, 180, 225, 270, 315]) {
        for (const p of [-55, -45, -35, -25, -15]) {
          of.look((y0 + dy + 360) % 360, p);
          await sleep(0.05);
          samples += 1;
          const g = of.build().structGhost;
          if (g === null) continue;
          if (Math.abs(g.unevennessM) > maxUnSeen) maxUnSeen = Math.abs(g.unevennessM);
          if (g.ok === false && g.reason !== '') {
            here += 1;
            if (!reasons.has(g.reason)) {
              reasons.set(g.reason, { yaw: (y0 + dy + 360) % 360, pitch: p,
                unevennessM: g.unevennessM, seen: 0 });
            }
            reasons.get(g.reason).seen += 1;
          }
        }
      }
      visited.push({ D: c.D, bear: c.bear, spread: c.spread, refusedAims: here });
      if ([...reasons.keys()].some((r) => /uneven/i.test(r))) break;
    }
    out.spotsVisited = visited;
    out.refusalSamples = samples;
    out.maxUnevennessM = maxUnSeen;
    out.refusalReasons = [...reasons.entries()].map(([reason, v]) => ({ reason, ...v }));
    out.distinctRefusals = out.refusalReasons.length;
    check(`the terrain reached produced at least one placement refusal (${out.distinctRefusals} distinct over ${samples} of ${samples} aims)`,
      out.distinctRefusals > 0, `0 distinct refusals in ${samples} of ${samples} aims`);
    const slope = out.refusalReasons.find((r) => /uneven/i.test(r.reason));
    out.slopeRefusal = slope ?? null;
    check(`a GROUND-TOO-UNEVEN refusal is reachable (${out.spotsVisited.length} of ${out.spotsVisited.length} rough spots stood on, max unevenness ${maxUnSeen} m)`,
      slope !== undefined,
      `no reason matched /uneven/i; the ${out.distinctRefusals} seen were: `
      + out.refusalReasons.map((r) => JSON.stringify(r.reason)).join(', '));
    if (slope !== undefined) {
      of.look(slope.yaw, slope.pitch);
      await sleep(0.3);
      const p0 = of.game().structures.parts.length;
      out.beforeSlopePress = { ghost: of.build().structGhost, chrome: chrome() };
      await press(4);
      out.slopePress = { chrome: chrome(),
        delta: of.game().structures.parts.length - p0 };
      check('pressing into the uneven-ground refusal places nothing',
        out.slopePress.delta === 0, `${out.slopePress.delta} parts placed`);
      out.slopeRefusalDrawn = out.slopePress.chrome.toast;
      check('the uneven-ground refusal is SAID OUT LOUD where the player can read it',
        out.slopeRefusalDrawn !== null,
        `#of-toast drawn=null; model reason=${JSON.stringify(slope.reason)}; `
        + `raw-only=${JSON.stringify(out.slopePress.chrome.toastRawOnly)}`);
    }
    out.ranStage = 'slope';
  }

  if (stage === 'drill') {
    // What does a player SEE that tells them where ore is?
    out.ore = of.game().ore;
    out.oreNodes = of.nodes().slice(0, 6);
    of.hotbar(3);
    await sleep(0.4);
    out.holdingDrill = { chrome: chrome(), label: of.hotbar().label,
      part: of.hotbar().part };
    check('slot 3 puts a MINING DRILL in hand (fixture)',
      out.holdingDrill.part === 'miner',
      `hotbar().part=${JSON.stringify(out.holdingDrill.part)}`);
    // sweep for a spot with NO ore -> record the refusal text
    const seen = [];
    for (let p = -80; p <= -15; p += 5) {
      of.look(yaw0(), p);
      await sleep(0.08);
      const g = of.build().ghost;
      seen.push({ pitch: p, ok: g && g.ok, reason: g && g.reason,
        rate: g && g.ratePerSec, patch: g && g.patch,
        promptDrawn: drawn(document.querySelector('#of-prompt')) });
    }
    out.drillSweep = seen;
    out.drillSamples = seen.length;
    out.drillWithGhost = seen.filter((s) => s.ok !== null && s.ok !== undefined).length;
    out.drillOk = seen.filter((s) => s.ok === true).length;
    out.drillRefused = seen.filter((s) => s.ok === false).length;
    out.drillRefusalReasons = [...new Set(seen.filter((s) => s.ok === false)
      .map((s) => s.reason))];
    check(`a drill in hand produces a preview verdict at every one of ${out.drillSamples} pitches`,
      out.drillWithGhost === out.drillSamples,
      `${out.drillWithGhost} of ${out.drillSamples} pitches returned a ghost`);
    check(`every one of the ${out.drillRefused} refused drill aims carries a REASON string`,
      out.drillRefusalReasons.every((r) => typeof r === 'string' && r !== ''),
      `reasons seen: ${JSON.stringify(out.drillRefusalReasons)}`);
    of.look(yaw0(), -50);
    await sleep(0.3);
    out.beforeDrillPress = { chrome: chrome(), ghost: of.build().ghost };
    const b0 = of.game().factory.buildings;
    await press(4);
    out.afterDrillPress = { chrome: chrome(),
      buildings: of.game().factory.buildings,
      delta: of.game().factory.buildings - b0 };
    const wasOk = out.beforeDrillPress.ghost !== null && out.beforeDrillPress.ghost.ok === true;
    out.drillPressWasOnOkGhost = wasOk;
    check(wasOk ? 'a press on an OK drill preview built a drill'
      : 'a press on a REFUSED drill preview built nothing',
      wasOk ? out.afterDrillPress.delta >= 1 : out.afterDrillPress.delta === 0,
      `delta=${out.afterDrillPress.delta}, ghost.ok=${wasOk}, `
      + `reason=${JSON.stringify(out.beforeDrillPress.ghost && out.beforeDrillPress.ghost.reason)}`);
    if (!wasOk) {
      out.drillRefusalDrawn = out.afterDrillPress.chrome.toast;
      check('the off-ore drill refusal is SAID OUT LOUD (drawn toast)',
        out.drillRefusalDrawn !== null,
        `#of-toast drawn=null; raw-only=${JSON.stringify(out.afterDrillPress.chrome.toastRawOnly)}`);
    }
    out.ranStage = 'drill';
  }

  if (stage === 'onore') {
    // Stand ON the iron patch and look at it: what does the ground say?
    const list = of.game().ore.list;
    check('the world publishes at least one ore patch (fixture)',
      Array.isArray(list) && list.length > 0,
      `ore.list=${Array.isArray(list) ? list.length : typeof list}`);
    const p = (list || []).find((q) => q.resource === 51) || (list || [])[0];
    check('an ore patch with a centre was found to stand on (fixture)',
      p !== undefined && Array.isArray(p.centre), `patch=${JSON.stringify(p && p.resource)}`);
    if (p !== undefined) {
      const r = Math.hypot(p.centre[0], p.centre[1], p.centre[2]);
      const k = (r + 3) / r;
      of.standAt(p.centre[0] * k, p.centre[1] * k, p.centre[2] * k);
      await sleep(1.2);
      of.hotbar(3);
      await sleep(0.5);
      check('slot 3 puts a MINING DRILL in hand (fixture)', of.hotbar().part === 'miner',
        `hotbar().part=${JSON.stringify(of.hotbar().part)}`);
      const seen = [];
      for (let dy = 0; dy < 360; dy += 30) {
        for (const pit of [-70, -45, -25]) {
          of.look(dy, pit);
          await sleep(0.05);
          const g = of.build().ghost;
          seen.push({ yaw: dy, pitch: pit, ok: g && g.ok,
            reason: g && g.reason, rate: g && g.ratePerSec, patch: g && g.patch });
        }
      }
      out.onOreAll = seen.length;
      out.onOreSweep = seen.filter((s) => s.ok);
      out.onOreOk = out.onOreSweep.length;
      check(`standing on the patch, at least one aim will take a drill (${out.onOreOk} of ${out.onOreAll} aims)`,
        out.onOreOk > 0, `0 of ${out.onOreAll} aims had ghost.ok=true`);
      const best = out.onOreSweep[0];
      if (best) { of.look(best.yaw, best.pitch); await sleep(0.3); }
      out.onOrePrompt = chrome();
      const b0 = of.game().factory.buildings;
      await press(4);
      out.onOrePlaced = { chrome: chrome(),
        buildings: of.game().factory.buildings,
        delta: of.game().factory.buildings - b0 };
      if (best) {
        check('a press on an OK on-ore drill preview built a drill',
          out.onOrePlaced.delta >= 1, `${out.onOrePlaced.delta} buildings added`);
      }
      // aim at the placed drill with an empty hand, then open it
      const opened = await aimAndOpen('mining drill');
      out.aimedDrill = opened;
      if (opened.aimYaw !== null) {
        out.drillScreen = opened.screen;
        const fp = document.querySelector('#of-furnace');
        out.drillPanelDrawn = drawn(fp);
        out.drillPanelRawChars = raw(fp) === null ? null : raw(fp).length;
        check('the drill screen is DRAWN after the interact key',
          out.drillPanelDrawn !== null,
          `#of-furnace drawn=null; display=${fp === null ? 'no element'
            : getComputedStyle(fp).display}; rawChars=${out.drillPanelRawChars}`);
        out.drillPanelTitle = drawn(fp && fp.querySelector('h3'));
        check('the drill screen names the machine it is showing',
          out.drillPanelTitle !== null, `h3 drawn=${JSON.stringify(out.drillPanelTitle)}`);
      }
    }
    out.ranStage = 'onore';
  }

  if (stage === 'belt') {
    of.hotbar(4);
    await sleep(0.4);
    out.holdingBelt = { chrome: chrome(), label: of.hotbar().label,
      part: of.hotbar().part };
    check('slot 4 puts a BELT in hand (fixture)', out.holdingBelt.part === 'belt',
      `hotbar().part=${JSON.stringify(out.holdingBelt.part)}`);
    out.holdingBeltPromptDrawn = out.holdingBelt.chrome.prompt;
    of.look(yaw0(), -45);
    await sleep(0.25);
    // ONE tap = how many tiles?
    const b0 = of.game().factory.buildings;
    out.beforeTap = { ghost: of.build().ghost };
    await press(4);
    out.oneTap = { placed: of.game().factory.buildings - b0,
      chrome: chrome(), build: of.build() };
    const tapOk = out.beforeTap.ghost !== null && out.beforeTap.ghost.ok === true;
    check(tapOk ? 'one tap on an OK belt preview places exactly one belt'
      : 'one tap on a REFUSED belt preview places nothing',
      tapOk ? out.oneTap.placed === 1 : out.oneTap.placed === 0,
      `${out.oneTap.placed} belts placed, ghost.ok=${tapOk}, `
      + `reason=${JSON.stringify(out.beforeTap.ghost && out.beforeTap.ghost.reason)}`);
    // AIM AT THE BELT NOW, BEFORE ANY WALKING. The old order did the drag
    // first and then hunted for a belt from wherever the walk finished, and
    // measured: 0 of 168 yaw x pitch samples found one. Aiming while the belt
    // is still in front of the player finds it in 12 samples. That was a probe
    // defect, not a game one, and doing it in this order removes it.
    of.hotbar(1);
    await sleep(0.4);
    const hit = await sweepFor(() => of.game().aimed.build !== null,
      [0, 355, 5, 350, 10, 345, 15, 340, 20, 330, 30, 320, 40], PITCHES);
    out.aimedBelt = { aimTried: hit.tried, aimed: of.game().aimed, chrome: chrome() };
    check(`bare-handed aim REACHED the belt just placed (fixture, ${hit.tried} samples)`,
      hit.yaw !== null,
      `no aim in ${hit.tried} of ${hit.tried} samples put game().aimed.build non-null`);
    if (hit.yaw !== null) {
      out.aimedBeltKind = out.aimedBelt.aimed.build && out.aimedBelt.aimed.build.kind;
      check('the thing aimed at IS a belt', out.aimedBeltKind === 'belt',
        `game().aimed.build.kind=${JSON.stringify(out.aimedBeltKind)}`);
      out.beltPromptDrawn = out.aimedBelt.chrome.prompt;
      check('aiming at a placed belt DRAWS a prompt naming it and its verbs',
        out.beltPromptDrawn !== null,
        `#of-prompt drawn=null; raw-only=${JSON.stringify(out.aimedBelt.chrome.promptRawOnly)}; `
        + `aimed=${JSON.stringify(out.aimedBelt.aimed && out.aimedBelt.aimed.build)}`);
    }

    // A HELD drag while walking forward: how far does one gesture get you?
    of.hotbar(4);
    await sleep(0.4);
    of.look(yaw0(), -45);
    await sleep(0.25);
    const b1 = of.game().factory.buildings;
    const feet0 = of.world().player.feet.slice();
    of.input.tape([{ hold: 300, actions: ['use', 'forward'] }, { hold: 6, keys: [] }]);
    await sleep(6.0);
    const feet1 = of.world().player.feet;
    out.heldDrag = { placed: of.game().factory.buildings - b1,
      chrome: chrome(), dragLength: of.build().longestDrag,
      dragSettles: of.build().dragSettles,
      walkedM: Math.round(Math.hypot(feet1[0] - feet0[0], feet1[1] - feet0[1],
        feet1[2] - feet0[2]) * 100) / 100,
      placements: of.build().placements, refusals: of.build().refusals,
      snaps: of.build().snaps };
    // ASSERTED: the gesture does something at all.
    check('a 300-frame held drag while walking places at least one belt',
      out.heldDrag.placed >= 1,
      `${out.heldDrag.placed} placed over ${out.heldDrag.walkedM} m walked`);
    // RECORDED, NOT ASSERTED, because it is a FINDING and not a bug this lane
    // may declare: measured 1 belt over 22.85 m walked with longestDrag 1 and
    // 0 refusals, i.e. the held drag lays a single tile and stops. Asserting a
    // number here would be asserting what the game ought to do.
    out.beltsPerMetreWalked = out.heldDrag.walkedM === 0 ? null
      : Math.round((out.heldDrag.placed / out.heldDrag.walkedM) * 1000) / 1000;
    out.runs = of.game().factory.runs;
    out.factory = { refusals: of.game().factory.refusals,
      links: of.game().factory.links };
    out.ranStage = 'belt';
  }

  if (stage === 'machine') {
    // FS-56. AN ASSEMBLER, not a smelter. The old stage opened a smelter and
    // then hunted for a recipe menu a smelter does not have and cannot have,
    // so its `panelHtmlIds: []` was a fact about the wrong machine.
    out.picked = await pickFromMenu('assembler');
    check('the build menu offers an ASSEMBLER tile (fixture)',
      out.picked.tileFound === true, `no .of-btile[data-build="assembler"] in #of-build`);
    check('the assembler tile is DRAWN in the open menu (fixture)',
      out.picked.tileDrawn !== null, `tile drawn=${JSON.stringify(out.picked.tileDrawn)}`);
    check('clicking the assembler tile puts an ASSEMBLER in hand (fixture)',
      out.picked.hotbarPart === 'assembler',
      `hotbar().part=${JSON.stringify(out.picked.hotbarPart)}, `
      + `label=${JSON.stringify(out.picked.hotbarLabel)}, holding=${JSON.stringify(out.picked.holding)}`);
    const site = await sweepFor(() => {
      const g = of.build().ghost;
      return g !== null && g.ok === true;
    });
    out.assemblerSite = site;
    check('found an aim at which the assembler is PLACEABLE (fixture)',
      site.yaw !== null,
      `no ok=true ghost in ${site.tried} of ${site.tried} yaw x pitch samples`);
    out.assemblerGhost = of.build().ghost;
    const b0 = of.game().factory.buildings;
    await press(4);
    out.afterAssembler = { chrome: chrome(),
      buildings: of.game().factory.buildings,
      delta: of.game().factory.buildings - b0 };
    check('a press on an OK assembler preview BUILT one (fixture for the panel below)',
      out.afterAssembler.delta >= 1, `${out.afterAssembler.delta} buildings added`);
    out.placementSaid = out.afterAssembler.chrome.toast;

    const opened = await aimAndOpen('assembler');
    out.aimedAssembler = opened;
    out.aimedKind = opened.aimed && opened.aimed.build && opened.aimed.build.kind;
    check('the thing the bare hand aimed at IS the assembler',
      out.aimedKind === 'assembler',
      `game().aimed.build.kind=${JSON.stringify(out.aimedKind)}`);
    const panel = document.querySelector('#of-furnace');
    out.screen = opened.screen;
    out.panelOpen = of.game().furnaceOpen;
    out.panelDrawn = drawn(panel);
    out.panelRawChars = raw(panel) === null ? null : raw(panel).length;
    check('the assembler screen is DRAWN after the interact key',
      out.panelDrawn !== null,
      `#of-furnace drawn=null; display=${panel === null ? 'no element'
        : getComputedStyle(panel).display}; rawChars=${out.panelRawChars}`);
    out.panelTitle = drawn(panel && panel.querySelector('h3'));
    check('the assembler screen names the machine it is showing',
      out.panelTitle !== null, `h3 drawn=${JSON.stringify(out.panelTitle)}`);
    const recipeButtons = [...(panel ? panel.querySelectorAll('[data-recipe]') : [])];
    out.recipeButtonCount = recipeButtons.length;
    out.recipeButtons = recipeButtons.map((e) => ({ tag: e.tagName,
      drawn: drawn(e), raw: raw(e), recipe: e.getAttribute('data-recipe'),
      title: e.getAttribute('title'), disabled: e.disabled === true }));
    check('THE RECIPE MENU EXISTS: the assembler screen offers at least one [data-recipe] control',
      out.recipeButtonCount > 0,
      `0 of ${out.recipeButtonCount} [data-recipe] controls under #of-furnace`);
    out.recipeButtonsDrawn = out.recipeButtons.filter((b) => b.drawn !== null).length;
    check(`every one of ${out.recipeButtonCount} recipe controls is DRAWN and named`,
      out.recipeButtonsDrawn === out.recipeButtonCount,
      `${out.recipeButtonsDrawn} of ${out.recipeButtonCount} drew text`);
    out.allPanelControls = panel === null ? null
      : [...panel.querySelectorAll('[data-recipe],[data-slot],button')]
        .map((e) => ({ tag: e.tagName, drawn: drawn(e),
          r: e.getAttribute('data-recipe'), s: e.getAttribute('data-slot'),
          title: e.getAttribute('title'), dis: e.disabled === true }));
    out.panelStatus = drawn(panel && panel.querySelector('.status'));
    out.panelFullDrawn = out.panelDrawn;
    out.ranStage = 'machine';
  }

  if (stage === 'chest') {
    // FS-70. A CHEST, which no earlier survey run ever placed or opened. It has
    // no recipe and no fuel, so the panel is the only way in or out of it, and
    // a chest whose panel says nothing is a box that cannot be used.
    out.picked = await pickFromMenu('chest');
    check('the build menu offers a CHEST tile (fixture)',
      out.picked.tileFound === true, 'no .of-btile[data-build="chest"] in #of-build');
    check('the chest tile is DRAWN in the open menu (fixture)',
      out.picked.tileDrawn !== null, `tile drawn=${JSON.stringify(out.picked.tileDrawn)}`);
    check('clicking the chest tile puts a CHEST in hand (fixture)',
      out.picked.hotbarPart === 'chest',
      `hotbar().part=${JSON.stringify(out.picked.hotbarPart)}, `
      + `label=${JSON.stringify(out.picked.hotbarLabel)}`);
    const site = await sweepFor(() => {
      const g = of.build().ghost;
      return g !== null && g.ok === true;
    });
    out.chestSite = site;
    check('found an aim at which the chest is PLACEABLE (fixture)',
      site.yaw !== null,
      `no ok=true ghost in ${site.tried} of ${site.tried} yaw x pitch samples`);
    const b0 = of.game().factory.buildings;
    await press(4);
    out.afterChest = { chrome: chrome(), delta: of.game().factory.buildings - b0 };
    check('a press on an OK chest preview BUILT one (fixture for the panel below)',
      out.afterChest.delta >= 1, `${out.afterChest.delta} buildings added`);

    const opened = await aimAndOpen('chest');
    out.aimedChest = opened;
    out.aimedKind = opened.aimed && opened.aimed.build && opened.aimed.build.kind;
    check('the thing the bare hand aimed at IS the chest',
      out.aimedKind === 'chest', `game().aimed.build.kind=${JSON.stringify(out.aimedKind)}`);
    const panel = document.querySelector('#of-furnace');
    out.screen = opened.screen;
    out.panelDrawn = drawn(panel);
    out.panelRawChars = raw(panel) === null ? null : raw(panel).length;
    check('the chest screen is DRAWN after the interact key',
      out.panelDrawn !== null,
      `#of-furnace drawn=null; display=${panel === null ? 'no element'
        : getComputedStyle(panel).display}; rawChars=${out.panelRawChars}`);
    out.panelTitle = drawn(panel && panel.querySelector('h3'));
    check('the chest screen names the machine it is showing',
      out.panelTitle !== null, `h3 drawn=${JSON.stringify(out.panelTitle)}`);
    const cells = [...(panel ? panel.querySelectorAll('.cell') : [])];
    out.cellCount = cells.length;
    out.cells = cells.map((c) => ({ drawn: drawn(c), cls: c.className,
      slot: c.getAttribute('data-slot'), title: c.getAttribute('title'),
      dis: c.disabled === true }));
    check('the chest screen draws at least one slot cell',
      out.cellCount > 0, `0 of ${out.cellCount} .cell under #of-furnace`);
    out.cellsDrawn = out.cells.filter((c) => c.drawn !== null).length;
    out.emptyCells = out.cells.filter((c) => c.drawn === null).map((c) => c.cls);
    out.loadable = [...(panel ? panel.querySelectorAll('[data-load]') : [])]
      .map((e) => ({ drawn: drawn(e), load: e.getAttribute('data-load'),
        title: e.getAttribute('title'), dis: e.disabled === true }));
    out.ranStage = 'chest';
  }

  if (stage === 'power') {
    // A generator, THEN A POLE (the old stage never placed one despite saying
    // it did), then the power panel.
    out.pickedGenerator = await pickFromMenu('generator');
    check('the build menu offers a BURNER GENERATOR tile (fixture)',
      out.pickedGenerator.tileFound === true,
      'no .of-btile[data-build="generator"] in #of-build');
    check('clicking it puts a GENERATOR in hand (fixture)',
      out.pickedGenerator.hotbarPart === 'generator',
      `hotbar().part=${JSON.stringify(out.pickedGenerator.hotbarPart)}`);
    const gsite = await sweepFor(() => {
      const g = of.build().ghost;
      return g !== null && g.ok === true;
    });
    out.generatorSite = gsite;
    check('found an aim at which the generator is PLACEABLE (fixture)',
      gsite.yaw !== null,
      `no ok=true ghost in ${gsite.tried} of ${gsite.tried} yaw x pitch samples`);
    const b0 = of.game().factory.buildings;
    await press(4);
    out.afterGenerator = { chrome: chrome(),
      delta: of.game().factory.buildings - b0,
      offGrid: of.game().offGridGenerators };
    check('a press on an OK generator preview BUILT one',
      out.afterGenerator.delta >= 1, `${out.afterGenerator.delta} buildings added`);
    out.generatorPlacementSaid = out.afterGenerator.chrome.toast;

    // THE POLE. This is the half the old stage skipped entirely.
    out.pickedPole = await pickFromMenu('pole');
    check('the build menu offers a POWER POLE tile (fixture)',
      out.pickedPole.tileFound === true, 'no .of-btile[data-build="pole"] in #of-build');
    check('clicking it puts a POLE in hand (fixture)',
      out.pickedPole.hotbarPart === 'pole',
      `hotbar().part=${JSON.stringify(out.pickedPole.hotbarPart)}`);
    const psite = await sweepFor(() => {
      const g = of.build().ghost;
      return g !== null && g.ok === true;
    });
    out.poleSite = psite;
    check('found an aim at which the pole is PLACEABLE (fixture)',
      psite.yaw !== null,
      `no ok=true ghost in ${psite.tried} of ${psite.tried} yaw x pitch samples`);
    const b1 = of.game().factory.buildings;
    await press(4);
    out.afterPole = { chrome: chrome(), delta: of.game().factory.buildings - b1,
      offGrid: of.game().offGridGenerators };
    check('a press on an OK pole preview BUILT one (the half the old stage skipped)',
      out.afterPole.delta >= 1, `${out.afterPole.delta} buildings added`);
    out.polePlacementSaid = out.afterPole.chrome.toast;

    // aim at the generator with an empty hand
    of.hotbar(1);
    await sleep(0.4);
    const hit = await sweepFor(() => of.game().aimed.build !== null,
      [0, 20, 340, 40, 320, 60, 300], PITCHES);
    out.aimedPower = { aimTried: hit.tried, aimed: of.game().aimed, chrome: chrome() };
    check('bare-handed aim REACHED one of the two things just built (fixture)',
      hit.yaw !== null,
      `no aim in ${hit.tried} of ${hit.tried} samples put game().aimed.build non-null`);
    out.aimedPowerPromptDrawn = out.aimedPower.chrome.prompt;

    // the power panel
    of.input.act(['power'], 4);
    await sleep(0.7);
    const p = document.querySelector('#of-power');
    check('#of-power exists in the DOM', p !== null, 'querySelector returned null');
    out.powerPanelDrawn = drawn(p);
    out.powerPanelRawChars = raw(p) === null ? null : raw(p).length;
    check('the power key DRAWS the power panel',
      out.powerPanelDrawn !== null,
      `#of-power drawn=null; display=${p === null ? 'no element'
        : getComputedStyle(p).display}; rawChars=${out.powerPanelRawChars}`);
    out.powerHeading = drawn(p && p.querySelector('h3'));
    check('the power panel draws a heading', out.powerHeading !== null,
      `h3 drawn=${JSON.stringify(out.powerHeading)}`);
    out.powerNets = [...(p ? p.querySelectorAll('.net') : [])].map((n) => ({
      drawn: drawn(n), heading: drawn(n.querySelector('h4')) }));
    out.powerNetCount = out.powerNets.length;
    out.powerNoneRow = drawn(p && p.querySelector('.none'));
    // A SECOND DEAD READ, found while fixing this stage: the old probe set
    // `out.powerModel = of.game().factory.power` and reported it. There is no
    // such key. `undefined` serialised away and the report simply had no
    // `powerModel` line, which reads exactly like a panel with nothing in it.
    // Named here rather than silently dropped, with the keys that DO exist.
    out.factoryPublishedKeys = Object.keys(of.game().factory);
    out.deadReadFactoryPower = 'power' in of.game().factory;
    check('of.game().factory.power (the OLD probe’s read) is not a published key',
      out.deadReadFactoryPower === false,
      `'power' in factory = ${out.deadReadFactoryPower}`);
    // THE Q16 READOUT, which is /core's Q16.16 fixed-point integer printed
    // verbatim on a player-facing panel (PowerPanel.ts line 150). Recorded with
    // its selector because "is that meant to be on screen" is the survey's job
    // to ask, not this probe's to answer.
    out.q16Label = drawn(p && p.querySelector('.q16 em'));
    out.q16Value = drawn(p && p.querySelector('.q16 code'));
    out.q16Selector = '#of-power .q16 code[data-power]';
    out.progress = of.game().progress;
    check('the power panel says SOMETHING about the grid: either a net or an empty-state line',
      out.powerNetCount > 0 || out.powerNoneRow !== null,
      `${out.powerNetCount} of ${out.powerNetCount} .net rows drawn and .none drawn=${JSON.stringify(out.powerNoneRow)}`);
    out.ranStage = 'power';
  }

  if (stage === 'pad') {
    // THE LAUNCH-PAD REFUSALS, which no earlier survey run reached. A pad wants
    // a foundation platform underneath it, so on bare ground the whole point of
    // the stage IS the refusal, and a run that never produces one has failed to
    // reach its subject.
    of.hotbar(10);
    await sleep(0.5);
    out.holdingPad = { label: of.hotbar().label, part: of.hotbar().part,
      chrome: chrome() };
    check('slot 10 puts a LAUNCH PAD in hand (fixture)',
      out.holdingPad.part === 'launchpad',
      `hotbar().part=${JSON.stringify(out.holdingPad.part)}, `
      + `label=${JSON.stringify(out.holdingPad.label)}`);
    const reasons = new Map();
    let samples = 0;
    let withGhost = 0;
    const y0 = yaw0();
    for (const dy of [0, 45, 90, 135, 180, 225, 270, 315]) {
      for (const p of [-70, -60, -50, -40, -30, -20, -10]) {
        of.look((y0 + dy + 360) % 360, p);
        await sleep(0.05);
        samples += 1;
        const g = of.build().padGhost;
        if (g === null) continue;
        withGhost += 1;
        const key = `${g.ok ? 'OK' : 'NO'}: ${g.reason}`;
        if (!reasons.has(key)) {
          reasons.set(key, { ok: g.ok, reason: g.reason, cells: g.cells,
            missingCells: g.missingCells, locked: g.locked,
            yaw: (y0 + dy + 360) % 360, pitch: p, seen: 0 });
        }
        reasons.get(key).seen += 1;
      }
    }
    out.padSamples = samples;
    out.padWithGhost = withGhost;
    out.padVerdicts = [...reasons.values()];
    check(`a launch pad in hand produces a PAD PREVIEW (${withGhost} of ${samples} aims)`,
      withGhost > 0, `0 of ${samples} aims produced build().padGhost`);
    const refusal = out.padVerdicts.find((v) => v.ok === false && v.reason !== '');
    out.padRefusal = refusal ?? null;
    check('the launch pad REFUSES somewhere and names its reason',
      refusal !== undefined,
      `${out.padVerdicts.length} distinct verdicts, none with ok=false and a reason: `
      + JSON.stringify(out.padVerdicts.map((v) => `${v.ok}/${v.reason}`)));
    if (refusal !== undefined) {
      of.look(refusal.yaw, refusal.pitch);
      await sleep(0.3);
      const p0 = of.game().structures.parts.length;
      out.beforePadPress = { padGhost: of.build().padGhost, chrome: chrome() };
      await press(4);
      out.padPress = { chrome: chrome(),
        delta: of.game().structures.parts.length - p0,
        padGhost: of.build().padGhost };
      check('pressing into the launch-pad refusal builds nothing',
        out.padPress.delta === 0, `${out.padPress.delta} parts placed`);
      out.padRefusalDrawn = out.padPress.chrome.toast;
      check('the launch-pad refusal is SAID OUT LOUD where the player can read it',
        out.padRefusalDrawn !== null,
        `#of-toast drawn=null; model reason=${JSON.stringify(refusal.reason)}; `
        + `raw-only=${JSON.stringify(out.padPress.chrome.toastRawOnly)}`);
    }
    out.padViewStats = of.padView();
    out.ranStage = 'pad';
  }

  out.endChrome = chrome();
  out.counts = { structures: of.game().structures.parts.length,
    factory: of.game().factory.buildings,
    machines: of.game().machines.length };
  // A STAGE THAT REPORTS NOTHING MAY NOT HAVE RUN. `ranStage` is set by the
  // stage body's last line and nowhere else.
  check(`the '${stage}' stage body ran to its end`, out.ranStage === stage,
    `out.ranStage=${JSON.stringify(out.ranStage)}`);
  return finish(out);
})()
