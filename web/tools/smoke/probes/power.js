// THE SUPPLY-AND-DEMAND ACCEPTANCE (W11 lane D's blocker D-1 and D-2).
// `power.h` landed complete and green in /core last night with no way to reach
// the game, because nothing in the browser could call it.
//
//   npm --prefix web run build
//   npx --prefix web vite preview --port 4188
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4188/ --scenario=walk \
//     --sandbox=1 --evalfile=web/tools/smoke/probes/power.js
//
// SANDBOX, because the SUBJECT here is the grid and not the tech tree: sandbox
// grants the three electrical buildables so the probe can get to a network in
// seconds instead of smelting forty ingots first. `probes/research.js` is the
// survival run that proves the gate, and it is the one that would catch a gate
// wired to nothing. Both are needed and neither replaces the other.
//
// THE CLAIM: the panel's number IS /core's number.
//
// THE HEADLINE CASE, which is lane D's own and is arithmetic rather than a
// tolerance: ONE 90 kW BURNER GENERATOR RUNS EXACTLY THREE 30 kW ELECTRIC
// SMELTERS, AND THE FOURTH ADDS PRECISELY ZERO OUTPUT. Three smelters is
// 90 kW against 90 kW, satisfaction 65536 exactly. Four is 120 kW against
// 90 kW, and 90000 * 65536 / 120000 is 49152 EXACTLY, with no rounding, which
// is why the panel carries the Q16 integer beside the percentage: 49152 is
// checkable against the headless suite and "75%" is not.
//
// THE NEGATIVE CONTROLS:
//   1. THE THIRD SMELTER. At three the network reads 65536, at four it reads
//      49152. A panel hard-wired to "you are short" fails the first; one
//      hard-wired to full fails the second.
//   2. THE PANEL AGAINST /core, FIELD BY FIELD, in the same frame. The number
//      on screen is read out of the DOM through `data-power` and compared with
//      the number the bridge returns. A view layer that recomputed satisfaction
//      from rounded watts would pass every assertion about /core and fail this.
//   3. NO FUEL, NO POWER. Before any coal is inserted the same network reads a
//      capacity of ZERO with the same generator standing on it, so "it works"
//      cannot be the generator merely existing.
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
  const press = async (code, frames = 6) => {
    of.input.act([code], frames);
    await sleep(0.3);
  };
  const click = (el) => {
    if (!el || el.disabled) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window }));
    return true;
  };
  const pack = () =>
    Object.fromEntries(of.game().carried.map((c) => [c.name, c.count]));
  const Q16 = 65536;

  await sleep(1.0);

  // ======================================================================
  // 0. SETUP PROOF (DW-20). Sandbox, and the grid is OFF before anything
  //    electrical is placed, which is the property protecting every existing
  //    world: a network that never enables the grid behaves as it always did.
  // ======================================================================
  check('this run is sandbox', of.game().mode.sandbox === true,
    JSON.stringify(of.game().mode));
  const p0 = of.game().progress;
  check('the power surface exists', !!p0?.power);
  if (!p0?.power) return { valid: false, fails, why: 'no power in the report' };
  check('the grid is OFF before anything electrical exists',
    p0.power.enabled === false, JSON.stringify(p0.power));
  check('and there are no networks', p0.power.networks === 0, p0.power.networks);

  // ======================================================================
  // 1. BUILD A GRID. Craft in the pack (free in sandbox), assign to the bar
  //    through the pack tile a player clicks, then place with the left button.
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
  check('the pole is craftable in sandbox', await craftN('Power pole', 6) === 6);
  check('the generator is craftable in sandbox',
    await craftN('Burner generator', 1) === 1);
  check('the electric smelter is craftable in sandbox',
    await craftN('Electric smelter', 4) === 4);
  // GP-999. GP-506 made coal and iron `requiresToolFor` (gameplay.h), so a
  // bare-hand swing at a CoalSeam/IronOre node (kinds 2, 3) is refused
  // ToolRequired rather than paid less, regardless of sandbox: `of.craft`/
  // `of.harvest` here call straight through to `game.craft`/`game.harvest`
  // (DebugGameplay.ts), not through `GameplayActions.craft`'s `freeBuild`
  // grant branch, so this probe's own pickaxe is paid for out of the pack
  // like any other recipe. TWO SWEEPS WITH THE PICKAXE CRAFTED BETWEEN THEM,
  // the same correction GP-890 made in controls.js/machinepanel.js/
  // machineshot.js. Wood and loose stone (kinds 0, 1) stay ungated so the
  // pickaxe (Stone x2 + Wood x1) has a bare-hand path.
  let wood = 0;
  for (const n of of.nodes()) {
    if (n.kind !== 0 && n.kind !== 1) continue;
    if ((pack().Wood ?? 0) >= 5 && (pack().Stone ?? 0) >= 5) break;
    for (let k = 0; k < 5; ++k) if (of.harvest(n.index).ok) wood++;
  }
  const pickaxe = of.craft(0);   // Stone x2 + Wood x1
  check('the pickaxe was crafted, so coal and iron swings are legal', pickaxe,
    JSON.stringify(pack()));
  // Coal for the generator, out of the ground, because a fuel that arrives by
  // fiat proves nothing about the burn.
  // Coal for the generator and raw iron for the smelters, both out of the
  // ground: a fuel that arrives by fiat proves nothing about the burn.
  //
  // BUDGETED, where the pre-fix loop was not (a second finding this same
  // lane made fixing build.js): once the pickaxe above makes these two swings
  // stop being refused, an unbounded "40 swings per IronOre node, every node
  // in reach" drove Raw iron to 1,035 on the very first try, eleven of the
  // pack's 20 fixed slots (Inventory::kDefaultSlots, gameplay.h) at Raw
  // iron's 100-count stack cap, and starved the electric-smelter crafts of
  // room to land. 300 Raw iron (four smelters, several refeeds, real margin)
  // and 100 Coal (one generator's fuel, same margin) are both far short of
  // that.
  let coal = 0;
  let ore = 0;
  for (const n of of.nodes()) {
    if (n.kind === 2 && (pack().Coal ?? 0) < 100) for (let k = 0; k < 8; ++k) {
      if (of.harvest(n.index).ok) coal++;
    }
    // FAR more iron than coal, because four hand-fed smelters eat 20 units a
    // press and the first run of this probe quietly ran the pack dry mid-sweep:
    // every hopper was empty at the reading, demand was 0, and the panel
    // correctly reported a base that was doing nothing.
    if (n.kind === 3 && (pack()['Raw iron'] ?? 0) < 300) for (let k = 0; k < 40; ++k) {
      if (of.harvest(n.index).ok) ore++;
    }
  }
  log.push(`crafted, pack ${JSON.stringify(pack())}`);
  await press('Tab');
  await sleep(0.3);

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
  check('the electric smelter went on slot 6', await assign(0x003D, 6));

  const placeAt = async (slot, dyaw, pitch) => {
    of.hotbar(slot);
    await sleep(0.15);
    of.look(yaw + dyaw, pitch);
    await sleep(0.25);
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 10, keys: [] }]);
    await sleep(0.4);
  };
  const listed = () => of.game().factory.list ?? [];
  const kindsPlaced = () => {
    const out = {};
    for (const b of listed()) out[b.kind] = (out[b.kind] ?? 0) + 1;
    return out;
  };
  const ghost = () => of.game().build?.ghost ?? null;

  // --- AIMING AT A POINT, AND WALKING TO ONE (FS-146) ------------------------
  // `aimAtPoint` is `autoline.js`'s search, copied here for the reason
  // `assembler.js` copied it: the observer's yaw lives in a local tangent frame
  // and cannot be computed from body-frame coordinates without re-deriving that
  // frame, so the heading is MEASURED by minimising the ray's perpendicular miss
  // against a known point. The `u <= 0` guard is load bearing, because
  // perpendicular distance to a LINE does not care which way along it the target
  // lies.
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const norm3 = (v) => {
    const m = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / m, v[1] / m, v[2] / m];
  };
  const along = (p, v, m) => [p[0] + v[0] * m, p[1] + v[1] * m, p[2] + v[2] * m];
  const gd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const eye = () => of.aim().origin;
  const missTo = (t) => {
    const a = of.aim();
    const v = sub(t, a.origin);
    const u = dot3(v, a.dir);
    if (u <= 0) return Infinity;
    return Math.hypot(v[0] - a.dir[0] * u, v[1] - a.dir[1] * u,
      v[2] - a.dir[2] * u);
  };
  const aimAtPoint = (t) => {
    let y = of.world().observer.yawDeg;
    let p = -20;
    for (const step of [16, 4, 1, 0.3]) {
      let bestM = Infinity, by = y, bp = p;
      for (let a = -6; a <= 6; ++a) {
        for (let b = -6; b <= 6; ++b) {
          of.look(y + a * step, Math.max(-88, Math.min(20, p + b * step)));
          const m = missTo(t);
          if (m < bestM) { bestM = m; by = y + a * step; bp = p + b * step; }
        }
      }
      y = by; p = Math.max(-88, Math.min(20, bp));
    }
    of.look(y, p);
    return [y, p];
  };
  // The burst is SIZED TO THE GAP (`machineports.js`'s rule): the walker moves
  // at 4.6 m/s, so a flat 60-frame hold covers four and a half metres and fired
  // at a target three metres out it lands the player past it.
  const walkTo = async (pt, stopM) => {
    aimAtPoint(pt);
    let d = gd(eye(), pt);
    for (let i = 0; i < 12 && d > stopM; ++i) {
      const frames = Math.max(5, Math.min(60,
        Math.round(((d - stopM * 0.7) / 4.6) * 60)));
      of.input.tape([{ hold: frames, keys: ['KeyW'] }, { hold: 2, keys: [] }]);
      await sleep(1.1);
      aimAtPoint(pt);
      d = gd(eye(), pt);
    }
    of.input.tape([{ hold: 2, keys: [] }]);
    await sleep(0.2);
    return +d.toFixed(2);
  };
  /** Nearest-to-centre first, so the common case costs one sample. */
  const SPIRAL = (() => {
    const out = [];
    for (let a = -5; a <= 5; ++a) for (let b = -5; b <= 5; ++b) out.push([a, b]);
    out.sort((x, z) => (Math.abs(x[0]) + Math.abs(x[1]))
      - (Math.abs(z[0]) + Math.abs(z[1])));
    return out;
  })();
  const findGhost = async (t, pred, stepDeg = 1.4) => {
    const [y0, p0] = aimAtPoint(t);
    for (const [a, b] of SPIRAL) {
      const y = y0 + a * stepDeg;
      const p = Math.max(-88, Math.min(15, p0 + b * stepDeg));
      of.look(y, p);
      await sleep(0.05);
      const g = ghost();
      if (g !== null && pred(g)) return { g, yaw: y, pitch: p };
    }
    return null;
  };
  const ijOf = (cell) => {
    const m = /:(-?\d+),(-?\d+)$/.exec(cell ?? '');
    return m === null ? null : [Number(m[1]), Number(m[2])];
  };
  const cheb = (a, b) => a === null || b === null ? -1
    : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

  // THE SHIPPED DIMENSION TABLE, read and not retyped (FS-73 published it for
  // exactly this, GP-760 is the precedent). `stepsFor` is `FactorySnap`'s own
  // rule and `MachinePlacement.footprintsOverlap` clears at the same number:
  // the mating distance IS the minimum clash-free distance, at every size
  // (FS-78 states the identity from the migration side).
  const FP = of.game().factory.footprint;
  const touchM = (a, b) => (FP[a] + FP[b]) * 0.5;
  const stepsFor = (a, b) => Math.max(1, Math.ceil(touchM(a, b)));
  /**
   * Put `kind` down near `point`, refusing any cell that stands closer than the
   * mating distance to something already named in `clear`.
   *
   * The ghost's own `ok` is half the predicate and the CELL SEPARATION is the
   * other half, and the second half is what a bare `ok` cannot give: a pole is
   * legal one cell from another pole, so a spiral looking only for `ok` would
   * happily collapse the cluster onto itself and every later smelter would then
   * have nowhere legal to go.
   */
  const placeNear = async (slot, kind, point, clear) => {
    of.hotbar(slot);
    await sleep(0.2);
    const r = await findGhost(point, (g) => {
      if (g.ok !== true || !g.ij) return false;
      for (const [ij, need] of clear) if (cheb(g.ij, ij) < need) return false;
      return true;
    });
    if (r === null) return null;
    of.look(r.yaw, r.pitch);
    await sleep(0.2);
    const before = listed().map((b) => b.id);
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 10, keys: [] }]);
    await sleep(0.45);
    return listed().find((b) => !before.includes(b.id)) ?? null;
  };

  // ======================================================================
  // THE LAYOUT, AND IT IS NOW DERIVED FROM THE SHIPPED FOOTPRINT TABLE
  // RATHER THAN FROM EIGHT HARDCODED BEARINGS (FS-146).
  //
  // WHAT WAS HERE AND WHY IT ROTTED. The layout was eight `[slot, dyaw, pitch]`
  // triples, written when every machine was 2 m and a 1 m grid meant "18 degrees
  // apart at pitch -36 is two cells apart". FS-73 took the electric smelter to
  // 4 m. Measured on the shipped build with the ghost read at every one of those
  // eight bearings, the whole layout resolves into a block THREE CELLS WIDE AND
  // FOUR DEEP (`i` 1 to 3, `j` 0 to 3): the bearings are 18 to 90 degrees apart
  // and the cells they land on are 0 to 2 apart. The pairs need 2 (pole to
  // generator), 3 (pole or generator to smelter) and 4 (smelter to smelter), so
  // five of the eight came back `too close to #1 pole` or `cell taken` and only
  // the three poles ever landed. The bearings were never the claim.
  //
  // WHAT IT IS NOW. Two poles, one generator and four smelters, positioned as
  // METRIC OFFSETS in the site's own tangent frame, taken off the first pole
  // that lands (`fwd` lies in the tangent plane, `up` is its normal, and their
  // cross product is the third axis), and every offset is footprint arithmetic:
  //
  //   pole  P0   where the player is standing, aimed at their own feet
  //   pole  P1   P0 + n * fp.esmelter              the two smelter ROWS must be
  //                                                a full smelter apart, so the
  //                                                poles that serve them are
  //   gen   G    P0 - n * touch(pole, generator)   the mating distance, behind
  //                                                the row, out of the way of
  //                                                the crosshair (GP-50)
  //   esm   S1   P0 + e * touch(pole, esmelter)    each smelter STRAIGHT out
  //   esm   S2   P0 - e * touch(pole, esmelter)    from a pole, which is the
  //   esm   S3   P1 + e * touch(pole, esmelter)    closest a smelter can ever
  //   esm   S4   P1 - e * touch(pole, esmelter)    legally stand to one
  //
  // `touch(a, b)` is `(fpA + fpB) / 2`, the distance at which two housings stop
  // overlapping, and `findGhost` resolves each aim point onto the integer
  // lattice, so this file never needs the cell pitch either. Nothing here says
  // 2, or 4, or a number of degrees. Every pair is then CHECKED against
  // `stepsFor` after the fact, so a future rescale that this layout cannot
  // absorb fails loudly with both numbers instead of dribbling out as five
  // refusals and a dead grid.
  //
  // THE POLES SIT BESIDE THE SMELTERS AND THE GENERATOR SITS BEHIND THEM, which
  // is GP-50's finding kept: a pole on the same bearing as a machine is nearer
  // the crosshair and STEALS the aim, so every E press hits the pole and no
  // hopper is ever loaded.
  // ======================================================================
  await placeAt(4, 0, -50);                      // P0, at the player's feet
  const poleA = listed().find((b) => b.kind === 'pole') ?? null;
  check('the first pole is on the ground', poleA !== null,
    JSON.stringify(listed().map((b) => b.kind)));
  if (poleA === null) return { valid: false, fails, log, why: 'no anchor pole' };
  const e = norm3(poleA.fwd);
  const n = norm3(cross3(poleA.up, poleA.fwd));
  const ijPoleA = ijOf(poleA.cell);
  log.push(`anchor pole ${poleA.cell}`);

  const NEED = {
    poleGen: stepsFor('pole', 'generator'),
    poleEsm: stepsFor('pole', 'esmelter'),
    genEsm: stepsFor('generator', 'esmelter'),
    esmEsm: stepsFor('esmelter', 'esmelter'),
    polePole: stepsFor('pole', 'pole'),
  };
  log.push(`mating cells: ${JSON.stringify(NEED)} from footprint `
    + JSON.stringify(FP));

  const poleB = await placeNear(4, 'pole', along(poleA.pos, n, FP.esmelter),
    [[ijPoleA, NEED.esmEsm]]);
  check('the second pole is on the ground', poleB !== null, 'no second pole');
  const ijPoleB = poleB === null ? null : ijOf(poleB.cell);
  const gen = await placeNear(5, 'generator',
    along(poleA.pos, n, -touchM('pole', 'generator')),
    [[ijPoleA, NEED.poleGen], ...(ijPoleB === null ? [] : [[ijPoleB, NEED.poleGen]])]);
  check('a generator is on the ground', gen !== null, 'no generator');

  const esmelterRows = [];
  const poles = [poleA, poleB].filter((p) => p !== null);
  for (const anchor of poles) {
    for (const dir of [1, -1]) {
      const clear = [];
      for (const p of poles) clear.push([ijOf(p.cell), NEED.poleEsm]);
      if (gen !== null) clear.push([ijOf(gen.cell), NEED.genEsm]);
      for (const s of esmelterRows) clear.push([ijOf(s.cell), NEED.esmEsm]);
      const s = await placeNear(6, 'esmelter',
        along(anchor.pos, e, dir * touchM('pole', 'esmelter')), clear);
      if (s !== null) esmelterRows.push(s);
    }
  }
  await sleep(1.0);
  const placed = kindsPlaced();
  log.push(`placed: ${JSON.stringify(placed)}`);
  log.push('cells: ' + JSON.stringify(listed().map((b) => `${b.kind}@${b.cell}`)));
  check('poles are on the ground', (placed.pole ?? 0) >= 1, JSON.stringify(placed));
  check('a generator is on the ground', (placed.generator ?? 0) >= 1,
    JSON.stringify(placed));
  const smelters = placed.esmelter ?? 0;
  check('electric smelters went down', smelters >= 1, smelters);
  check('all four electric smelters went down', smelters === 4, smelters);

  // EVERY PAIR AGAINST `stepsFor`, off the two placements' own cell keys. This
  // is the assertion the eight bearings never carried: integers from the keys
  // the save is written with, compared with the table the geometry is derived
  // from, so a layout that goes stale again says so in one line.
  const tooClose = [];
  const cluster = listed();
  for (let a = 0; a < cluster.length; ++a) {
    for (let b = a + 1; b < cluster.length; ++b) {
      const need = stepsFor(cluster[a].kind, cluster[b].kind);
      const got = cheb(ijOf(cluster[a].cell), ijOf(cluster[b].cell));
      if (got >= 0 && got < need) {
        tooClose.push(`${cluster[a].kind}@${cluster[a].cell} to `
          + `${cluster[b].kind}@${cluster[b].cell}: ${got} cells, `
          + `${need} required`);
      }
    }
  }
  check('no pair in the finished cluster overlaps', tooClose.length === 0,
    JSON.stringify(tooClose));

  const netNow = () => of.game().progress.power;
  const hoppers = () => listed().filter((b) => b.kind === 'esmelter')
    .map((b) => b.input ?? 0);
  /**
   * Walk up to a placed machine and load it through its own panel.
   *
   * FS-146: THE TARGET IS THE MACHINE, NOT A BEARING. This took a `dyaw, pitch`
   * pair out of the same stale layout the placements did, which made the feed
   * sweep inherit every one of that layout's assumptions AND added one of its
   * own: a fixed bearing from a fixed standing spot is only in pick range while
   * the cluster stays small, and `PICK_REACH_PAST_SURFACE_M` (3.5 m past the
   * SURFACE, so 5.5 m to a 4 m smelter's centre) is now smaller than the cluster
   * the placement rule forces. So it walks: `walkTo` returns at once when the
   * player is already inside `stopM`, so the near machines cost one aim.
   */
  const stop = async (machine) => {
    await walkTo(machine.pos, 3.2);
    aimAtPoint(machine.pos);
    await sleep(0.15);
    // GP-163: E OPENS the machine now, and the feed is a button on its panel,
    // which is the same verb a player runs. This is also SHARPER than the old
    // crosshair feed: the panel is one named machine, so the sweep that used
    // to refuel the generator "on the way" to a smelter (the GP-50 note below)
    // now feeds exactly the machine it opened.
    of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 8, keys: [] }]);
    await sleep(0.25);
    const b = document.querySelector('#of-furnace button[data-load]');
    if (b !== null) { b.click(); await sleep(0.1); }
    of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 8, keys: [] }]);
    await sleep(0.2);
  };
  const dry = netNow();
  check('the grid is ON now that something electrical exists',
    dry.enabled === true, JSON.stringify(dry));
  check('an unfuelled generator offers ZERO capacity',
    (dry.capacityW[0] ?? -1) === 0, JSON.stringify(dry.capacityW));

  // ======================================================================
  // FS-147: THE GATE, AND IT IS A REAL DEFECT IN THE GAME RATHER THAN IN THIS
  // FILE. IT IS ASSERTED HERE BECAUSE EVERY ELECTRICAL CLAIM BELOW DEPENDS ON
  // IT, so one named red is worth more than eight downstream ones.
  //
  // A CONSUMER JOINS THE NEAREST POLE WHOSE SUPPLY RADIUS COVERS IT, CENTRE TO
  // CENTRE (`power.h`, and `Power.generatorOffGrid`'s comment says so at
  // length). The placement rule puts a 4 m electric smelter at the MATING
  // DISTANCE from a 1 m pole and no nearer, and after FS-73 that is 3 cells.
  // Measured on the shipped build, an electric smelter standing at the closest
  // cell the rule allows is 3.000 m from its pole and comes back `network: -1`,
  // while a 2 m generator at ITS closest legal cell is 2.000 m out and attaches
  // fine. So the two rules disagree by exactly the half-cell an even footprint
  // leaves (`ceil((1 + 4) / 2)` is 3 where the housings touch at 2.5), and no
  // legal layout of any shape can put an electric smelter on a tier-0 grid.
  //
  // THE FIX IS NOT IN THIS FILE AND NOT IN THIS LANE. `poleClassDef` is a
  // /core balance table (`power.h`), which is another domain's constant and a
  // WASM rebuild, and the factory lane's own FS-73 note already flags the
  // interaction from the GENERATOR side (it deferred widening the generator
  // for exactly this reason) without noticing that it had just rescaled the
  // CONSUMER, which the same radius attaches. Recorded in NUMBERS.md under
  // FS-144 to FS-158 and routed.
  //
  // THE ASSERTION CARRIES NO COPY OF THE RADIUS, deliberately: `Power.ts`
  // refuses to mirror /core's 2.5 because "a mirrored 2.5 here would go stale
  // silently and would be believed", and a probe that retyped it would be that
  // same second authority with a `check` around it. It reports the MEASURED
  // pole-to-smelter distance and asks /core whether the machine is on a
  // network, which is the question and not a restatement of the constant.
  const nearestPoleM = (b) => Math.min(...listed()
    .filter((p) => p.kind === 'pole')
    .map((p) => Math.hypot(b.pos[0] - p.pos[0], b.pos[1] - p.pos[1],
      b.pos[2] - p.pos[2])));
  const coverage = listed().filter((b) => b.kind === 'esmelter')
    .map((b) => ({ cell: b.cell, poleM: +nearestPoleM(b).toFixed(4),
      network: b.network }));
  log.push('COVERAGE: ' + JSON.stringify(coverage));
  log.push(`attached: ${dry.consumersAttached} consumer(s), `
    + `${dry.generatorsAttached} generator(s)`);
  const powered = (dry.consumersAttached ?? 0) > 0;
  check('a smelter standing at the closest cell the placement rule allows is '
    + 'inside a pole supply area', powered,
    `${dry.consumersAttached} of ${smelters} attached; nearest pole `
    + `${JSON.stringify(coverage.map((c) => c.poleM))} m; the mating distance `
    + `is ${NEED.poleEsm} cells and a pole supply radius is /core's constant`);
  check('the generator, whose mating distance is shorter, DID attach',
    (dry.generatorsAttached ?? 0) > 0, dry.generatorsAttached);

  // ======================================================================
  // 2. THE DEFICIT REGIME, AND IT IS BUILT DELIBERATELY RATHER THAN HOPED FOR.
  //
  //    Feed the smelters BEFORE fuelling the generator. That is a real state a
  //    player reaches on their first grid (the poles are up, the machine is
  //    loaded, nobody has put coal in yet) and it is the sharpest possible
  //    reading: demand is real, capacity is zero, so satisfaction is EXACTLY
  //    zero and the verdict must say SHORT. A panel that derived its
  //    percentage from anything but /core's own integer cannot land on 0 here.
  // ======================================================================
  // ONLY THE SMELTERS. The first version swept the whole layout, which walks
  // past the generator and refuels it on the way, so the "starved" reading was
  // taken on a fully powered grid and read a serene 65536. The machine being
  // measured must be the only one the sweep touches. The list is now the rows
  // that actually LANDED rather than the bearings that were aimed at, which is
  // the same correction the placements got.
  const SMELT_AT = () => listed().filter((b) => b.kind === 'esmelter');
  of.hotbar(1);
  await sleep(0.15);
  for (let round = 0; round < 3; ++round) {
    for (const b of SMELT_AT()) await stop(b);
    if (hoppers().filter((h) => h > 0).length > 0) break;
  }
  await sleep(0.1);
  const starved = netNow();
  // FS-147: CONDITIONAL ON THE GATE ABOVE, in this file's own existing style
  // (`trulyStarved` and `fourSmelters` are already conditions with the
  // condition reported). A machine on no network draws no watts by design, so
  // asserting demand here while the gate is red would be a second red for one
  // cause and would make the real one harder to find. The condition is
  // published in the result, so a run that could not test this says so rather
  // than passing by not testing.
  if (powered) {
    check('a fed smelter demands watts with no generator running',
      (starved.demandW[0] ?? 0) > 0, JSON.stringify(starved.demandW));
    check('demand is a whole number of 30 kW smelters',
      (starved.demandW[0] ?? 0) % 30000 === 0, starved.demandW[0]);
  }
  // NOT ASSERTED, AND THE REASON IS THE FINDING RATHER THAN AN EXCUSE. The
  // intent was to read a network with real demand and no supply, whose
  // satisfaction is EXACTLY zero. It cannot be driven from the crosshair: a
  // small pole supplies 2.5 m, so a working grid is a cluster about two metres
  // across, and `Factory.pick` resolves an aim to the BEST-CENTRED building
  // within 3.5 m. Every bearing that reaches a smelter also reaches the
  // generator beside it, so the sweep meant to feed one machine refuels the
  // other on the way and the "starved" network is powered before it is read.
  // Recorded as GP-50 rather than worked around, because the honest fix is a
  // BELT into the smelter (which is what a belt is FOR) and that is a bigger
  // change than this run should carry. A threshold tuned until it passed would
  // have been the standing-rule-11 failure exactly.
  // FS-147: AND IT NOW MEANS WHAT ITS NAME SAYS. "Truly starved" is real demand
  // with no supply; `capacity === 0` alone is also true of a network with no
  // consumer on it at all, which is the state the coverage gate above reports,
  // and a verdict of SHORT is not what /core computes for a network demanding
  // nothing. The two states are different and this now distinguishes them.
  const trulyStarved = powered && starved.capacityW[0] === 0
    && (starved.demandW[0] ?? 0) > 0;
  if (trulyStarved) {
    check('an unpowered network is EXACTLY zero satisfied',
      starved.satisfactionQ16[0] === 0, starved.satisfactionQ16[0]);
  }
  log.push(`STARVED: demand ${starved.demandW[0]} W, capacity `
    + `${starved.capacityW[0]} W, q16 ${starved.satisfactionQ16[0]}`);

  await press('KeyU');
  await sleep(0.5);
  const domA = (f) => document.querySelector(`#of-power [data-power="${f}"]`);
  const rawA = (f) => {
    const e = domA(f);
    if (e === null) return null;
    const w = e.getAttribute('data-w');
    return Number(w !== null ? w : e.textContent);
  };
  check('the panel drew the DEFICIT as /core computed it',
    rawA('q16:0') === starved.satisfactionQ16[0]
    && rawA('demand:0') === starved.demandW[0]
    && rawA('capacity:0') === starved.capacityW[0],
    `${rawA('q16:0')}/${rawA('demand:0')}/${rawA('capacity:0')}`);
  if (trulyStarved) {
    check('and the verdict says SHORT',
      domA('verdict:0')?.getAttribute('data-kind') === 'short',
      domA('verdict:0')?.getAttribute('data-kind'));
  }
  log.push(`panel, starved: q16 ${rawA('q16:0')}, verdict `
    + `"${domA('verdict:0')?.getAttribute('data-kind')}"`);
  await press('KeyU');
  await sleep(0.3);

  // ======================================================================
  // 3. NOW FUEL IT, and the same network flips to the surplus regime.
  // ======================================================================
  const coalBefore = pack().Coal ?? 0;
  const GEN_AT = () => listed().filter((b) => b.kind === 'generator');
  // Fuel it, then top the hoppers up, then read at once: 20 units at 30 ticks
  // is 600 ticks of runway and this pass is far shorter than that.
  for (let i = 0; i < 3; ++i) for (const b of GEN_AT()) await stop(b);
  for (const b of SMELT_AT()) await stop(b);
  await sleep(0.1);
  const live = netNow();
  const coalAfter = pack().Coal ?? 0;
  const working = listed().filter((b) => b.kind === 'esmelter' && b.working).length;
  // Counted rather than differenced across this phase, because the sweep above
  // already refuelled it: `fuelInserted` is cumulative and is the honest
  // measure of whether the verb ever fired.
  check('E on the generator put coal in it at some point',
    (live.fuelInserted ?? netNow().fuelInserted ?? 0) > 0
    || coalAfter < coalBefore, `${coalBefore} -> ${coalAfter}`);
  check('a fuelled generator offers its rated 90 kW',
    (live.capacityW[0] ?? 0) === 90000, JSON.stringify(live.capacityW));
  // FS-147: conditional for the same reason the demand assertions above are. A
  // smelter on no network is not slow, it is unpowered, and /core stops it by
  // design; asserting it runs would be asserting the coverage gate twice.
  if (powered) {
    check('smelters are RUNNING when the reading is taken', working > 0,
      `${working} of ${smelters}`);
  }
  log.push(`fuelled and fed: capacity ${live.capacityW[0]} W, `
    + `demand ${live.demandW[0]} W, q16 ${live.satisfactionQ16[0]}, `
    + `working ${working}`);
  log.push('machines: ' + JSON.stringify(listed()
    .filter((b) => b.kind === 'esmelter' || b.kind === 'generator')
    .map((b) => ({ k: b.kind, build: b.build, grid: b.grid, in: b.input,
      out: b.output, work: b.working, net: b.network, fuel: b.fuel }))));

  // ======================================================================
  // 4. THE PANEL IS /core's NUMBER. Opened with a real key, read out of the
  //    DOM, compared field by field in the same frame.
  // ======================================================================
  await press('KeyU');
  await sleep(0.5);
  const panel = document.querySelector('#of-power');
  check('the power panel opened on U',
    !!panel && panel.classList.contains('open'), panel?.className);
  const dom = (field) => document.querySelector(`#of-power [data-power="${field}"]`);
  const raw = (field) => {
    const e = dom(field);
    if (e === null) return null;
    const w = e.getAttribute('data-w');
    return Number(w !== null ? w : e.textContent);
  };
  const core = netNow();
  check('the panel drew the network', !!dom('q16:0'), 'no q16 element');
  const q16Dom = raw('q16:0');
  check('the PANEL q16 equals /core q16 exactly',
    q16Dom === core.satisfactionQ16[0], `${q16Dom} vs ${core.satisfactionQ16[0]}`);
  check('the PANEL demand equals /core demand exactly',
    raw('demand:0') === core.demandW[0], `${raw('demand:0')} vs ${core.demandW[0]}`);
  check('the PANEL capacity equals /core capacity exactly',
    raw('capacity:0') === core.capacityW[0],
    `${raw('capacity:0')} vs ${core.capacityW[0]}`);
  check('the PANEL production equals /core production exactly',
    raw('production:0') === core.productionW[0],
    `${raw('production:0')} vs ${core.productionW[0]}`);
  log.push(`panel: q16 ${q16Dom}, demand ${raw('demand:0')} W, `
    + `capacity ${raw('capacity:0')} W, verdict `
    + `"${dom('verdict:0')?.getAttribute('data-kind')}"`);

  // ======================================================================
  // 5. THE FOUR-SMELTER CASE, and it is arithmetic rather than a tolerance.
  // ======================================================================
  const cap = core.capacityW[0] ?? 0;
  const demand = core.demandW[0] ?? 0;
  const expected = cap <= 0 ? 0
    : demand <= 0 ? Q16
      : cap >= demand ? Q16
        : Math.floor((cap * Q16) / demand);
  check('satisfaction is EXACTLY /core\'s own integer arithmetic',
    core.satisfactionQ16[0] === expected,
    `${core.satisfactionQ16[0]} vs ${expected} (cap ${cap}, demand ${demand})`);
  // The named case, when the placement happened to give us four smelters on
  // one 90 kW generator. Asserted only when the topology is the one the claim
  // is about, and REPORTED either way, so a run that could not place four says
  // so rather than passing by not testing.
  // THE HEADLINE, and it is arithmetic rather than a tolerance. Asserted on the
  // DEMAND actually drawn rather than on how many machines were placed, because
  // a starved smelter draws nothing and counting the buildings would make the
  // claim true of a base that was doing half of what it looked like.
  const fourSmelters = demand === 120000 && cap === 90000;
  const threeSmelters = demand === 90000 && cap === 90000;
  // The DEFICIT regime is proven above, deterministically, on the starved
  // network. THIS reading is the surplus one, so the assertion here is the
  // identity rather than the inequality.
  if (fourSmelters) {
    check('four 30 kW smelters on one 90 kW generator read 49152 EXACTLY',
      core.satisfactionQ16[0] === 49152, core.satisfactionQ16[0]);
    check('and the panel drew that same 49152', q16Dom === 49152, q16Dom);
    check('and the verdict says SHORT rather than balanced',
      dom('verdict:0')?.getAttribute('data-kind') === 'short',
      dom('verdict:0')?.getAttribute('data-kind'));
  }
  if (threeSmelters) {
    check('three 30 kW smelters on one 90 kW generator read 65536 EXACTLY',
      core.satisfactionQ16[0] === Q16, core.satisfactionQ16[0]);
  }

  await press('KeyU');
  await sleep(0.3);

  return {
    valid: fails.length === 0,
    fails,
    log,
    smelters, working, trulyStarved,
    // FS-146/FS-147: the layout that was built and whether the grid could reach
    // it, published so a red is readable without re-running. `powered` is the
    // condition every electrical assertion below the gate is skipped on.
    powered,
    coverage,
    matingCells: NEED,
    footprint: FP,
    tooCloseInCluster: tooClose,
    coalMined: coal,
    oreMined: ore,
    orePack: pack()['Raw iron'] ?? 0,
    fourSmelterCase: fourSmelters,
    threeSmelterCase: threeSmelters,
    core: netNow(),
    panel: { q16: q16Dom, demand: raw('demand:0'), capacity: raw('capacity:0'),
      production: raw('production:0') },
    ticks: of.world().tick,
  };
})()
