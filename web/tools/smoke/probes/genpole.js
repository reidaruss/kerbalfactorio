// FS-51 to FS-53: "THEY CONNECT TO EACH OTHER BUT NOT TO THE GENERATOR", DRIVEN.
//
//   cd web && npx vite --config vite.probe.config.ts --port <free> --strictPort
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:<free>/ --sandbox=1 \
//     --scenario=walk --evalfile=web/tools/smoke/probes/genpole.js --wait=1500
//
// SANDBOX, for the reason probes/power.js gives: the SUBJECT is the grid and not
// the tech tree, so sandbox grants the two electrical buildables and this run
// reaches a wired base in seconds. probes/research.js remains the survival run
// that proves the gate.
//
// WHAT REID HIT, LIVE: "i placed a few power poles and they connect to each
// other but not to the generator." NOTHING IN THE SIM WAS BROKEN. `power.h`
// gives a small pole a WIRE REACH of 7.5 m and a SUPPLY RADIUS of 2.5 m, and
// they are two different rules for two different things: poles find each other
// at 7.5 m, and a generator or a consumer joins the nearest pole whose SUPPLY
// RADIUS covers its centre. Three times apart. So there is a whole band of
// distances, 2.5 m to 7.5 m, where poles visibly wire themselves together and a
// generator dropped in the middle of them joins nothing at all, BY DESIGN. What
// was broken is that nothing in the game said so.
//
// THIS PROBE BUILDS EXACTLY THAT BAND AND MEASURES IT. The poles are placed so
// that the widest pole-to-pole span is GREATER than the 2.5 m supply radius (so
// "they wired" is not an artefact of a cluster tighter than a supply area), and
// the generator is placed so that its nearest pole is strictly INSIDE 7.5 m and
// strictly OUTSIDE 2.5 m. That window is the whole point: at that distance a
// POLE would have wired, and the generator does not join. A generator parked
// beyond 7.5 m would prove nothing about the two rules being different, because
// it would be out of both.
//
// THE FIVE READOUTS, and each is a different surface a player could have looked
// at while getting no answer:
//   1. /core's own count: `generatorsAttached` is 0 while `generatorsPlaced` is
//      1, `poles` is 3 and `wires` is 2. That shape IS the complaint.
//   2. THE POWER PANEL, opened with the real key (KeyU), read out of the DOM at
//      [data-power="offgridgen"]. The DOM and not a JS field, so this proves the
//      pixel and not a second copy of the arithmetic.
//   3. THE CROSSHAIR, which is where the player is already looking: the prompt
//      on the generator reads ON NO NETWORK and offers the fix.
//   4. THE MACHINE PANEL, opened with a bare-handed real click: NO NETWORK,
//      which is the state that used to read BURNING. That was the most
//      misleading thing this panel could say, because it is the one state where
//      everything looks right and no watt reaches anything.
//   5. THE NETWORK ITSELF: capacity 0 W with a fuelled generator standing on the
//      base. Then one pole beside it and every one of the five flips.
//
// WHAT FAILS AGAINST THE CODE AS IT WAS AN HOUR AGO, stated per assertion,
// because a regression probe that cannot name its own negative is decoration:
//   - `power.generatorsAttached` and `power.consumersAttached` DID NOT EXIST in
//     `Power.report()`. They are read through `mustNum`, so on the old build the
//     runner's prelude THROWS ("Published keys: ...") rather than comparing
//     undefined with undefined and going green. Same for the rescued reading.
//   - `[data-power="offgridgen"]` DID NOT EXIST, because `offGridLine` printed
//     one sentence and `offGridCount` only ever looked at `esmelter`, so a
//     GENERATOR could not be reported off grid by any path. The panel assertion
//     fails on a null element.
//   - The crosshair prompt for a fuelled generator read "generator  burning, N
//     coal left" in this exact state. The ON NO NETWORK assertion fails on that
//     string.
//   - The machine panel status read BURNING in this exact state (fuel was tested
//     before network). The NO NETWORK assertion fails on that string.
// The two half-truths (poles wired, capacity 0 W) pass on both builds and are
// asserted anyway: they are the DW-20 gate proving the probe built the geometry
// it claims to be testing rather than some other base.
//
// FUEL IS PART OF THE SETUP AND NOT AN AFTERTHOUGHT. `generatorOffGrid` is
// deliberately FALSE for an unfuelled generator: an empty generator also offers
// zero watts, and it is a different fault with a different fix. So the generator
// is fuelled through the panel's own load button BEFORE any of the five
// readouts are taken, and the probe asserts the coal actually went in.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const el = document.querySelector('canvas');
  if (!el) return { valid: false, why: 'no canvas' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const press = async (code, frames = 6) => {
    of.input.act([code], frames);
    await sleep(0.3);
  };
  const click = (e) => {
    if (!e || e.disabled) return false;
    e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window }));
    return true;
  };
  // A REAL press, as probes/machinepanel.js argues: an inert left button
  // survived twenty probes on the action path, because the action tape sets the
  // intent flag and never touches the DOM.
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  const realClick = async (hold = 0.11) => {
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(hold);
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    await sleep(0.3);
  };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const r2 = (v) => Math.round(v * 100) / 100;
  const pack = () =>
    Object.fromEntries(of.game().carried.map((c) => [c.name, c.count]));
  const listed = () => of.game().factory.list ?? [];
  const poles = () => listed().filter((b) => b.kind === 'pole');
  const gens = () => listed().filter((b) => b.kind === 'generator');
  const grid = () => of.game().progress.power;
  // The two constants this whole probe is ABOUT. They live in
  // `core/include/of/power.h` (poleClassDef, Small) and are restated here as the
  // window the geometry is gated against, never as a rule the client applies:
  // nothing below asks "is a pole within 2.5 m", every verdict comes from /core.
  const SUPPLY_M = 2.5;
  const WIRE_M = 7.5;

  await sleep(1.0);

  // ======================================================================
  // 0. SETUP PROOF (DW-20). Sandbox, and the grid is OFF before anything
  //    electrical exists, so every number below is a change this run caused.
  // ======================================================================
  check('this run is sandbox', of.game().mode.sandbox === true,
    JSON.stringify(of.game().mode));
  const p0 = grid();
  check('the power surface exists', !!p0, JSON.stringify(of.game().progress));
  if (!p0) return { valid: false, fails, why: 'no power in the report' };
  check('the grid is OFF before anything electrical exists',
    p0.enabled === false, JSON.stringify(p0));
  check('and there are no networks yet', p0.networks === 0, p0.networks);
  // THE DEAD-READ GUARD, and it is the first thing that runs on purpose. On the
  // build before FS-51 these two keys are absent and `mustNum` throws here,
  // naming every key the report DOES publish, rather than letting the run go
  // green on undefined === undefined (standing rule 11).
  check('the report publishes generatorsAttached, and it starts at zero',
    mustNum(p0, 'generatorsAttached', 'power report') === 0,
    p0.generatorsAttached);
  check('and consumersAttached, also zero',
    mustNum(p0, 'consumersAttached', 'power report') === 0, p0.consumersAttached);

  // ======================================================================
  // 1. CRAFT AND ARM, through the player's own path: the Tab panel's button,
  //    the pack tile, the hotbar slot.
  // ======================================================================
  const yaw = of.world().observer.yawDeg;
  await press('Tab');
  await sleep(0.4);
  const rows = () => [...document.querySelectorAll('#of-panel .of-recipe')];
  const rowNamed = (t) => rows().find((e) =>
    (e.querySelector('.nm')?.textContent ?? '').includes(t));
  const craftN = async (name, n) => {
    let k = 0;
    for (let i = 0; i < n; ++i) {
      if (click(rowNamed(name)?.querySelector('button'))) k++;
      await sleep(0.08);
    }
    return k;
  };
  check('poles are craftable in sandbox', await craftN('Power pole', 6) === 6);
  check('the generator is craftable in sandbox',
    await craftN('Burner generator', 1) === 1);
  await press('Tab');
  await sleep(0.3);
  // GP-998. GP-506 made coal `requiresToolFor` (gameplay.h), so a bare-hand
  // swing at a CoalSeam node (kind 2) is refused ToolRequired rather than
  // paid less, regardless of sandbox: `of.craft`/`of.harvest` here call
  // straight through to `game.craft`/`game.harvest` (DebugGameplay.ts), not
  // through `GameplayActions.craft`'s `freeBuild` grant branch, so this
  // probe's own pickaxe is paid for out of the pack like any other recipe.
  // TWO SWEEPS WITH THE PICKAXE CRAFTED BETWEEN THEM, the same correction
  // GP-890 made in controls.js/machinepanel.js/machineshot.js. Wood and loose
  // stone (kinds 0, 1) stay ungated so the pickaxe (Stone x2 + Wood x1) has a
  // bare-hand path; nothing else in this probe needs them, so the budget is
  // just enough for the pickaxe with margin.
  let wood = 0;
  for (const n of of.nodes()) {
    if (n.kind !== 0 && n.kind !== 1) continue;
    if ((pack().Wood ?? 0) >= 5 && (pack().Stone ?? 0) >= 5) break;
    for (let k = 0; k < 5; ++k) if (of.harvest(n.index).ok) wood++;
  }
  const pickaxe = of.craft(0);   // Stone x2 + Wood x1
  check('the pickaxe was crafted, so a coal swing is legal', pickaxe,
    JSON.stringify(pack()));
  // COAL OUT OF THE GROUND, because a fuel that arrives by fiat proves nothing
  // about the burn, and because `generatorOffGrid` is false without it.
  let coal = 0;
  for (const n of of.nodes()) {
    if (n.kind === 2) for (let k = 0; k < 10; ++k) if (of.harvest(n.index).ok) coal++;
  }
  check('coal was mined for the generator', coal > 0, coal);
  log.push(`crafted and mined, pack ${JSON.stringify(pack())}`);

  const assign = async (item, slot) => {
    of.hotbar(slot);
    await sleep(0.15);
    await press('Tab');
    await sleep(0.35);
    const tile = document.querySelector(`#of-panel .of-slot[data-item="${item}"]`);
    const ok = click(tile);
    await sleep(0.2);
    await press('Tab');
    await sleep(0.3);
    return ok;
  };
  check('the pole went on slot 4', await assign(0x003F, 4));
  check('the generator went on slot 5', await assign(0x003E, 5));

  // The ghost publishes WHERE THE PART WOULD LAND (BuildMode.report ghost.pos)
  // and whether it would be refused, so every placement below is AIMED at a
  // measured distance instead of guessed from a pitch and a flat-ground
  // assumption. On a slope, guessing is how a probe silently builds a different
  // base from the one its header describes.
  const ghost = () => of.game().build?.ghost ?? null;
  const lookAt = async (dyaw, pitch, settle = 0.2) => {
    of.look(yaw + dyaw, pitch);
    await sleep(settle);
    return ghost();
  };
  const placeHere = async () => {
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 10, keys: [] }]);
    await sleep(0.45);
  };
  /**
   * Sweep bearings and pitches, score each candidate landing spot with `want`
   * (lower is better, Infinity rejects), then place at the best one. Returns
   * what it found so the caller can assert rather than hope.
   *
   * The sweep is bounded rather than a full circle because every sample costs a
   * tick for the ghost to re-solve: a 360 degree sweep is a minute of simulated
   * time per placement, and the callers below already know which half of the
   * world they are aiming into.
   */
  const placeBest = async (slot, want, yaws, pitches) => {
    of.hotbar(slot);
    await sleep(0.2);
    let best = null;
    for (const d of yaws) {
      for (const p of pitches) {
        const g = await lookAt(d, p, 0.12);
        if (g === null || g.ok !== true) continue;
        const score = want(g.pos);
        if (!Number.isFinite(score)) continue;
        if (best === null || score < best.score) best = { score, d, p, pos: g.pos };
      }
    }
    if (best === null) return null;
    await lookAt(best.d, best.p);
    await placeHere();
    return best;
  };
  const span = (from, to, step) => {
    const out = [];
    for (let v = from; v <= to; v += step) out.push(v);
    return out;
  };

  // ======================================================================
  // 2. THE POLES, AND THEY MUST REALLY WIRE (the "they connect to each other"
  //    half). Spread on purpose: the widest span is asserted to EXCEED the
  //    2.5 m supply radius, so nobody can read this base as a huddle that
  //    happens to fit inside one supply area.
  // ======================================================================
  // BEHIND THE PLAYER, three bearings 60 degrees apart at about 2.8 m out, so
  // the trio spans roughly 4.8 m corner to corner. The player keeps the ground
  // in front of them clear for the generator, which then has to be aimed at
  // from a standing spot inside PICK_REACH_M (3.5 m) for the crosshair and the
  // machine-panel readouts to be reachable at all.
  const POLE_SPOTS = [[120, -30], [180, -30], [240, -30], [135, -24], [225, -24]];
  const putPoleAt = async (d, p) => {
    const before = poles().length;
    of.hotbar(4);
    await sleep(0.15);
    await lookAt(d, p);
    await placeHere();
    return poles().length > before;
  };
  let spot = 0;
  while (poles().length < 3 && spot < POLE_SPOTS.length) {
    await putPoleAt(POLE_SPOTS[spot][0], POLE_SPOTS[spot][1]);
    spot++;
  }
  await sleep(0.8);
  const P = poles();
  check('three poles are on the ground', P.length === 3, P.length);
  if (P.length < 2) {
    return { valid: false, fails, why: 'fewer than two poles were placed, so '
      + 'the "they connect to each other" half cannot be built', log };
  }
  const spans = [];
  for (let i = 0; i < P.length; ++i) {
    for (let j = i + 1; j < P.length; ++j) {
      spans.push({ a: P[i].id, b: P[j].id, m: r2(dist(P[i].pos, P[j].pos)) });
    }
  }
  const widestSpan = Math.max(...spans.map((s) => s.m));
  const gPoles = grid();
  // DW-20 GATE, and the probe is worthless without it: if the poles did not
  // actually wire, everything below is measuring a different world.
  check('THE POLES WIRED TO EACH OTHER: wires == poles - 1, and not zero',
    gPoles.wires === gPoles.poles - 1 && gPoles.wires > 0,
    `${gPoles.wires} wires over ${gPoles.poles} poles`);
  check('and they are ONE network', gPoles.networks === 1, gPoles.networks);
  check('the widest pole-to-pole span EXCEEDS the 2.5 m supply radius, so the '
    + 'wiring is not an artefact of a cluster tighter than one supply area',
    widestSpan > SUPPLY_M, `${widestSpan} m`);
  check('and every span is inside the 7.5 m wire reach',
    widestSpan < WIRE_M, `${widestSpan} m`);
  log.push(`poles wired at ${spans.map((s) => `${s.m} m`).join(', ')}`);

  // ======================================================================
  // 3. THE GENERATOR, PLACED IN THE BAND. Nearest pole strictly outside 2.5 m
  //    and strictly inside 7.5 m: a distance at which a POLE would have wired.
  // ======================================================================
  const nearestPoleM = (p) => Math.min(...poles().map((q) => dist(p, q.pos)));
  const TARGET_M = 4.5;                      // mid band, as far from both edges
  const eye = of.aim().origin;
  const genPlace = await placeBest(5, (pos) => {
    const d = nearestPoleM(pos);
    if (d <= SUPPLY_M + 0.6 || d >= WIRE_M - 0.6) return Infinity;
    // AND WITHIN ARM'S LENGTH OF WHERE THE PLAYER IS STANDING. Three of the
    // five readouts (the crosshair prompt, the machine panel, the load button)
    // are only reachable through `Factory.pick`, which stops at 3.5 m.
    if (dist(pos, eye) > 3.0) return Infinity;
    return Math.abs(d - TARGET_M);
  }, span(-50, 50, 10), span(-55, -25, 5));
  await sleep(0.9);
  const G = gens();
  check('a generator is on the ground', G.length === 1,
    `${G.length}, aim ${JSON.stringify(genPlace)}`);
  if (G.length !== 1) {
    return { valid: false, fails, why: 'the generator was never placed', log,
      spans };
  }
  const gen = G[0];
  const genToPolesBefore = poles()
    .map((q) => ({ pole: q.id, m: r2(dist(gen.pos, q.pos)) }))
    .sort((a, b) => a.m - b.m);
  const nearestBefore = genToPolesBefore[0].m;
  // THE SECOND HALF OF THE DW-20 GATE. If the generator did not land in the
  // band, this run is not the run the header describes and it must say so
  // rather than passing on a geometry nobody claimed anything about.
  check('THE GENERATOR IS IN THE BAND: nearest pole is beyond the 2.5 m supply '
    + 'radius but inside the 7.5 m wire reach',
    nearestBefore > SUPPLY_M && nearestBefore < WIRE_M, `${nearestBefore} m`);
  if (!(nearestBefore > SUPPLY_M && nearestBefore < WIRE_M)) {
    return { valid: false, fails, log, spans, genToPolesBefore,
      why: `the generator landed ${nearestBefore} m from its nearest pole, `
        + 'which is outside the 2.5 m to 7.5 m band this probe is about' };
  }
  log.push(`generator to poles: ${genToPolesBefore.map((x) => `${x.m} m`)
    .join(', ')} (nearest ${nearestBefore} m, supply radius ${SUPPLY_M} m, `
    + `wire reach ${WIRE_M} m)`);

  // ======================================================================
  // 4. FUEL IT, THROUGH THE PANEL THE PLAYER USES. A bare-handed real click
  //    opens the machine screen; its own load button puts the coal in.
  // ======================================================================
  of.hotbar(1);
  await sleep(0.25);
  // Point the crosshair as squarely as possible at the generator. PICK_REACH_M
  // is 3.5 m and the generator was placed well inside that of the standing
  // spot, so no walking is needed; the search is over aim only.
  const V = (a) => Math.hypot(a[0], a[1], a[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const aimAt = async (want) => {
    let bestYaw = yaw;
    let bestPitch = -20;
    let best = -2;
    for (let y = -180; y < 180; y += 5) {
      for (let p = -60; p <= 10; p += 5) {
        of.look(y, p);
        const a = of.aim();
        const v = sub(want, a.origin);
        const l = V(v) || 1;
        const k = dot(a.dir, [v[0] / l, v[1] / l, v[2] / l]);
        if (k > best) { best = k; bestYaw = y; bestPitch = p; }
      }
    }
    of.look(bestYaw, bestPitch);
    await sleep(0.3);
    return best;
  };
  const aimDot = await aimAt(gen.pos);
  check('the crosshair resolved to the generator',
    of.game().aimed.build?.kind === 'generator',
    `dot ${r2(aimDot)}, aimed ${JSON.stringify(of.game().aimed.build)}`);
  await realClick(0.11);
  check('a bare-handed click opened the generator screen',
    of.game().screen.open === true && of.game().screen.of === 'generator',
    JSON.stringify({ open: of.game().screen.open, of: of.game().screen.of }));
  const fuelBtn = () => [...document.querySelectorAll('#of-furnace button[data-load]')]
    .find((b) => b.textContent.includes('Coal')) ?? null;
  check('the panel offers the pack coal', fuelBtn() !== null,
    (of.game().screen.loadable ?? []).join(', '));
  click(fuelBtn());
  await sleep(0.5);
  const fuelled = gens()[0];
  check('the coal went into the generator', (fuelled.fuel ?? 0) > 0,
    `fuel ${fuelled.fuel}, pack ${JSON.stringify(pack())}`);

  // ======================================================================
  // 5. READOUT 4: THE MACHINE PANEL SAYS NO NETWORK, not BURNING.
  // ======================================================================
  const statusEl = () => document.querySelector('#of-furnace h3 span');
  const statusText = () => (statusEl()?.textContent ?? '').trim();
  await sleep(0.4);
  check('the machine panel STATUS reads NO NETWORK',
    statusText() === 'NO NETWORK', `"${statusText()}"`);
  check('and the view behind it says the same',
    of.game().screen.status === 'NO NETWORK', of.game().screen.status);
  const statusOffGrid = statusText();
  of.escape();
  await sleep(0.4);
  check('the machine panel closed', of.game().screen.open === false);

  // ======================================================================
  // 6. READOUT 1: /core's OWN COUNT. This one line is Reid's sentence made a
  //    number: 3 poles, 2 wires, 1 generator placed, 0 attached.
  // ======================================================================
  const gOff = grid();
  check('a fuelled generator is attached to NOTHING',
    mustNum(gOff, 'generatorsAttached', 'power report') === 0,
    gOff.generatorsAttached);
  check('while one was definitely placed',
    mustNum(gOff, 'generatorsPlaced', 'power report') >= 1, gOff.generatorsPlaced);
  check('the poles are still wired to each other around it',
    gOff.wires === gOff.poles - 1 && gOff.wires > 0,
    `${gOff.wires} wires over ${gOff.poles} poles`);
  // READOUT 5: the consequence, in watts. A fuelled 90 kW generator on the base
  // and the network it is standing in the middle of can offer nothing at all.
  check('READOUT 5: the network capacity is ZERO with a fuelled generator on '
    + 'the base', (gOff.capacityW[0] ?? -1) === 0, JSON.stringify(gOff.capacityW));
  log.push(`OFF GRID: poles ${gOff.poles}, wires ${gOff.wires}, generators `
    + `placed ${gOff.generatorsPlaced}, attached ${gOff.generatorsAttached}, `
    + `capacity ${gOff.capacityW[0]} W`);

  // ======================================================================
  // 7. READOUT 2: THE POWER PANEL, opened with the real key (KeyU), read out
  //    of the DOM. Not a JS field: this proves the pixel.
  // ======================================================================
  await press('KeyU');
  await sleep(0.6);
  const panel = () => document.querySelector('#of-power');
  check('the power panel opened on U',
    !!panel() && panel().classList.contains('open'), panel()?.className);
  const offGenEl = () => document.querySelector('#of-power [data-power="offgridgen"]');
  const offGenLine = () => offGenEl()?.parentElement?.textContent ?? '';
  check('READOUT 2: the panel prints an OFF-GRID GENERATOR count',
    offGenEl() !== null,
    'no [data-power="offgridgen"] in ' + (panel()?.textContent ?? 'nothing'));
  check('and that count is exactly 1',
    (offGenEl()?.textContent ?? '') === '1', offGenEl()?.textContent);
  const panelSentence = offGenLine();
  const panelCountOffGrid = offGenEl()?.textContent ?? null;
  check('the sentence names the fault and the fix',
    panelSentence.includes('not reached by any pole')
    && panelSentence.includes('Put a power pole beside it'), `"${panelSentence}"`);
  // THE OTHER SENTENCE MUST NOT HAVE FIRED. `offGridCount` is about consumers,
  // and there are none in this base: a panel that printed "N machines are not
  // reached by any pole" here would be answering a question nobody asked, which
  // is the merge these two counts exist to prevent.
  check('and the CONSUMER sentence stayed silent, there being no consumers',
    document.querySelector('#of-power [data-power="offgrid"]') === null,
    document.querySelector('#of-power [data-power="offgrid"]')?.textContent);
  await press('KeyU');
  await sleep(0.4);

  // ======================================================================
  // 8. READOUT 3: THE CROSSHAIR, which is where the player is already looking.
  // ======================================================================
  await aimAt(gen.pos);
  check('the crosshair is on the generator again',
    of.game().aimed.build?.kind === 'generator',
    JSON.stringify(of.game().aimed.build));
  await sleep(0.4);
  const promptText = () => document.querySelector('#of-prompt')?.textContent ?? '';
  const promptOff = promptText();
  check('READOUT 3: the crosshair prompt says ON NO NETWORK',
    promptOff.includes('ON NO NETWORK'), `"${promptOff}"`);
  check('and it names the fix rather than only the fault',
    promptOff.includes('put a power pole beside it'), `"${promptOff}"`);
  check('so it is NOT the old "burning" sentence',
    !promptOff.includes('burning'), `"${promptOff}"`);
  log.push(`crosshair, off grid: "${promptOff}"`);

  // ======================================================================
  // 9. ONE MORE POLE, BESIDE THE GENERATOR, AND EVERY READOUT FLIPS.
  //
  //    Inside the supply area this time. Nothing else about the base changes,
  //    so anything that moves below moved because of this one pole.
  // ======================================================================
  const rescue = await placeBest(4, (pos) => {
    const d = dist(pos, gen.pos);
    // Strictly inside the supply radius, and not on top of the generator's own
    // cell (which the ghost would refuse anyway).
    if (d < 0.9 || d > SUPPLY_M - 0.4) return Infinity;
    return d;
  }, span(-60, 60, 10), span(-60, -20, 5));
  await sleep(1.0);
  const P2 = poles();
  check('a fourth pole went down beside the generator', P2.length === P.length + 1,
    `${P.length} -> ${P2.length}, aim ${JSON.stringify(rescue)}`);
  const genToPolesAfter = P2.map((q) => ({ pole: q.id, m: r2(dist(gen.pos, q.pos)) }))
    .sort((a, b) => a.m - b.m);
  const nearestAfter = genToPolesAfter[0].m;
  check('and it is INSIDE the 2.5 m supply radius', nearestAfter < SUPPLY_M,
    `${nearestAfter} m`);
  const gOn = grid();
  check('THE FAULT CLEARS: the generator is attached now',
    mustNum(gOn, 'generatorsAttached', 'power report') === 1,
    gOn.generatorsAttached);
  check('it is still ONE network, so the new pole joined the existing one',
    gOn.networks === 1, gOn.networks);
  check('the tree grew with it', gOn.wires === gOn.poles - 1 && gOn.wires > 0,
    `${gOn.wires} wires over ${gOn.poles} poles`);
  check('and the network can offer watts at last', (gOn.capacityW[0] ?? 0) > 0,
    JSON.stringify(gOn.capacityW));
  log.push(`RESCUED: nearest pole ${nearestAfter} m, generators attached `
    + `${gOn.generatorsAttached}, capacity ${gOn.capacityW[0]} W`);

  // The same three readouts, again, and all three must have gone quiet. A
  // readout that can only ever say "broken" is not a readout.
  await press('KeyU');
  await sleep(0.6);
  check('the panel line is GONE', offGenEl() === null,
    offGenEl()?.parentElement?.textContent);
  const panelAfter = panel()?.textContent ?? '';
  check('and the panel is drawing the network rather than nothing',
    !!document.querySelector('#of-power [data-power="q16:0"]'), panelAfter.slice(0, 120));
  await press('KeyU');
  await sleep(0.4);

  // THE HANDS GO BACK IN FIRST, and the first run of this probe is the reason
  // it is spelled out: `placeBest` left the POLE in hand, so the crosshair was
  // showing the GHOST's prompt ("power pole  cell taken") and the click that was
  // meant to open the panel tried to place a pole instead. The status then read
  // NO NETWORK off the panel's own retained innerHTML from the previous open,
  // which is a stale DOM passing itself off as a live reading: exactly the class
  // of false negative the machine-panel assertions exist to catch, arriving from
  // the probe's own end.
  of.hotbar(1);
  await sleep(0.3);
  await aimAt(gen.pos);
  await sleep(0.4);
  check('the crosshair is on the generator with the hands empty',
    of.game().aimed.build?.kind === 'generator',
    JSON.stringify({ aimed: of.game().aimed.build, hand: of.game().hotbar?.selected }));
  const promptOn = promptText();
  check('the crosshair prompt no longer says ON NO NETWORK',
    !promptOn.includes('ON NO NETWORK'), `"${promptOn}"`);
  check('it says the generator is burning instead',
    promptOn.includes('burning'), `"${promptOn}"`);
  log.push(`crosshair, rescued: "${promptOn}"`);

  await realClick(0.11);
  await sleep(0.5);
  // ASSERTED BEFORE THE STATUS IS READ. FurnacePanel keeps its innerHTML when
  // it closes, so a status string read while the panel is shut is the LAST
  // machine's, not this one's.
  check('the generator screen opened again for the after reading',
    of.game().screen.open === true && of.game().screen.of === 'generator',
    JSON.stringify({ open: of.game().screen.open, of: of.game().screen.of }));
  const statusOn = statusText();
  check('and the machine panel reads BURNING now', statusOn === 'BURNING',
    `"${statusOn}"`);
  check('the view behind it agrees', of.game().screen.status === 'BURNING',
    of.game().screen.status);
  of.escape();
  await sleep(0.3);

  return {
    valid: fails.length === 0,
    fails,
    log,
    geometry: {
      supplyRadiusM: SUPPLY_M,
      wireReachM: WIRE_M,
      poleSpansM: spans,
      widestPoleSpanM: widestSpan,
      genToPolesBeforeM: genToPolesBefore,
      nearestPoleBeforeM: nearestBefore,
      genToPolesAfterM: genToPolesAfter,
      nearestPoleAfterM: nearestAfter,
      genAimDot: r2(aimDot),
      genPlacement: genPlace,
      rescuePlacement: rescue,
    },
    offGrid: {
      poles: gOff.poles, wires: gOff.wires, networks: gOff.networks,
      generatorsPlaced: gOff.generatorsPlaced,
      generatorsAttached: gOff.generatorsAttached,
      consumersAttached: gOff.consumersAttached,
      capacityW: gOff.capacityW,
      // Captured AT the reading and not re-read here: by the time this object
      // is built the rescuing pole has landed and the element is gone, which is
      // the whole point of section 9.
      panelCount: panelCountOffGrid,
      panelSentence,
      prompt: promptOff,
      machinePanelStatus: statusOffGrid,
    },
    rescued: {
      poles: gOn.poles, wires: gOn.wires, networks: gOn.networks,
      generatorsAttached: gOn.generatorsAttached,
      capacityW: gOn.capacityW,
      panelLineGone: offGenEl() === null,
      prompt: promptOn,
      machinePanelStatus: statusOn,
    },
    coalMined: coal,
    packAtEnd: pack(),
    ticks: of.world().tick,
  };
})()
