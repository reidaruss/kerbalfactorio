// ONE CLICK, ONE FOUNDATION. Reid: "when i click to place a foundation, it
// typically places multiple."
//
// WHY THE ACTION TAPE CANNOT CATCH THIS AND A REAL POINTER EVENT CAN. Every
// other build probe in this suite drives placement with `of.input.act(['use'],
// n)`, which holds the button for exactly n frames chosen by the probe. That is
// precisely the abstraction that hides press-DURATION behaviour: a probe that
// picks 4 frames is asserting about 4 frames, and a human click is 60 to 150 ms,
// which is 4 to 9 fixed ticks at 60 Hz and varies from click to click. So this
// file dispatches a real `pointerdown`, waits a realistic click duration, and
// dispatches a real `pointerup`, exactly as `probes/realclick.js` does for the
// dig verb. The defect being fixed lived in the ticks BETWEEN those two events
// and twenty green probes never looked there.
//
// THE MEASUREMENT IS TAKEN IN TWO PLACES THAT MUST AGREE: the number of parts in
// the world, and the number of items charged for them. A build that placed three
// and charged for one would be a different and worse bug, and counting only
// parts could not tell them apart.
//
// AND THERE IS A POSITIVE CONTROL, because "exactly one" is trivially satisfied
// by a build system that has stopped working: a genuine DRAG across the base
// must still lay a run, and it must lay one part per cell it crosses and not
// several. A fix that killed the drag would pass every assertion above it.
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

  const parts = () => of.game().structures.parts.length;
  const stoneHeld = () => {
    const row = of.game().carried.find((c) => c.name === 'Stone');
    return row === undefined ? 0 : row.count;
  };
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  /** A real click of `ms` milliseconds, through the real pointer path. */
  const click = async (ms) => {
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(ms / 1000);
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    await sleep(0.35);
  };

  await sleep(1.0);
  const sandbox = of.game().mode.sandbox === true;
  log.push(`mode: ${sandbox ? 'sandbox' : 'survival'}`);

  // The hand, through the key a player presses.
  const bar = () => of.game().hotbar;
  const fSlot = bar().slots.findIndex((s) => s.part === 'foundation');
  of.input.act([`slot${fSlot + 1}`], 4);
  await sleep(0.3);
  check('a foundation is in hand', bar().part === 'foundation', bar().part);

  of.look(of.world().observer.yawDeg, -30);
  await sleep(0.4);
  check('the ghost is valid before the first click',
    of.game().build.structGhost?.ok === true,
    of.game().build.structGhost?.reason);

  // THE FIRST CLICK MAY LEGITIMATELY BE EATEN because it buys the pointer lock
  // back, which is the behaviour that stops a click aimed at a menu from
  // placing a building (probes/realclick.js makes the same distinction). So the
  // measurement starts on the SECOND click, made while playing.
  await click(120);
  await sleep(0.3);
  log.push(`after the lock-buying click: ${parts()} parts`);

  // ======================================================================
  // 1. THE CLAIM. Five real clicks at human durations, each on a fresh cell.
  // ======================================================================
  const rows = [];
  const yaw0 = of.world().observer.yawDeg;
  const D = 180 / Math.PI;
  const feet0 = of.world().player.feet;
  const R = Math.hypot(feet0[0], feet0[1], feet0[2]) || 1;
  const lat0 = Math.asin(feet0[1] / R) * D;
  const lon0 = Math.atan2(feet0[2], feet0[0]) * D;
  /** A fresh patch of ground, 60 m away, so no measured click can be skipped as
   *  "already built here". A skipped row is a row that measured nothing, and a
   *  probe whose rows quietly stop measuring is the failure this file exists to
   *  catch, one level up. */
  const freshGround = async (i) => {
    of.teleport(lat0 + (i * 60) / R * D, lon0 + (i % 2 === 0 ? 60 : -60) / R * D, 0);
    await sleep(0.6);
    of.look(yaw0, -30);
    await sleep(0.4);
  };
  // Durations spanning the range a human click actually covers. 60 ms is 4
  // fixed ticks and 150 ms is 9; the defect scaled with the count, so a single
  // duration would have measured one point on a line.
  const DURATIONS = [60, 90, 120, 150, 100];
  for (let i = 0; i < DURATIONS.length; ++i) {
    await freshGround(i + 1);
    const g = of.game().build.structGhost;
    if (g === null || g.ok !== true) { rows.push({ ms: DURATIONS[i], skipped: g?.reason }); continue; }
    const p0 = parts();
    const s0 = stoneHeld();
    await click(DURATIONS[i]);
    const dp = parts() - p0;
    const ds = s0 - stoneHeld();
    rows.push({ ms: DURATIONS[i], placed: dp, stoneSpent: ds,
      settles: of.game().build.dragSettles });
    check(`a ${DURATIONS[i]} ms click places EXACTLY ONE foundation`, dp === 1, dp);
    if (!sandbox) {
      check(`a ${DURATIONS[i]} ms click charges for EXACTLY ONE`, ds === 40, ds);
    }
  }
  log.push(`clicks: ${JSON.stringify(rows)}`);
  const placedTotal = rows.reduce((a, r) => a + (r.placed ?? 0), 0);
  const clicked = rows.filter((r) => r.placed !== undefined).length;
  check('every measured click placed one and only one',
    clicked > 0 && placedTotal === clicked, `${placedTotal} from ${clicked} clicks`);
  check('and every duration was actually measured, none skipped',
    clicked === DURATIONS.length, `${clicked} of ${DURATIONS.length}`);

  // ======================================================================
  // 2. THE POSITIVE CONTROL. A real DRAG still lays a run.
  // ======================================================================
  await freshGround(9);
  const p0 = parts();
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  await sleep(0.2);
  // Sweep the crosshair across VIRGIN ground while the button is DOWN, which is
  // the gesture the drag exists for. On ground that has already been built on
  // every step would be refused as "already built here" and the control would
  // read zero for a reason that has nothing to do with the rule.
  for (let k = 0; k < 8; ++k) {
    of.look(yaw0 - 30 + k * 9, -34);
    await sleep(0.14);
  }
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  await sleep(0.4);
  const dragged = parts() - p0;
  log.push(`drag laid ${dragged} parts over 8 aim steps`);
  check('CONTROL: a real DRAG still lays a run', dragged >= 2, dragged);
  check('CONTROL: and it is not laying more than one part per aim step',
    dragged <= 8, dragged);
  // The settle counter must be NON-ZERO by the end, because that is the
  // evidence the rule actually fired rather than the aim happening to be
  // steady. A run where it stayed at zero would mean this probe never met the
  // defect and is asserting nothing.
  check('CONTROL: the settle rule actually fired at least once',
    of.game().build.dragSettles > 0, of.game().build.dragSettles);

  // ======================================================================
  // 2b. A CLICK MADE WHILE WALKING. The drag gate lets a movement key through
  //     on purpose, because holding the button and walking forward is how a
  //     belt run is laid (probes/controls.js lays fifteen tiles that way), so
  //     this is the case where the gate is deliberately most permissive and is
  //     therefore the one worth measuring rather than reasoning about.
  // ======================================================================
  await freshGround(10);
  {
    const p1 = parts();
    of.input.tape([{ hold: 14, keys: ['KeyW'] }]);
    await sleep(0.05);
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(0.12);
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    await sleep(0.4);
    of.input.tape([{ hold: 4, keys: [] }]);
    await sleep(0.2);
    const walked = parts() - p1;
    log.push(`a 120 ms click made WHILE WALKING laid ${walked}`);
    check('a click made while walking still places at most one', walked <= 1,
      walked);
  }

  // ======================================================================
  // 3. THE SAME CLASS, FOR THE OTHER PART KINDS AND FOR A MACHINE. Whatever
  //    re-fire rule was wrong here is shared, so it is measured shared.
  // ======================================================================
  const kinds = [];
  // A belt is counted out of the FACTORY's own report, not the structural part
  // list: it is a `BuildKind` and goes down a different path, which is exactly
  // why it is here. `stepMachine` steps one cell at a time through `stepToward`
  // and refuses an occupied cell, so it should already be immune to the class;
  // measuring it is how that stops being a claim and starts being a fact.
  const builds = () => of.game().factory?.buildings ?? -1;
  for (const part of ['wall', 'floor', 'door', 'belt']) {
    const slot = bar().slots.findIndex((s) => s.part === part);
    if (slot < 0) continue;
    await freshGround(11 + kinds.length);
    of.input.act([`slot${slot + 1}`], 4);
    await sleep(0.3);
    of.look(yaw0, part === 'belt' ? -28 : -32);
    await sleep(0.35);
    const isBelt = part === 'belt';
    const before = isBelt ? builds() : parts();
    await click(120);
    const after = isBelt ? builds() : parts();
    kinds.push({ part, placed: after - before,
      reason: (isBelt ? of.game().build.ghost?.reason
        : of.game().build.structGhost?.reason) ?? '' });
    check(`one click places at most one ${part}`, after - before <= 1,
      `${after - before}`);
  }
  log.push(`other kinds: ${JSON.stringify(kinds)}`);

  return {
    valid: fails.length === 0,
    fails,
    log,
    clicks: rows,
    dragParts: dragged,
    otherKinds: kinds,
    build: of.game().build,
  };
})()
