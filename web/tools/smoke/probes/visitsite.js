// GP-169. VISIT SITE, driven the way a player drives it (GP-167 / GP-168).
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5241/ --scenario=walk \
//     --sandbox=1 --evalfile=tools/smoke/probes/visitsite.js
//
// Seven buttons in the game menu teleport the walker to the WG-55 survey's
// seven candidate spawns. Every press below is a REAL PointerEvent on the real
// <button> (standing rule 3, the press helper is cheats.js's verbatim), and the
// arrival oracle is THIS FILE'S OWN COPY of the survey table from
// docs/controllers/world-gen.md section 6.1, deliberately not the client's
// (VisitSites.ts): a digit mistyped into the client cannot certify itself, and
// a wrong latitude does not land at the right designed altitude.
//
// WHAT ARRIVAL MEANS, per site: the menu CLOSED on the press (GP-168), the
// stream converged with real drawn vertices under the feet (sitelook.js's own
// wait), the observer is within 0.01 deg of the target, the walker is GROUNDED
// at the survey's designed height within 25 m, and 1.5 s of standing moves the
// feet less than 5 cm radially (the GP-53 sinking family: "grounded once" and
// "stays on the ground" are different claims).
//
// THE ABOARD REFUSAL at the end is the state guard's proof: aboard a vessel the
// rows are DISABLED with a sentence, the VERB refuses through `of.cheat` (the
// startfresh-refusal pattern: a blocked row has no pressable button), and the
// walker's feet did not move. ViewRouter would have routed the teleport to the
// vessel source whose teleport() is a no-op, so an unguarded press would have
// reported success and moved nothing, which is the lie the guard exists for.
//
// OF_ARGS: { "sites": ["beach"] } limits the walk (the nobbled-build negative
// control drives one site); { "aboard": false } skips the flight half.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };

  // The survey table, copied from world-gen.md section 6.1 ("The candidates").
  // The doc is the source of record: the survey's numbers were only ever CLI
  // arguments to sitelook.js, so there is no machine-readable second copy.
  const SITES = [
    { id: 'current', latDeg: 2.0, lonDeg: 144.0, groundM: 4667.8 },
    { id: 'hills', latDeg: -31.165, lonDeg: -86.27401, groundM: 2077.2 },
    { id: 'hills2', latDeg: 22.286, lonDeg: 108.84406, groundM: 1897.2 },
    { id: 'plains', latDeg: -7.9675, lonDeg: 116.53189, groundM: 331.8 },
    { id: 'beach', latDeg: -35.6028, lonDeg: 53.30131, groundM: 12.2 },
    { id: 'beach2', latDeg: -57.938, lonDeg: -85.626, groundM: 8.3 },
    { id: 'forest', latDeg: -19.85, lonDeg: -72.7853, groundM: 27.3 },
  ];
  const wanted = Array.isArray(A.sites)
    ? SITES.filter((s) => A.sites.includes(s.id)) : SITES;

  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  /** cheats.js's press helper, verbatim: re-queried across the hold because
   *  PauseMenu.render replaces the body wholesale (GP-155 / GP-156). */
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
  const lonDiff = (a, b) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  };

  await sleep(0.8);
  if (of.world().player === null) return { valid: false, why: 'no character' };

  // ======================================================================
  // A. THE GROUP IS ON SCREEN and every row says what makes its site a place
  // ======================================================================
  of.pause(true);
  await sleep(0.4);
  const view = of.pause().view;
  const visits = mustHave(view, 'visits', 'pause().view');
  check('the menu carries all seven sites', visits.length === 7,
    visits.map((v) => v.id).join(','));
  check('every row is a drawn, enabled button',
    SITES.every((s) => {
      const b = document.querySelector(`#of-pause button[data-cheat="visit:${s.id}"]`);
      return b !== null && b.disabled === false;
    }), JSON.stringify(of.pause().buttons.filter((b) => b.id.startsWith('visit:'))));
  // The decision-tool half: a bare button name is not a differentiator.
  check('every row carries the line that makes its site a DIFFERENT place',
    visits.every((v) => v.note.length > 60),
    JSON.stringify(visits.map((v) => [v.id, v.note.length])));
  check('the sun elevations from the survey are on the rows',
    ['89.5', '69.2', '59.3', '47.4', '36.1', '31.6', '9.3']
      .every((deg) => visits.some((v) => v.note.includes(deg))),
    visits.map((v) => v.note).join(' | '));
  of.pause(false);
  await sleep(0.3);

  // ======================================================================
  // B. SEVEN PRESSES, SEVEN ARRIVALS
  // ======================================================================
  const arrivals = [];
  for (const s of wanted) {
    of.pause(true);
    await sleep(0.4);
    check(`${s.id}: the real button takes the press`, await press(`visit:${s.id}`));
    // GP-168: arrival closes the menu through the Escape transition.
    check(`${s.id}: the menu CLOSED on arrival`, of.pause().open === false);
    const rec = of.cheat().log.filter((r) => r.id === `visit:${s.id}`).pop();
    check(`${s.id}: the receipt is terminal and done`,
      rec !== undefined && rec.done === true && rec.detail?.site === s.id,
      JSON.stringify(rec));

    // WAIT FOR THE STREAM, sitelook.js's own answer: converged plus real drawn
    // vertices under the feet, never a guessed sleep.
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
    const dLat = Math.abs(w.observer.latDeg - s.latDeg);
    const dLon = lonDiff(w.observer.lonDeg, s.lonDeg);
    const dGround = Math.abs(w.surfaceHeightM - s.groundM);
    check(`${s.id}: arrived within 0.01 deg`, dLat < 0.01 && dLon < 0.01,
      `lat ${w.observer.latDeg.toFixed(5)} vs ${s.latDeg}, `
      + `lon ${w.observer.lonDeg.toFixed(5)} vs ${s.lonDeg}`);
    check(`${s.id}: GROUNDED on streamed geometry`, w.player.grounded === true,
      `grounded=${w.player.grounded} after ${streamSecs}s`);
    check(`${s.id}: at the survey's designed height`, dGround < 25,
      `${w.surfaceHeightM.toFixed(1)} m vs survey ${s.groundM} m`);

    // STANDING, NOT SINKING (the GP-53 family): 1.5 s of nothing moves the
    // feet less than 5 cm radially and the ground still holds.
    const r0 = Math.hypot(...w.player.feet);
    await sleep(1.5);
    const w2 = of.world();
    const r1 = Math.hypot(...w2.player.feet);
    check(`${s.id}: still standing 1.5 s later`,
      w2.player.grounded === true && Math.abs(r1 - r0) < 0.05,
      `dr ${(r1 - r0).toFixed(4)} m, grounded=${w2.player.grounded}`);
    arrivals.push({ site: s.id, streamSecs, latDeg: +w.observer.latDeg.toFixed(5),
      lonDeg: +w.observer.lonDeg.toFixed(5),
      groundM: +w.surfaceHeightM.toFixed(1), surveyM: s.groundM,
      driftM: +(r1 - r0).toFixed(4), biome: w.biome });
    log.push(`${s.id}: ${w.surfaceHeightM.toFixed(1)} m (survey ${s.groundM}), `
      + `streamed ${streamSecs}s, drift ${(r1 - r0).toFixed(4)} m`);
  }

  // An id nobody authored refuses by name rather than teleporting to NaN.
  const bogus = of.cheat('visit:nowhere').log.pop();
  check('an unknown site refuses by name',
    bogus.done === false && bogus.message.includes('no such site'),
    JSON.stringify(bogus));

  // ======================================================================
  // C. ABOARD A VESSEL, EVERY SITE REFUSES (the ViewRouter no-op trap)
  // ======================================================================
  let aboard = { ran: false };
  if (A.aboard !== false && typeof of.vab === 'function'
      && typeof of.flight === 'function') {
    const built = await buildRocket();
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
    aboard = { ran: true, parts: built, aboard: of.flight('report').aboard };
    check('the probe got a rocket built, rolled out and boarded',
      aboard.aboard === true, JSON.stringify(of.flight('report').message));
    if (aboard.aboard === true) {
      of.pause(true);
      await sleep(0.4);
      // GP-236: THE SEVEN THIS FILE OWNS, matched by id off its own table and
      // no longer by the `visit:` prefix. GP-233 added an eighth destination of
      // a different kind under that prefix (the orbital station, its own group,
      // its own probe) and this row's `length === 7` went red on a screen that
      // had grown correctly, which is GP-154's lesson recurring: a literal
      // count is a check being right about the wrong thing.
      const ids = SITES.map((s) => `visit:${s.id}`);
      const rows = of.pause().buttons.filter((b) => ids.includes(b.id));
      check('aboard, every visit row is DISABLED',
        rows.length === SITES.length && rows.every((b) => b.disabled === true),
        JSON.stringify(rows.map((b) => [b.id, b.disabled])));
      check('and each says WHY with the keys that fix it',
        rows.every((b) => b.blocked.includes('aboard')
          && b.blocked.includes('disembark')),
        rows[0]?.blocked ?? 'no rows');
      // The VERB refuses too (the startfresh pattern: a disabled button cannot
      // be pressed, so the refusal is proven at the one entry point).
      const feet0 = of.world().player.feet.slice();
      const ref = of.cheat('visit:beach').log.pop();
      check('the verb refuses aboard', ref.done === false
        && ref.message.startsWith('refused'), JSON.stringify(ref));
      await sleep(0.5);
      const feet1 = of.world().player.feet;
      const moved = Math.hypot(feet1[0] - feet0[0], feet1[1] - feet0[1],
        feet1[2] - feet0[2]);
      check('and the walker did not move a millimetre', moved < 0.001,
        `${moved.toFixed(6)} m`);
      aboard.refusal = ref.message;
      of.pause(false);
    }
  }

  return { valid: fails.length === 0, fails, log, arrivals, aboard,
    sitesDriven: wanted.map((s) => s.id) };

  /** cheats.js's minimal rocket, verbatim: pod, tank, engine at the bay's own
   *  published sockets. The bay itself is proven in probes/rollout.js. */
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
