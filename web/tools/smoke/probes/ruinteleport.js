// ruinteleport.js: TELEPORT TO RUIN (GP-1060 to GP-1064), driven the way a
// player drives it (standing rule 3), the same shape `probes/visitsite.js`
// and `probes/cheats.js`'s own orbit section already use.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:PORT/ --scenario=walk \
//     --sandbox=1 --combat=1 --evalfile=tools/smoke/probes/ruinteleport.js
//
// `--combat=1` is REQUIRED and not optional here: `RuinSites.garrison` only
// posts creatures when `Enemies.enabled` is true (DW-31/GP-82's sandbox-safe
// rule, checked inside `spawnGarrison`), so without it there is no garrison
// to prove the arrival clears. Without `--combat=1` the probe still exercises
// the press, the receipt and the landing geometry, but skips section C.
//
// WHAT ARRIVAL MEANS, the same three claims `visitsite.js` proves for the
// seven survey sites: the receipt is TERMINAL and names the ruin
// (idLo/idHi/ordinal) and the destination (latDeg/lonDeg), the walker is
// GROUNDED on real streamed geometry (not falling, not embedded: `grounded
// === true`, `underRock === false`, `blockedByRock === false`), and it STAYS
// that way 1.5 s later (the GP-53 sinking family).
//
// THE STANDOFF ORACLE IS THIS FILE'S OWN COPY of EnemyGarrison.ts's two
// published constants (AGGRO_RADIUS_M=30, GARRISON_SCATTER_M=8), for the same
// reason `visitsite.js` keeps its own copy of the survey table: a number
// mistyped in `VisitRuin.ts` cannot certify itself against a re-derivation of
// the identical arithmetic in the same file.
//
// THE MENU DOES NOT AUTO-CLOSE ON THIS PRESS, DELIBERATELY: `ruin`'s id is
// NOT `visit:`-prefixed (see `VisitRuin.ts`'s header on `RUIN_ROW_ID`), so it
// takes the SAME shape as `orbit` -- `cheats.js`'s own orbit section closes
// the menu itself after pressing, and this probe does too.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const combat = location.search.includes('combat=1');

  // EnemyGarrison.ts's own two constants, copied rather than imported (this
  // runs inside the page, off the built client, with no module graph of its
  // own). The worst-case clearance a landing spot needs is their SUM: a
  // garrison creature can spawn up to GARRISON_SCATTER_M off the post in any
  // direction, so the closest it can ever be to a player standing
  // `standoffM` from the post is `standoffM - GARRISON_SCATTER_M`, and that
  // has to clear AGGRO_RADIUS_M.
  const AGGRO_RADIUS_M = 30;
  const GARRISON_SCATTER_M = 8;
  const AGGRO_CLEAR_M = AGGRO_RADIUS_M + GARRISON_SCATTER_M;

  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  /** cheats.js's press helper, verbatim. */
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
  const openMenu = async () => { of.pause(true); await sleep(0.35); };

  await sleep(0.8);
  if (of.world().player === null) return { valid: false, why: 'no character' };

  // ======================================================================
  // A. THE WORLD HAS A RUIN, AND THE ROW IS ON SCREEN, UNBLOCKED
  // ======================================================================
  const ruins0 = of.ruins();
  check('this scenario placed at least one ruin (spawn-adjacent, WG-166/211)',
    ruins0.count > 0, JSON.stringify({ count: ruins0.count, why: ruins0.why }));
  if (ruins0.count === 0) {
    return { valid: fails.length === 0, fails, log, combat, ruins0 };
  }
  const ruin = ruins0.list[0];
  log.push(`ruin id ${ruin.idLo}:${ruin.idHi}:${ruin.ordinal}, footprint `
    + `${ruin.footprintM.toFixed(1)} m, garrison ${ruin.garrison}`);

  await openMenu();
  const row = of.pause().buttons.find((b) => b.id === 'ruin');
  check('the row is drawn', row !== undefined, JSON.stringify(of.pause().buttons.map((b) => b.id)));
  check('and it is not blocked (on foot, a ruin exists)',
    row !== undefined && row.disabled === false, JSON.stringify(row));

  // ======================================================================
  // B. THE PRESS: A REAL RECEIPT NAMING THE RUIN AND THE DESTINATION
  // ======================================================================
  const feetBefore = of.world().player.feet.slice();
  check('pressing Teleport to ruin works', await press('ruin'));
  const rec = of.cheat().log.filter((r) => r.id === 'ruin').pop();
  check('the receipt is terminal, done, and names the resolved ruin',
    rec !== undefined && rec.done === true
    && rec.detail?.idLo === ruin.idLo && rec.detail?.idHi === ruin.idHi
    && rec.detail?.ordinal === ruin.ordinal,
    JSON.stringify(rec));
  check('and it states the destination coordinates',
    rec !== undefined && typeof rec.detail?.latDeg === 'number'
    && typeof rec.detail?.lonDeg === 'number', JSON.stringify(rec?.detail));
  const standoffM = rec?.detail?.standoffM ?? 0;
  check('the standoff clears BOTH the footprint and the garrison acquire radius',
    standoffM > ruin.footprintM && standoffM > AGGRO_CLEAR_M,
    `standoff ${standoffM} m vs footprint ${ruin.footprintM} m, `
    + `aggro-clear ${AGGRO_CLEAR_M} m`);
  of.pause(false);   // NOT auto-closed: 'ruin' is not `visit:`-prefixed.
  await sleep(0.3);

  // ======================================================================
  // C. THE ARRIVAL: GROUNDED, NOT EMBEDDED, AND CLEAR OF THE GARRISON
  // ======================================================================
  let streamSecs = 0;
  for (let i = 0; i < 60; ++i) {
    const wv = of.world();
    if (wv.chunks.converged && wv.player.grounded
        && of.meshVerts(wv.player.feet[0], wv.player.feet[1],
          wv.player.feet[2], 30).length > 8) break;
    await sleep(0.5);
    streamSecs += 0.5;
  }
  const w = of.world();
  const feet = w.player.feet;
  const moved = Math.hypot(feet[0] - feetBefore[0], feet[1] - feetBefore[1],
    feet[2] - feetBefore[2]);
  check('the walker actually moved', moved > 10, `${moved.toFixed(1)} m`);
  check('GROUNDED on streamed geometry, not falling', w.player.grounded === true,
    `grounded=${w.player.grounded} after ${streamSecs}s`);
  check('and not embedded in a rock or a wall',
    w.player.underRock === false && w.player.blockedByRock === false,
    `underRock=${w.player.underRock} blockedByRock=${w.player.blockedByRock}`);

  const distM = Math.hypot(feet[0] - ruin.sitePos[0], feet[1] - ruin.sitePos[1],
    feet[2] - ruin.sitePos[2]);
  check('landed OUTSIDE the ruin footprint',
    distM > ruin.footprintM, `${distM.toFixed(1)} m from the site, footprint ${ruin.footprintM} m`);
  // A GENEROUS band around the intended standoff: real terrain a few dozen
  // metres from the site is not guaranteed to sit at the same designed grade
  // as the footprint itself (WG-201's own plane-fit is only certified over
  // the footprint disc), so the assertion is "landed near the intended ring",
  // not "landed on a mathematically exact sphere".
  check('and close to the INTENDED standoff, not somewhere else entirely',
    Math.abs(distM - standoffM) < Math.max(15, standoffM * 0.35),
    `${distM.toFixed(1)} m actual vs ${standoffM.toFixed(1)} m intended`);

  // STILL STANDING 1.5 s later (the GP-53 sinking family: "grounded once" and
  // "stays on the ground" are different claims).
  const r0 = Math.hypot(...feet);
  await sleep(1.5);
  const w2 = of.world();
  const r1 = Math.hypot(...w2.player.feet);
  check('still standing 1.5 s later, not sinking',
    w2.player.grounded === true && Math.abs(r1 - r0) < 0.05,
    `dr ${(r1 - r0).toFixed(4)} m, grounded=${w2.player.grounded}`);

  let garrison = { ran: false };
  if (combat && ruin.garrison > 0) {
    // NOT INSTANTLY AGGROED ON MATERIALISE: every live creature whose post is
    // this ruin's is still `hold`, and none is within AGGRO_RADIUS_M of the
    // feet the moment the stream settles.
    const near = of.enemies('near', 20) ?? [];
    const guards = near.filter((c) => c.provenance === 'garrison');
    const engaged = guards.filter((c) => c.garrisonState === 'engage');
    const closestM = guards.length > 0 ? Math.min(...guards.map((c) => c.distM)) : Infinity;
    garrison = { count: guards.length, engaged: engaged.length, closestM,
      states: guards.map((c) => c.garrisonState) };
    check('the ruin actually has live guards to prove the clearance against',
      guards.length > 0, JSON.stringify(near.map((c) => c.provenance)));
    check('none of them aggroed on arrival',
      engaged.length === 0, JSON.stringify(garrison.states));
    check('and the closest one is still outside the acquire radius',
      closestM > AGGRO_RADIUS_M, `${closestM === Infinity ? 'n/a' : closestM.toFixed(1)} m`);
  }

  return {
    valid: fails.length === 0, fails, log, combat,
    ruin: { idLo: ruin.idLo, idHi: ruin.idHi, ordinal: ruin.ordinal,
      footprintM: ruin.footprintM, garrison: ruin.garrison },
    receipt: rec, standoffM, distM: +distM.toFixed(2), streamSecs,
    driftM: +(r1 - r0).toFixed(4), garrisonCheck: garrison,
  };
})()
