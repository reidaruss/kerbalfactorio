// flightthread.js: GP-350. THE GOAL CHAIN CONTINUES PAST THE LAUNCH PAD.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/flightthread.js
//
// The checklist ended at `Roll it out and climb aboard`. A player who did
// everything the game asked of them was handed a rocket and no next sentence,
// while an orbit, a map, a station, a moon and a working autopilot sat behind
// three keys nothing on screen named in order.
//
// WHAT THIS HAS TO PROVE, AND THE ORDER MATTERS.
//
//  0. THE ANTECEDENT FIRST. A null `VoyagePort` makes all three rows report
//     DONE on purpose, because `?flight=0` must not park the list for ever. So
//     a build where the wiring was simply dropped looks IDENTICAL on screen to
//     one where the player has finished, and every check below would pass
//     about a chain that does not exist. `goals.voyage` is asserted before
//     anything else (INSTRUMENTS.md: an implication with a false antecedent is
//     vacuously true, and here the antecedent is "there is a map at all").
//
//  1. THE DEFAULT, which is the one nobody writes. GP-301 shipped because every
//     autopilot fixture moved the altitude before arming, so the value a player
//     meets first was never tested. Here the three new rows are asserted FALSE
//     at spawn, before any act, because "false at spawn and true after the act"
//     is the whole claim and a row that were true from the start would satisfy
//     the second half of it on its own.
//
//  2. EACH ROW AGAINST ITS OWN ACT, with the state immediately before the act
//     asserted too. Boarding a rocket on the pad must NOT satisfy `orbit`: that
//     is the discriminating case, because a row keyed on "am I in a vessel"
//     rather than on the orbit would pass every other check here.
//
//  3. THE PANEL IS ON SCREEN IN THE COCKPIT. Three composition roots hide the
//     checklist with the walker's HUD, and strapping in is HOW you reach the
//     row that says "fly it to orbit", so the list used to go dark on the same
//     frame its current item became possible. Read off the element's own
//     computed style, never off the model, because a panel that thinks it is
//     visible and a panel that is drawn are different claims (GP-151).
//
// `satisfied` is the live predicate per row and is NOT `rows[i].done`, which is
// a POSITION in the walk. The distinction is what lets this fixture test row
// eleven without first driving the ten ground rows in front of it, and driving
// those would put this probe's verdict at the mercy of the factory lane's live
// files, which is exactly how `power.js` rotted tonight.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const fails = [];
  const log = {};
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);
  const FM = () => of.flight('report');
  const F = () => of.flight('report').flight;
  const GOALS = () => of.goals();
  /** One row's LIVE predicate, by id. Throws rather than returning undefined:
   *  `undefined === false` is false and `!undefined` is true, so a renamed row
   *  would quietly flip every claim below. */
  const sat = (id) => {
    const rows = GOALS().satisfied;
    const r = (rows ?? []).find((x) => x.id === id);
    if (r === undefined) {
      throw new Error(`probe: no objective '${id}'. Rows: `
        + `${(rows ?? []).map((x) => x.id).join(', ')}`);
    }
    return r.satisfied === true;
  };
  const panel = () => {
    const el = document.getElementById('of-goals');
    if (el === null) return { present: false, display: '', pinned: false };
    const cs = getComputedStyle(el);
    return { present: true, display: cs.display, side: cs.left,
             pinned: el.classList.contains('pinned'),
             text: el.innerText.replace(/\s+/g, ' ').trim() };
  };

  await sleep(1.0);

  // --- 0. the antecedent ----------------------------------------------------
  const g0 = GOALS();
  log.ids = g0.ids;
  check('the flight port is wired (else three rows report DONE and every '
        + 'check below is vacuous)', g0.voyage === true, `voyage ${g0.voyage}`);
  if (g0.voyage !== true) return { valid: false, why: 'no VoyagePort', fails };

  // --- 1. the chain, read as an ORDER and never as a count ------------------
  const ids = g0.ids ?? [];
  const iLaunch = ids.indexOf('launch');
  check('the list still ends the ground half at `launch`', iLaunch >= 0,
        ids.join(','));
  check('and three rows follow it, in order',
        ids[iLaunch + 1] === 'orbit' && ids[iLaunch + 2] === 'map'
        && ids[iLaunch + 3] === 'where',
        `after launch: ${ids.slice(iLaunch + 1).join(',') || '(nothing)'}`);

  // --- 1b. every key in the new hints is DERIVED ----------------------------
  // This project has put a wrong key on screen four times that anyone counted
  // (GP-165's five, the mute hint, the map hint, GP-140's two prettifiers). A
  // raw `KeyM` in a hint is the signature, and it is greppable.
  const hints = Object.fromEntries((g0.hints ?? []).map((h) => [h.id, h.hint]));
  log.hints = { orbit: hints.orbit, map: hints.map, where: hints.where };
  for (const id of ['orbit', 'map', 'where']) {
    const h = hints[id] ?? '';
    check(`the ${id} hint exists`, h.length > 0, JSON.stringify(h));
    check(`the ${id} hint names no raw key code`,
          !/Key[A-Z]\b|Digit[0-9]|Shift(Left|Right)|Mouse[0-9]/.test(h), h);
  }

  // --- 2. THE DEFAULT: none of the three is satisfied at spawn --------------
  const d0 = { orbit: sat('orbit'), map: sat('map'), where: sat('where') };
  log.atSpawn = d0;
  check('at spawn: not in orbit', d0.orbit === false);
  check('at spawn: the map has never been opened', d0.map === false);
  check('at spawn: no destination is picked', d0.where === false);
  const p0 = panel();
  log.panelOnFoot = p0;
  check('on foot the checklist is drawn and is NOT pinned',
        p0.present && p0.display !== 'none' && p0.pinned === false,
        JSON.stringify(p0));

  // --- build a rocket and get on it ----------------------------------------
  of.build(0);
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of [0x0100, 0x0101, 0x0103]) {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
    let low = parts[0];
    for (const q of parts) if (q.origin[1] < low.origin[1]) low = q;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) continue;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.12);
  }
  of.vab('leave');
  await sleep(0.4);
  of.flight('rollout');
  await sleep(0.8);
  for (let i = 0; i < 16 && FM().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.flight('board');
  await sleep(1.0);

  // --- 3. aboard on the PAD: the discriminating case ------------------------
  check('fixture: aboard', FM().aboard === true);
  check('fixture: still clamped on the pad', F().status === 'CLAMPED',
        F().status);
  const onPad = sat('orbit');
  log.aboardOnPad = { orbit: onPad, status: F().status };
  check('boarding is NOT orbit (a row keyed on "am I in a vessel" would pass '
        + 'every other check in this file)', onPad === false);

  // --- 3b. and the checklist is ON SCREEN in the cockpit --------------------
  const p1 = panel();
  log.panelAboard = p1;
  check('strapped in, the checklist is still drawn',
        p1.present && p1.display !== 'none', JSON.stringify(p1));
  check('and it says so: it is PINNED rather than merely left visible',
        p1.pinned === true, JSON.stringify(p1));
  check('the pinned list still carries its rows', (p1.text ?? '').length > 0);

  // --- 4. orbit ------------------------------------------------------------
  of.pause(true);
  await sleep(0.35);
  document.querySelector('#of-pause button[data-cheat="orbit"]')?.click();
  await sleep(1.5);
  of.pause(false);
  await sleep(1.2);
  of.input.act(['stage'], 4);
  await sleep(0.6);
  of.input.act(['throttleCut'], 4);
  await sleep(1.0);
  check('fixture: the teleport really put the craft in orbit',
        F().status === 'ORBIT', `status ${F().status}`);
  const inOrbit = { orbit: sat('orbit'), map: sat('map'), where: sat('where') };
  log.inOrbit = inOrbit;
  check('in orbit the `orbit` row is satisfied', inOrbit.orbit === true);
  check('and the two after it are still NOT', inOrbit.map === false
        && inOrbit.where === false, JSON.stringify(inOrbit));

  // --- 5. the map -----------------------------------------------------------
  const mapCode = (of.input.bindings().map || [])[0];
  window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  await sleep(1.2);
  check('fixture: the map is open', of.map('report').open === true);
  const afterMap = { map: sat('map'), where: sat('where') };
  log.afterMap = afterMap;
  check('opening the map satisfies the `map` row', afterMap.map === true);
  check('and picking nothing leaves `where` unsatisfied',
        afterMap.where === false);

  // --- 6. a destination -----------------------------------------------------
  const rowIds = of.map('report').planner.rowIds ?? [];
  const pick = rowIds.find((x) => x.startsWith('b:')) ?? rowIds[0];
  log.pickedRow = pick;
  const el = document.querySelector(`#of-map [data-plan="${pick}"]`);
  check('there is a destination row to click', el !== null, `rows ${rowIds}`);
  el?.click();
  await sleep(1.0);
  check('fixture: the planner selected it',
        of.map('report').planner.selectedId === pick,
        of.map('report').planner.selectedId);
  const afterPick = sat('where');
  log.afterPick = { where: afterPick,
                    selected: of.map('report').planner.selectedId };
  check('picking a destination satisfies the `where` row', afterPick === true);

  return { valid: fails.length === 0, fails, log };
})()
