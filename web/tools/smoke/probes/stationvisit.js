// GP-236. THE STATION BUTTON, driven the way a player drives it.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5299/ --scenario=walk \
//     --sandbox=1 --evalfile=tools/smoke/probes/stationvisit.js
//
// `probes/stationwalk.js` proved the PLACE: a col_* proxy 400 km up holds the
// walker, the deck is where the conic says, and the doorway is open. It got
// there with `__of.standAt`, which is a debug door. This proves the DOOR A
// PLAYER HAS: one real <button> in the game menu.
//
// WHAT ARRIVAL MEANS HERE IS NOT WHAT IT MEANS FOR A GROUND SITE, and the
// difference is the whole point. A site row can be checked against a latitude,
// because the heightfield will catch anybody who is roughly in the right place.
// 400 km up there is nothing to catch you: the only floor is a 12 m room, and a
// press that put the feet one metre to the side of it would report success and
// drop the player 400 km. So the assertion is GROUNDED and ON DECK after real
// fixed ticks, never "the position changed", and it is checked again 1.5 s
// later because "landed once" and "is standing" are different claims (GP-53).
//
// THE RECEIPT CANNOT ANSWER THIS AND DOES NOT TRY. `Controller.standAt` leaves
// `grounded` FALSE on purpose ("whether there is a floor here is exactly what
// the caller is asking"), so footing is a fact one tick after the press. The
// receipt claims the position and this file claims the footing.
//
// CE-41 (2026-08-11): THE PRESS NOW GOES THROUGH A DIFFERENT DOOR, AND EVERY
// NUMBER BELOW IS UNCHANGED WHILE ANCHORAGE IS FROZEN. `pressStation` boards the
// station's carrier frame and seats the player AT REST IN IT (`rideStation` ->
// `seatOnStationDeck`) rather than calling `Controller.standAt` alone, which
// zeroes the absolute velocity and on a moving station is a player left behind
// at 31.32 m per tick. On the station as it ships (`stampedTick = -1`, conic
// frozen) the frame's velocity at the hub is exactly zero and the destination is
// bitwise the install's own `pos`, so this file's arrival assertions are the
// SAME assertions about the SAME numbers. `probes/stationboard.js` is the one
// that measures the difference, on a moving fixture. The day Anchorage is
// unfrozen, the check that will need re-reading here is `grounded` after the
// press, because the deck will be travelling under the feet while it lands.
//
// IT ENDS ON THE GROUND, deliberately, and phase D is both halves of that: the
// return trip is a FEATURE (a one-way trip to orbit is a trap) and it is also
// what lets run.mjs finish, since the runner settles on terrain convergence and
// a walker parked 400 km up with the streamer chasing him never converges.
//
// OF_ARGS:
//   { "off": true }      the ?station=0 run: assert the graceful refusal only.
//   { "aboard": false }  skip the flight half (it builds and flies a rocket).
//   { "png": false }     skip the capture.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const sleep = (n) => of.run(n);
  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });
  const fails = [];
  const log = [];
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const ROW = 'visit:station';

  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  /** cheats.js's press helper, verbatim. RE-QUERIED across the hold because
   *  PauseMenu.render replaces the body wholesale (GP-155 / GP-156), and it
   *  returns whether the press LANDED rather than whether the element existed. */
  const press = async (id) => {
    const sel = `#of-pause button[data-cheat="${id}"]`;
    const down = document.querySelector(sel);
    if (down === null) return false;
    down.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(0.11);
    const el = document.querySelector(sel);
    if (el === null) return false;
    el.click();
    await sleep(0.35);
    return true;
  };
  const rowOf = () => of.pause().buttons.find((b) => b.id === ROW) ?? null;
  const feet = () => of.world().player.feet.slice();
  const moved = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

  await sleep(0.8);
  if (of.world().player === null) return { valid: false, why: 'no character' };
  if (typeof of.station !== 'function') return { valid: false, why: 'no __of.station' };
  of.setTime(A.timeOfDay ?? 0.35);
  // The build ghost covers the whole viewport when a slot is armed, so every
  // capture in this suite disarms first.
  of.build(0);

  // ======================================================================
  // OFF. `?station=0`: the row is THERE, it is BLOCKED, and it says why.
  //      A world with no station must refuse, not teleport into empty space.
  // ======================================================================
  if (A.off === true) {
    of.pause(true);
    await sleep(0.4);
    const row = rowOf();
    check('the station row is still drawn with the station off', row !== null,
      JSON.stringify(of.pause().buttons.map((b) => b.id)));
    check('and its button is DISABLED', row?.disabled === true, JSON.stringify(row));
    check('and it names the flag that did it',
      (row?.blocked ?? '').includes('?station=0'), row?.blocked ?? '(none)');
    const f0 = feet();
    const rec = of.cheat(ROW).log.pop();
    check('the verb refuses', rec.done === false
      && rec.message.startsWith('refused') && rec.message.includes('?station=0'),
      JSON.stringify(rec));
    await sleep(0.5);
    check('and the walker did not move a millimetre', moved(f0, feet()) < 0.001,
      `${moved(f0, feet()).toFixed(6)} m`);
    check('and no interior was ever installed to have stood on',
      (of.station()?.install ?? null) === null, JSON.stringify(of.station()));
    of.pause(false);
    return { valid: fails.length === 0, fails, mode: 'station=0',
      blocked: rowOf()?.blocked ?? '', refusal: of.cheat().log.pop()?.message ?? '' };
  }

  const st = of.station();
  if (st === null) return { valid: false, why: 'no station record: run without ?station=0' };
  if (st.install === null) return { valid: false, why: 'the station was never installed' };
  const P = st.install.pos;
  const deckR = st.install.deckR;

  // ======================================================================
  // A. THE ROW IS ON SCREEN, ENABLED, AND SAYS WHAT THE PLACE IS.
  //    The numbers are asserted against the WORLD's own, not against prose:
  //    the row must carry this station's altitude and this planet's gravity
  //    ratio, so a row that hardcoded "400 km" survives a moved orbit and this
  //    check does not.
  // ======================================================================
  of.pause(true);
  await sleep(0.4);
  const view = of.pause().view;
  check('the view carries a station group', Array.isArray(view.station)
    && view.station.length === 1, JSON.stringify(view.station ?? null));
  const row0 = rowOf();
  check('the button is drawn and enabled', row0 !== null && row0.disabled === false,
    JSON.stringify(row0));
  check('the group is SEPARATE from the seven visit sites',
    view.visits.length === 7 && !view.visits.some((v) => v.id === ROW),
    view.visits.map((v) => v.id).join(','));
  const note = view.station[0]?.note ?? '';
  const kmSaid = `${(st.install.altM / 1000).toFixed(0)} km`;
  check('the row states THIS station\'s altitude', note.includes(kmSaid),
    `${kmSaid} not in "${note}"`);
  check('and says the orbit is circular', note.includes('circular'), note);
  // THE GRAVITY CLAIM, ASSERTED AND NOT JUST MATCHED. The row reads its two
  // gravities off `PlanetBody`; this derives the ratio independently as
  // (R / r)^2, which is what an inverse-square field means, off two radii the
  // probe reads from the game. So a row that printed a plausible-looking
  // percentage from the wrong radius goes red here.
  const R = of.world().bodyRadiusM;
  const wantPct = Math.round((100 * R * R) / (deckR * deckR));
  const wantJump = ((deckR * deckR) / (R * R)).toFixed(1);
  const pct = /(\d+)% of the/.exec(note);
  check('the row states the gravity as a share of the surface', pct !== null, note);
  check('and that share is the inverse-square one',
    pct !== null && Math.abs(Number(pct[1]) - wantPct) <= 1,
    `row says ${pct?.[1]}%, (R/r)^2 is ${wantPct}%`);
  check('and the jump multiplier is its reciprocal',
    note.includes(`${wantJump} times as high`), `expected ${wantJump}x in "${note}"`);
  check('the row carries a real line, not a name', note.length > 60,
    `${note.length} chars`);
  log.push(`row note: ${note}`);

  // ======================================================================
  // B. ONE REAL PRESS, AND THE PLAYER IS STANDING ON THE DECK.
  // ======================================================================
  const before = feet();
  check('the real button takes the press', await press(ROW));
  check('the menu CLOSED on arrival (GP-168)', of.pause().open === false);
  const rec = of.cheat().log.filter((r) => r.id === ROW).pop();
  check('the receipt is done and names the station',
    rec !== undefined && rec.done === true && rec.detail?.site === 'station',
    JSON.stringify(rec));
  // THE RECEIPT MAY NOT CLAIM FOOTING. It is written before a tick has run, so
  // a `grounded` field on it could only ever be a guess.
  check('and the receipt does NOT claim the player is grounded',
    rec !== undefined && rec.detail?.grounded === undefined,
    JSON.stringify(rec?.detail ?? null));

  // Real fixed ticks, then the two facts that matter.
  await sleep(1.0);
  await yield0();
  const w = of.world();
  const fr = Math.hypot(...w.player.feet);
  const arrived = {
    travelledM: r6(moved(before, w.player.feet)),
    feetR: r6(fr),
    deckR: r6(deckR),
    feetMinusDeckM: r6(fr - deckR),
    // How far from the hub CENTRE, ACROSS the deck. The room is 12 m square, so
    // anything over 6 m here is not the room the button promised. It is the
    // component of (feet - pos) perpendicular to the radial, taken as a
    // projection and NOT as sqrt(dist^2 - dr^2): the Pythagorean form reads a
    // convincing 0.000 for a player 395 km below the station, which the nobbled
    // run measured, so it would have passed on exactly the failure it exists
    // to catch.
    offCentreM: r6((() => {
      const d = [w.player.feet[0] - P[0], w.player.feet[1] - P[1],
        w.player.feet[2] - P[2]];
      const u = [P[0] / deckR, P[1] / deckR, P[2] / deckR];
      const k = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
      return Math.hypot(d[0] - u[0] * k, d[1] - u[1] * k, d[2] - u[2] * k);
    })()),
    grounded: w.player.grounded,
    onDeck: w.player.onDeck,
    altM: r6(deckR - w.bodyRadiusM),
  };
  log.push(`arrival: ${JSON.stringify(arrived)}`);
  check('the player is GROUNDED after the press', arrived.grounded === true,
    JSON.stringify(arrived));
  check('and it is the STATION DECK holding him up, not terrain',
    arrived.onDeck === true, JSON.stringify(arrived));
  check('the feet are on the deck\'s own top face',
    Math.abs(arrived.feetMinusDeckM) < 1e-4, `${arrived.feetMinusDeckM} m`);
  check('and in the hub, not beside it', arrived.offCentreM < 6,
    `${arrived.offCentreM} m from the hub centre`);
  check('the trip was a real 400 km one', arrived.travelledM > 100000,
    `${arrived.travelledM} m`);

  // STANDING, NOT LANDING (GP-53's family). 1.5 s of nothing at all.
  await sleep(1.5);
  await yield0();
  const w2 = of.world();
  const fr2 = Math.hypot(...w2.player.feet);
  const stood = { driftM: r6(fr2 - fr), grounded: w2.player.grounded,
    onDeck: w2.player.onDeck };
  log.push(`stood 1.5 s: ${JSON.stringify(stood)}`);
  check('still standing on the deck 1.5 s later',
    stood.grounded === true && stood.onDeck === true
      && Math.abs(stood.driftM) < 0.01, JSON.stringify(stood));

  // ======================================================================
  // C. THE PICTURE, from inside, looking down the corridor. The heading is
  //    read off the STATION's own published axes and never rebuilt here
  //    (standing rule 11): a probe that recomputed the rotation would agree
  //    with itself whatever the station did, which is how the first
  //    orbitdeck.js passed with the corridor upside down.
  // ======================================================================
  let png;
  if (A.png !== false) {
    const u = [P[0] / deckR, P[1] / deckR, P[2] / deckR];
    const east = (() => {
      const e = [u[2], 0, -u[0]];
      const l = Math.hypot(e[0], e[1], e[2]);
      return l < 1e-9 ? [1, 0, 0] : [e[0] / l, e[1] / l, e[2] / l];
    })();
    const north = [u[1] * east[2] - u[2] * east[1], u[2] * east[0] - u[0] * east[2],
      u[0] * east[1] - u[1] * east[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const along = st.axes.along;
    of.look((Math.atan2(dot(along, east), dot(along, north)) * 180) / Math.PI,
      A.pitch ?? -6);
    await sleep(0.5);
    of.framehash(100, 56);
    png = document.getElementById('of-canvas').toDataURL('image/png');
  }

  // ======================================================================
  // D. THE WAY BACK, and it is a requirement rather than a courtesy: a
  //    one-way trip to orbit is a trap. The seven ground rows are right there
  //    in the same menu, so the claim is that they still WORK from up here,
  //    which is a different claim from their existing.
  // ======================================================================
  of.pause(true);
  await sleep(0.4);
  const backRow = of.pause().buttons.find((b) => b.id === 'visit:beach') ?? null;
  check('from the station, the ground rows are still enabled',
    backRow !== null && backRow.disabled === false, JSON.stringify(backRow));
  check('the return button takes the press', await press('visit:beach'));
  check('the menu closed on the way back', of.pause().open === false);
  let streamSecs = 0;
  for (let i = 0; i < 60; ++i) {
    const wv = of.world();
    if (wv.chunks.converged && wv.player.grounded
        && of.meshVerts(wv.player.feet[0], wv.player.feet[1],
          wv.player.feet[2], 30).length > 8) break;
    await sleep(0.5);
    streamSecs += 0.5;
  }
  const wb = of.world();
  const back = {
    streamSecs,
    latDeg: +wb.observer.latDeg.toFixed(4), lonDeg: +wb.observer.lonDeg.toFixed(4),
    groundM: +wb.surfaceHeightM.toFixed(1),
    grounded: wb.player.grounded, onDeck: wb.player.onDeck, biome: wb.biome,
  };
  log.push(`return: ${JSON.stringify(back)}`);
  check('back on the ground at the beach site (survey 12.2 m)',
    back.grounded === true && Math.abs(back.groundM - 12.2) < 25
      && Math.abs(back.latDeg - -35.6028) < 0.01, JSON.stringify(back));
  check('and the deck is no longer what is holding him up',
    back.onDeck === false, JSON.stringify(back));

  // ======================================================================
  // E. ABOARD A VESSEL THE ROW REFUSES, same hazard and same sentence as the
  //    ground rows. `standAt` would move the WALKER while the eye stayed on
  //    the rocket, so the press would report success and the player would see
  //    nothing happen, which is the exact lie the site guard exists for.
  // ======================================================================
  let aboard = { ran: false };
  if (A.aboard !== false && typeof of.vab === 'function'
      && typeof of.flight === 'function') {
    const parts = await buildRocket();
    of.vab('leave');
    await sleep(0.4);
    of.flight('rollout');
    await sleep(0.8);
    for (let i = 0; i < 16 && of.flight('report').distanceToVesselM > 10; ++i) {
      of.input.act(['forward'], 30);
      await sleep(0.6);
    }
    of.flight('board');
    await sleep(0.5);
    aboard = { ran: true, parts, aboard: of.flight('report').aboard };
    check('the probe got a rocket built, rolled out and boarded',
      aboard.aboard === true, JSON.stringify(of.flight('report').message));
    if (aboard.aboard === true) {
      of.pause(true);
      await sleep(0.4);
      const row = rowOf();
      check('aboard, the station row is DISABLED', row?.disabled === true,
        JSON.stringify(row));
      check('and says why with the keys that fix it',
        (row?.blocked ?? '').includes('aboard')
        && (row?.blocked ?? '').includes('disembark'), row?.blocked ?? '(none)');
      const f0 = feet();
      const ref = of.cheat(ROW).log.pop();
      check('the verb refuses aboard', ref.done === false
        && ref.message.startsWith('refused'), JSON.stringify(ref));
      await sleep(0.5);
      check('and the walker did not move a millimetre', moved(f0, feet()) < 0.001,
        `${moved(f0, feet()).toFixed(6)} m`);
      aboard.refusal = ref.message;
      of.pause(false);
    }
  }

  return { valid: fails.length === 0, fails, log, arrived, stood, back, aboard,
    station: { name: st.name, id: st.id, altM: r6(st.install.altM),
      deckR: r6(deckR), proxies: st.proxies, minted: st.install.minted },
    note, png };

  /** visitsite.js's minimal rocket, verbatim: pod, tank, engine at the bay's
   *  own published sockets. The bay itself is proven in probes/rollout.js. */
  async function buildRocket() {
    const PID = [0x0100, 0x0101, 0x0103];
    of.vab('enter');
    await sleep(0.4);
    const cat = of.vab('catalogue');
    of.vab('press', 'clear');
    await sleep(0.15);
    for (const pid of PID) {
      const i = cat.find((c) => c.id === pid)?.index ?? -1;
      if (i < 0) continue;
      of.vab('frame');
      of.vab('take', i);
      await sleep(0.12);
      const parts = of.vab('report').parts;
      if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
      let low = parts[0];
      for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
      const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
        && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
      if (nodes.length === 0) continue;
      of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
      of.vab('place');
      await sleep(0.12);
    }
    return of.vab('report').parts.length;
  }
})()
