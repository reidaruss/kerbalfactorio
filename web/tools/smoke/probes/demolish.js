// W6 DEMOLITION probe: a line runs, a belt is pulled out of the MIDDLE of it,
// the line stops, the belt goes back, and the line runs again.
//
// WHY THE MIDDLE TILE. Removing the end of a run proves almost nothing: the
// topology barely changes and the smelter keeps whatever was already in it.
// Removing a tile from the middle splits ONE transport line into TWO, and the
// half that reaches the smelter is no longer fed by the miner. If the rebuild
// were wrong in any of the obvious ways (stale runs, stale inserters, a network
// that was never re-wired) the smelter would keep producing and this probe would
// pass. So the assertion is the negative one: production must STOP.
//
// DW-20 EVERYWHERE. Each window checks /core's own tick counter moved by the
// expected amount BEFORE its numbers count, and every claim is a delta measured
// across a window rather than a state read once. The stall window is the same
// length as the running window, so "it stopped" is not "we did not wait".
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const eye = () => { const o = of.aim().origin; return { x: o[0], y: o[1], z: o[2] }; };
  const ore = () => of.nodes().find((n) => n.kind === 3 && n.remaining > 20)
            ?? of.nodes().find((n) => n.kind === 2 && n.remaining > 20);
  const fac = () => of.game().factory;
  const ironIn = () => (of.game().carried.find((c) => c.name === 'Iron') ?? { count: 0 }).count;

  await sleep(0.5);
  let node = ore();
  if (node === undefined) return { fail: 'no ore node in the clearing' };

  // --- face the deposit (autoline.js's search, guard and all) -----------------
  // `miss` is +Infinity BEHIND the eye: without that guard a heading 180 degrees
  // wrong scores as well as the right one, and the walk goes the wrong way while
  // reporting a good aim. That defect was found in this harness, not in the game.
  const miss = () => {
    const a = of.aim();
    const e = { x: a.origin[0], y: a.origin[1], z: a.origin[2] };
    const v = { x: node.x - e.x, y: node.y - e.y, z: node.z - e.z };
    const t = v.x * a.dir[0] + v.y * a.dir[1] + v.z * a.dir[2];
    if (t <= 0) return Infinity;
    return Math.hypot(v.x - a.dir[0] * t, v.y - a.dir[1] * t, v.z - a.dir[2] * t);
  };
  const aimAt = () => {
    let best = of.world().observer.yawDeg;
    for (const step of [20, 5, 1.5]) {
      const span = step === 20 ? 9 : 5;
      let bestMiss = Infinity;
      let bestYaw = best;
      for (let k = -span; k <= span; ++k) {
        of.look(best + k * step, -8);
        const m = miss();
        if (m < bestMiss) { bestMiss = m; bestYaw = best + k * step; }
      }
      best = bestYaw;
    }
    of.look(best, -8);
  };
  aimAt();

  // WALK ONTO THE PATCH, not up to it. A deposit is an area of ground 6 to 11 m
  // across holding one pool, not a boulder: a drill is accepted anywhere on it
  // including the far rim, where the ore is worth a fifth of what the middle is
  // worth and the whole line is strung out at the limit of the build reach.
  let walked = 0;
  let best = dist(eye(), node);
  let worse = 0;
  for (let i = 0; i < 45; ++i) {
    node = of.nodes().find((n) => n.index === node.index) ?? node;
    const d = dist(eye(), node);
    if (d < 5.0) break;
    if (d < best - 0.05) { best = d; worse = 0; }
    else if (++worse >= 2) { aimAt(); worse = 0; }
    of.input.tape([{ hold: 60, keys: ['KeyW'] }]);
    await sleep(1.1);
    walked++;
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.2);
  aimAt();
  const standoff = dist(eye(), node);
  log.push(`walked ${walked} bursts to ${standoff.toFixed(2)} m`);
  if (standoff > 10.6) return { fail: 'the walk never reached the deposit', standoff, log };

  // --- lay the line ----------------------------------------------------------
  // The line runs from the DRILL at the far end back towards the player, with
  // the smelter nearest, and it is laid with ONE PRESS AND HOLD of the left
  // button rather than one press per tile.
  //
  // WHAT MAKES IT ONE TRANSPORT LINE, which is what this probe needs a middle
  // OF. A belt chains to its nearest neighbour on the ground within 1.35 m and
  // 0.85 of alignment (FactoryWiring). A pitch sweep placing one tile at a time
  // had to satisfy that by luck: pitch is nowhere near linear in ground distance
  // and a coarse sweep steps clean over whole cells, which is how the old 1.2
  // degree sweep here laid four tiles that were three separate runs. A DRAG
  // satisfies it by construction, because `BuildMode.dragRun` fills every cell
  // between the head of the run and the crosshair and turns each tile to point
  // at its successor.
  //
  // NEIGHBOUR IS STILL MEASURED, though it no longer has to be. A machine used
  // to snap to /core's 1 m body-frame voxel lattice, which the ground sphere
  // cuts obliquely, so one unit step of a cell key covered 0.59, 0.81 or 1.02 m
  // of ground depending on the axis and consecutive cell keys proved nothing.
  // Machines snap to the metric SITE grid now (MachinePlacement.ts) and a face
  // neighbour is exactly 1.000 m. The band below is kept because it still says
  // the useful thing: it separates a face neighbour (1.000) from a boundary
  // re-read (0) and from a DIAGONAL (1.414), which is a cell skipped sideways.
  let yaw = of.world().observer.yawDeg;
  const placeHere = async () => {
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
    await sleep(0.16);
  };
  const rotateTo = async (q) => {
    while (of.build().rotation !== q) {
      of.input.tape([{ hold: 3, keys: ['KeyR'] }, { hold: 3, keys: [] }]);
      await sleep(0.12);
    }
  };
  const ghostAt = async (y, p) => {
    of.look(y, p);
    await sleep(0.035);
    return of.build().ghost;
  };
  const gdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const fromEye = (g) => { const e = eye(); return gdist(g.pos, [e.x, e.y, e.z]); };
  // The band a genuine grid neighbour lands in, in metres of ground. The
  // floor rejects a re-reading of the cell already dealt with; the ceiling
  // rejects a skipped cell, which is the failure that shatters a run.
  // ONLY VALID BELT-TO-BELT: both tiles are footprint 1, so FactorySnap's own
  // `stepsFor(belt, belt)` is `ceil((1+1)/2)` = 1 cell, i.e. a face neighbour.
  const NEAR = 0.5;
  const FAR = 1.25;
  // GP-770: A MACHINE IS NOT A BELT, and the band above silently assumed every
  // neighbour was one. `stepsFor(from, to)` (FactorySnap.ts) is
  // `Math.ceil((FOOTPRINT[from] + FOOTPRINT[to]) / 2)` cells, and FS-73 took
  // `smelter` and `miner` from footprint 2 to 4 (`FactoryKinds.FOOTPRINT`): a
  // belt-to-smelter or belt-to-miner mating is `ceil((1+4)/2)` = 3 cells, not
  // the 1-cell neighbour NEAR/FAR was built for. Measured directly on this
  // world (matching assembler.js's own GP-760 measurement of the identical
  // pair): a belt is 1.002 m per cell, so 3 cells is a real centre-to-centre
  // gap of ~3.006 m, not the ~1.25 m ceiling this probe used to enforce before
  // the ghost sweep below ever got there, which is why the smelter step broke
  // out of its loop (`d > 2.2`) on every candidate the real ghost offered.
  const FPT = of.game().factory.footprint;
  const CELL_M = 1.002;
  const machineBand = (kind) => {
    const cells = Math.max(1, Math.ceil((FPT.belt + FPT[kind]) / 2));
    const centre = cells * CELL_M;
    // Wide enough to absorb the sweep's own 0.25-degree pitch granularity and
    // ground curvature, narrow enough that an unrelated ghost several cells
    // further out cannot be mistaken for the mate.
    return { near: Math.max(NEAR, centre - 0.6), far: centre + 0.6 };
  };

  // 1: which yaw is a tangent axis, measured off the ghost's own flow direction.
  of.build(2);
  await rotateTo(2);
  {
    let bestYaw = yaw;
    let bestDot = -2;
    for (const [span, step] of [[23, 2], [5, 0.4]]) {
      let by = bestYaw;
      let bd = -2;
      for (let k = -span; k <= span; ++k) {
        const g = await ghostAt(bestYaw + k * step, -26);
        if (g === null) continue;
        const a = of.aim();
        // fwd points AWAY from the player at rotation 0 and back at 2, so the
        // alignment being sought here is anti-parallel.
        const d = -(a.dir[0] * g.fwd[0] + a.dir[1] * g.fwd[1] + a.dir[2] * g.fwd[2]);
        if (d > bd) { bd = d; by = bestYaw + k * step; }
      }
      bestYaw = by;
      bestDot = bd;
    }
    log.push(`flow axis: yaw ${yaw.toFixed(1)} -> ${bestYaw.toFixed(1)}, `
      + `dot ${bestDot.toFixed(3)}`);
    yaw = bestYaw;
  }

  // 2: THE BELTS, LAID AS ONE HOLD-DRAG, AND THE DRILL STILL LAST.
  //
  // The ORDER is not cosmetic, it is what makes the stall window measurable. A
  // drill placed first mines into its own 50-unit out-slot for the whole of the
  // time it takes to lay the rest of the line, and the moment the line closes
  // that backlog floods the smelter's input. The smelter then has a minute of
  // ore inside it that no belt has to deliver, so pulling the belt out stops
  // nothing a fourteen second window can see. Building the empty line first and
  // switching the ore on last means the only residue at the removal is the
  // handful of units the drill outran the furnace by.
  //
  // EVERY NUMBER IN THIS SWEEP IS A GROUND POSITION, never a cell key. A machine
  // cell is an address on a SITE and no site has been adopted yet: until one
  // has, every ghost founds a fresh PROSPECTIVE site on the lattice cell under
  // its own aim point (MachinePlacement.siteAt), so every address it reports is
  // 0,0 and two aims five metres apart cannot be told apart. The press that
  // starts the drag adopts a site, and from there addresses mean something.
  //
  // The drag itself replaces a pitch sweep that placed one tile at a time and
  // had to dodge the old lattice's uneven steps to keep consecutive tiles each
  // other's neighbours. `BuildMode.dragRun` fills every cell between the head of
  // the run and wherever the crosshair is and turns each tile to point at its
  // successor, so the run is chained BY CONSTRUCTION, which is exactly what this
  // probe needs a middle OF.
  of.build(2);
  await rotateTo(2);
  const beltSweep = [];
  for (let p = -12; p >= -52; p -= 0.3) {
    const g = await ghostAt(yaw, p);
    if (g === null) continue;
    beltSweep.push({ pitch: p, ok: g.ok, pos: g.pos, reachM: +fromEye(g).toFixed(2) });
  }
  // THE TAIL goes as far out as still leaves a cell BEYOND it for the drill,
  // which has to stay inside the 9 m build reach.
  const tailAim = beltSweep.filter((s) => s.ok && s.reachM <= 7.7)
    .reduce((a, b) => (a === null || b.reachM > a.reachM ? b : a), null);
  if (tailAim === null) return { fail: 'no belt cell inside the reach band', log };
  // THE HEAD comes back towards the feet. FOUR belts, which is what this probe
  // asked for before it was stretched to five to dodge FS-17.
  //
  // It was stretched because `wire` linked any SOURCE that touched a run's tail,
  // a smelter is a source, and belt-to-smelter reach is 2.25 m: on a short line
  // the smelter ended up wired onto the TAIL of the very run whose head feeds it,
  // its first ingot rode to the head and stuck there for ever, and the line
  // deadlocked. The wiring is fixed now, so the length is chosen for what this
  // probe is actually about (a run long enough to HAVE a middle) rather than to
  // stay clear of a defect, and `linksToTail` below asserts the fix directly.
  //
  // FOUR NO LONGER REACHES THE SHORT-CIRCUIT GEOMETRY, and that is worth saying
  // out loud. The "four belts" figure was measured before machines moved onto the
  // metric site grid, when a lattice step was 0.59 to 1.02 m of ground. Tiles are
  // exactly 1.002 m apart now, so the tail of a four-tile run stands 4.0 m from
  // the smelter and cannot be linked to it whatever the wiring says. The shape
  // that DOES form the loop today is a drill plus TWO belts plus a smelter
  // (tail 2.0 m, inside 2.25 m), and `probes/shortline.js` is that case.
  let headAim = null;
  for (const s of beltSweep) {
    if (!s.ok || s.pitch >= tailAim.pitch) continue;
    if (gdist(s.pos, tailAim.pos) > 3.35) break;
    headAim = s;
  }
  if (headAim === null || gdist(headAim.pos, tailAim.pos) < 2.6) {
    return { fail: 'no room for four belts on this heading', tailAim, headAim, log };
  }
  of.look(yaw, tailAim.pitch);
  await sleep(0.25);
  // ONE tape for the whole gesture. Two tapes would put a released frame between
  // them, which is a second PRESS and not a hold, and the drag would restart
  // from the new cell instead of running on.
  of.input.tape([{ hold: 300, actions: ['use'] }]);
  await sleep(0.3);
  of.look(yaw, headAim.pitch);
  await sleep(0.6);
  of.input.tape([{ hold: 6, keys: [] }]);
  await sleep(0.4);

  // The tiles the drag produced, IN RUN ORDER. The drag came back towards the
  // player, so the tail is the tile furthest from the eye and the head is the
  // nearest; ordering by measured distance beats assuming the plan's own order.
  const eyeNow = eye();
  // The pitch that looks at a tile is not something the drag knows: it laid the
  // whole run from two aims. It is recovered from the dry sweep, whose closest
  // sample to a tile is the aim that lands on it, and it is only ever a starting
  // guess: the rebuild below scans a band around it and then the whole sweep.
  const nearestPitch = (pos) => beltSweep
    .reduce((a, b) => (a === null || gdist(b.pos, pos) < gdist(a.pos, pos) ? b : a), null)
    .pitch;
  const laid = fac().list.filter((b) => b.kind === 'belt')
    .map((b) => ({ cell: b.cell, pos: b.pos, pitch: nearestPitch(b.pos),
      fromEyeM: gdist(b.pos, [eyeNow.x, eyeNow.y, eyeNow.z]) }))
    .sort((a, b) => b.fromEyeM - a.fromEyeM);
  const steps = [];
  for (let i = 1; i < laid.length; ++i) {
    steps.push(+gdist(laid[i - 1].pos, laid[i].pos).toFixed(3));
  }
  log.push(`drag laid ${laid.length} belts, steps ${steps.join('/')} m: `
    + laid.map((b) => b.cell).join(' | '));
  if (laid.length < 4) {
    return { fail: 'the drag did not carry four belts', steps, tailAim, headAim, log };
  }

  // 3: the smelter, on the cell in front of the run's HEAD. GP-770: the mating
  // distance is `machineBand('smelter')`, not the belt-to-belt band, because a
  // smelter is footprint 4 and a belt is footprint 1 (see the note above NEAR).
  of.build(3);
  let smelterAt = null;
  const headBelt = laid[laid.length - 1];
  const smelterBand = machineBand('smelter');
  log.push(`smelter mating band: ${smelterBand.near.toFixed(2)}-`
    + `${smelterBand.far.toFixed(2)} m`);
  for (let p = headAim.pitch - 0.2; p >= -62 && smelterAt === null; p -= 0.25) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok) continue;
    const d = gdist(g.pos, headBelt.pos);
    if (d < smelterBand.near) continue;
    if (d > smelterBand.far) break;         // beyond the belt head's reach
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) smelterAt = { cell: g.cell, pitch: p, pos: g.pos };
  }
  if (smelterAt === null) return { fail: 'the smelter would not go down at the head', log };

  // 4: the drill, on the cell just BEYOND the run's tail, which is ore-bearing
  // ground the belts deliberately stopped short of. THE ORE STARTS FLOWING HERE
  // and nowhere earlier.
  //
  // GP-770 fixed the smelter above; GP-771 is the drill, and it took THREE
  // measured attempts to land, all surfacing as the same "would not go down"
  // failure.
  //
  // FIRST: a blind pitch sweep, one fixed angular step at a time, is what this
  // loop used to be, and it does not survive out here: pitch is nowhere near
  // linear in ground distance approaching the horizon (the belt drag's own
  // header says as much for exactly this reason). MEASURED:
  // stepping the old 0.25-degree sweep from pitch -10.5 to -10.25 jumped the
  // aimed cell from "m1:1,3" straight to "m1:1,-3", five cells out in the WRONG
  // direction, past the smelter, skipping every cell between.
  //
  // SECOND, TRIED AND MEASURED WRONG: aiming precisely AT the tail belt's own
  // socket point (0.5 m behind its centre, `FPT.belt / 2`), the way
  // `assembler.js`'s `tailOut`/`chainStep` catches a socket for every OTHER
  // kind. `findGroundGhost` converged there exactly (missM 0.019) and found not
  // one `ok: true` ghost anywhere in a 9x9-degree spiral around it: a 4 m
  // footprint centred 0.5 m from an existing belt clashes with it every time,
  // "too close to #4 belt". `FactoryGhost.resolveGhost`'s own comment names the
  // reason this file's PREVIOUS pass missed: "A DRILL NEVER SNAPS... its
  // position is decided by the GROUND... Belts and smelters have no such
  // constraint, so they snap freely" (`kind === 'miner' && caught !== null`
  // moves ONLY the heading, never `s`, i.e. never the position). Every other
  // kind in this file (belt, smelter) gets teleported to the correct
  // `stepsFor`-computed cell by aiming near a socket; a miner never does. The
  // very defect this comment names ("the belt's tail socket proposed a cell
  // 2.000 m back that had no ore under it") is `probes/demolish.js` by name.
  //
  // THIRD, THE ACTUAL FIX: aim the raw ground point directly at the
  // intended CELL (three beyond the tail, `stepsFor(belt, miner)`), which is
  // what the SECOND attempt already did, but AT A FIXED YAW rather than one
  // `aimAtGround`'s coarse-to-fine search was free to wander. That freedom is
  // what broke the wiring the first time: this scene's whole flow axis was
  // measured once, early in this file, as the one yaw that lies along the
  // site's own tangent grid ("flow axis: yaw ... -> ..."), and every other
  // placement in this probe (the belt drag, the smelter) holds that exact
  // `yaw` fixed for exactly this reason. `FactoryGhost`'s default heading
  // (`headingIn`, taken when no socket is close enough to catch) resolves off
  // the AIM RAY's own direction; letting yaw drift a few degrees while chasing
  // a 3D point can converge on the position while resolving to the WRONG one
  // of the site's four cardinal headings, which is exactly what happened:
  // the SECOND attempt's placement measured `ok: true` at the right ground
  // cell and still produced a miner with `fac().links` carrying no entry,
  // because its outlet ended up facing away from the belt rather than at it.
  // So this hill-climbs PITCH ONLY, at the same fixed `yaw` the rest of the
  // scene already trusts, which keeps the resolved heading on the same axis
  // the smelter already proved works.
  of.build(1);
  let drill = null;
  const tailBelt = laid[0];
  const missToPoint = (t) => {
    const a = of.aim();
    const v = [t[0] - a.origin[0], t[1] - a.origin[1], t[2] - a.origin[2]];
    const u = v[0] * a.dir[0] + v[1] * a.dir[1] + v[2] * a.dir[2];
    if (u <= 0) return Infinity;
    return Math.hypot(v[0] - a.dir[0] * u, v[1] - a.dir[1] * u, v[2] - a.dir[2] * u);
  };
  /** Hill-climb PITCH ONLY, `yaw` held at the scene's own flow axis. */
  const aimPitchTo = (t) => {
    let p = of.world().observer.pitchDeg;
    for (const step of [12, 4, 1, 0.25, 0.06]) {
      let bestM = Infinity, bp = p;
      for (let b = -6; b <= 6; ++b) {
        const pp = Math.max(-88, Math.min(20, p + b * step));
        of.look(yaw, pp);
        const m = missToPoint(t);
        if (m < bestM) { bestM = m; bp = pp; }
      }
      p = bp;
    }
    of.look(yaw, p);
    return p;
  };
  const findGroundGhost = async (t, pred, diag) => {
    const p0 = aimPitchTo(t);
    const missM = +missToPoint(t).toFixed(3);
    let bestOk = null;
    for (let k = 0; k <= 16; ++k) {
      const off = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 0.3;
      const pp = Math.max(-88, Math.min(20, p0 + off));
      const g = await ghostAt(yaw, pp);
      if (g === null) continue;
      if (g.ok && bestOk === null) {
        bestOk = { cell: g.cell, patch: g.patch, snapped: g.snapped, fwd: g.fwd };
      }
      if (pred(g)) return { g, pitch: pp };
    }
    if (diag) diag.push({ p0: +p0.toFixed(2), missM, bestOk });
    return null;
  };
  // GP-771, CONTINUED. `FactoryGhost.march`'s ray gives up at `REACH_M` =
  // 9 m, and the belt tail already stands up to `tailAim`'s own 7.7 m out from
  // where the player is still standing (nothing has walked since the drag).
  // Three more cells beyond it is past 9 m from the player, so the march
  // cannot reach the true target AT ALL: the fixed-yaw pitch sweep above
  // measured this directly, bouncing between only two reachable site cells
  // ("m1:1,-3" and "m1:1,3", both already occupied) and never once landing on
  // "m1:1,4" or "m1:1,5", because the ray simply runs out before it gets
  // there. So the player walks toward the target FIRST, the same distance
  // `walkTo` covers everywhere else in this file, using a free-yaw aim only
  // for STEERING (never for the placement itself, which stays on the scene's
  // fixed flow axis once the walk is done).
  const aimFreeToWalk = (t) => {
    let y = of.world().observer.yawDeg;
    let p = of.world().observer.pitchDeg;
    for (const step of [16, 4, 1]) {
      let bestM = Infinity, by = y, bp = p;
      for (let a = -6; a <= 6; ++a) {
        for (let b = -6; b <= 6; ++b) {
          of.look(y + a * step, Math.max(-88, Math.min(20, p + b * step)));
          const m = missToPoint(t);
          if (m < bestM) { bestM = m; by = y + a * step; bp = p + b * step; }
        }
      }
      y = by; p = Math.max(-88, Math.min(20, bp));
    }
    of.look(y, p);
  };
  const walkToPoint = async (t, stopM) => {
    aimFreeToWalk(t);
    const d0 = () => { const e = eye(); return Math.hypot(e.x - t[0], e.y - t[1], e.z - t[2]); };
    let d = d0();
    for (let i = 0; i < 20 && d > stopM; ++i) {
      const frames = Math.max(5, Math.min(60, Math.round(((d - stopM * 0.7) / 4.6) * 60)));
      of.input.tape([{ hold: frames, keys: ['KeyW'] }, { hold: 2, keys: [] }]);
      await sleep(1.1);
      aimFreeToWalk(t);
      d = d0();
    }
    of.input.tape([{ hold: 2, keys: [] }]);
    await sleep(0.2);
    return +d.toFixed(2);
  };
  const drillCells = Math.max(1, Math.ceil((FPT.belt + FPT.miner) / 2));
  const tailDir = (() => {
    const prev = laid[1] ?? tailBelt;
    const v = [tailBelt.pos[0] - prev.pos[0], tailBelt.pos[1] - prev.pos[1],
      tailBelt.pos[2] - prev.pos[2]];
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n];
  })();
  const drillTries = [];
  let drillFound = null;
  // GROWN OUTWARD FROM THE MATING DISTANCE, not fixed there: the ore-bearing
  // ground the belts stopped short of does not necessarily start exactly 3
  // cells out. The same "try in turn, do not compute one more single guess a
  // rescale falsifies again" shape GP-690's `placeUntil` and this lane's own
  // `standCandidatesFor` (assembler.js, GP-760) already use.
  for (let n = drillCells; n <= drillCells + 6 && drillFound === null; ++n) {
    const target = [tailBelt.pos[0] + tailDir[0] * n * CELL_M,
      tailBelt.pos[1] + tailDir[1] * n * CELL_M, tailBelt.pos[2] + tailDir[2] * n * CELL_M];
    const standAt = [target[0] - tailDir[0] * 3.2, target[1] - tailDir[1] * 3.2,
      target[2] - tailDir[2] * 3.2];
    const walkedTo = await walkToPoint(standAt, 1.0);
    const diag = [];
    const r = await findGroundGhost(target, (g) => g.ok && g.patch >= 0, diag);
    drillTries.push({ n, cell: r?.g.cell ?? null, found: r !== null, walkedTo, ...diag[0] });
    if (r !== null) drillFound = r;
  }
  log.push(`drill target search: ${JSON.stringify(drillTries)}`);
  if (drillFound !== null) {
    of.look(yaw, drillFound.pitch);
    await sleep(0.2);
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) {
      const row = fac().list.find((b) => b.kind === 'miner');
      drill = { id: row.id, cell: drillFound.g.cell, pitch: drillFound.pitch,
                pos: drillFound.g.pos, fwd: drillFound.g.fwd, rate: drillFound.g.ratePerSec,
                reachM: +fromEye(drillFound.g).toFixed(2) };
    }
  }
  of.build(0);
  if (drill === null) {
    return { fail: 'the drill would not go down on the cell beyond the tail',
             build: of.build(), tailBelt, drillTries, log };
  }
  // THE WIRING IS CHECKED HERE, RIGHT AWAY, BECAUSE GP-771 PLACED A "VALID"
  // GHOST THAT NEVER FED ANYTHING. `fac().links` naming an entry FROM the
  // drill's own id is the only claim that actually matters; a `g.ok: true`
  // ghost proves no clash, not a connection.
  const drillLinked = fac().links.some((l) => l.from === drill.id);
  log.push(`drill outlet [${drill.fwd.map((v) => v.toFixed(3)).join(' ')}], `
    + `linked to a run: ${drillLinked}`);
  log.push(`drill at pitch ${drill.pitch.toFixed(1)} cell ${drill.cell}, `
    + `${drill.rate.toFixed(2)} ore/s, ${drill.reachM} m out`);
  log.push(`line: ${fac().buildings} buildings, ${laid.length} belts, `
    + `runs [${fac().runs.map((r) => r.tiles)}]`);
  // THE TOPOLOGY IS CHECKED BEFORE ANYTHING IS MEASURED, because every number
  // below is meaningless on a line that is secretly three lines or that has the
  // smelter wired backwards onto its own belt. Both failures are invisible: the
  // tiles look like a straight line either way.
  const tailToSmelter = gdist(laid[0].pos, smelterAt.pos);
  const drillToSmelter = gdist(drill.pos, smelterAt.pos);
  // WHICH BUILDINGS ARE WIRED TO WHICH, by plan id, straight off the report.
  // The deadlock is a WIRING fact, not a throughput one: an inserter between
  // the smelter and the tail of the run whose head feeds it. Asserting the
  // wiring means this probe fails for the original REASON and not merely
  // because some number came out low.
  const smelterId = () => fac().list.find((b) => b.kind === 'smelter')?.id ?? -1;
  const wiring = () => {
    const f = fac();
    const s = smelterId();
    const tails = new Set(f.runs.map((r) => r.tail));
    const heads = new Set(f.runs.map((r) => r.head));
    return {
      links: f.links,
      // The defect, stated exactly. Must be 0.
      linksToTail: f.links.filter((l) => l.from === s && tails.has(l.to)).length,
      linksFromHead: f.links.filter((l) => heads.has(l.from) && l.to === s).length,
    };
  };
  const wired = wiring();
  const shape = {
    runs: fac().runs, tailToSmelter: +tailToSmelter.toFixed(2),
    drillToSmelter: +drillToSmelter.toFixed(2),
    drillToTail: +gdist(drill.pos, laid[0].pos).toFixed(2),
    headToSmelter: +gdist(laid[laid.length - 1].pos, smelterAt.pos).toFixed(2),
    // Is the smelter actually inside belt-to-smelter reach of the TAIL? When
    // this is true the old wiring DID form the loop, so the run below is a
    // regression test rather than a hopeful one.
    shortCircuitGeometry: tailToSmelter <= 2.25,
    ...wired,
  };
  log.push('shape: ' + JSON.stringify(shape));
  // 2.75 m is drill-to-smelter reach (FactoryWiring.touch on FOOTPRINT). Inside
  // it the drill hands ore straight to the smelter and the belts are decoration
  // the removal cannot interrupt, which would make the stall window meaningless.
  if (fac().runs.length !== 1 || fac().runs[0].tiles !== laid.length) {
    return { fail: 'the belts did not chain into one run', shape, plan: fac().list, log };
  }
  if (drillToSmelter <= 2.8) {
    return { fail: 'the drill hands straight to the smelter, the belts are decoration',
             shape, log };
  }

  // --- WINDOW A: the line runs unattended ------------------------------------
  const WINDOW = 14;
  const smelter = () => fac().list.find((b) => b.kind === 'smelter');
  const measure = async (label) => {
    const t0 = fac();
    const s0 = t0.list.find((b) => b.kind === 'smelter');
    const iron0 = ironIn();
    await sleep(WINDOW);
    const t1 = fac();
    const s1 = t1.list.find((b) => b.kind === 'smelter');
    // The smelter's buffer can be emptied by nothing here, so "produced" is the
    // buffer delta plus anything that reached the pack.
    const produced = (s1 === undefined ? 0 : s1.output) - (s0 === undefined ? 0 : s0.output)
      + (ironIn() - iron0);
    const m1 = t1.list.find((b) => b.kind === 'miner');
    const w = {
      label,
      coreTicks: t1.coreTicks - t0.coreTicks,
      expected: WINDOW * 60,
      produced,
      smelterInput: s1 === undefined ? null : s1.input,
      runs: t1.runs.map((r) => r.tiles),
      items: t1.runs.map((r) => r.items),
      minerOut: m1 === undefined ? null : m1.output,
      minerLeft: m1 === undefined ? null : m1.remaining,
      mined: t1.minedFromNodes,
      buildings: t1.buildings,
    };
    log.push(`${label}: produced ${produced}, runs [${w.runs}] items [${w.items}], `
      + `input ${w.smelterInput}, minerOut ${w.minerOut}, left ${w.minerLeft}, `
      + `mined ${w.mined}, ticks ${w.coreTicks}`);
    return w;
  };

  const running = await measure('running');

  // --- pull the MIDDLE tile out of the LONGEST run ---------------------------
  // CHOSEN BY TOPOLOGY, NOT BY THE ORDER THEY WERE LAID. The tiles a player
  // places do not always chain into one run, so "the third belt I put down" is
  // not necessarily in the middle of anything. Asking the plan which run is
  // longest and taking its middle tile is the only choice guaranteed to SPLIT a
  // line, which is the whole point of the test.
  const plan0 = fac();
  const longest = plan0.runs.indexOf(plan0.runs.slice()
    .sort((x, y) => y.tiles - x.tiles)[0]);
  const inRun = plan0.list.filter((b) => b.kind === 'belt' && b.run === longest);
  if (inRun.length < 3) return { fail: 'no run long enough to have a middle', plan: plan0.list, log };
  const midBuild = inRun[Math.floor(inRun.length / 2)];
  const midCell = midBuild.cell;
  const residue = smelter()?.input ?? 0;
  const removal = of.demolish({ id: midBuild.id });
  log.push(`removed the middle of run ${longest} (${midCell}): ${JSON.stringify(removal)}`);

  // LET THE RESIDUE FINISH, AND MEASURE HOW LONG THAT TOOK.
  //
  // The claim is "the line stops", not "it stops in the same tick": the ore
  // already inside the furnace is still smelted, and counting that against the
  // stall would be measuring the wrong thing. The residue is a KNOWN quantity
  // (the input buffer at the moment of the removal, burning at the survival
  // smelter's one per second), so the wait is bounded by it plus a margin
  // rather than guessed at. Waiting for quiet cannot hide a failure: if the
  // rebuild left the drill still feeding the furnace the quiet never comes, the
  // wait ends on its cap, and the window that follows measures the production
  // this probe is asserting is zero.
  let drainSecs = 0;
  let quiet = 0;
  const drainCap = Math.min(60, residue + 15);
  while (drainSecs < drainCap && (quiet < 3 || (smelter()?.input ?? 0) > 0)) {
    const o0 = (smelter()?.output ?? 0) + ironIn();
    await sleep(1);
    drainSecs++;
    if ((smelter()?.output ?? 0) + ironIn() === o0) quiet++; else quiet = 0;
  }
  log.push(`residue ${residue} in the furnace, quiet after ${drainSecs}s (cap ${drainCap})`);
  const stalled = await measure('stalled');

  // --- put it back -----------------------------------------------------------
  // GP-772: THE PLAYER HAS MOVED, AND THIS USED TO ASSUME OTHERWISE. That was
  // true before GP-771: the drill went down from wherever the belts were laid,
  // no walk involved. It no longer is: placing the drill beyond the tail (see
  // above) walks the player out along the run, so the ORIGINAL `pitch` a belt
  // was placed at, from a stand-point the player has since left, no longer
  // looks anywhere near `midCell`. So this walks back near the removed tile's
  // own recorded 3D position first (`midBuild.pos`, known regardless of where
  // the player ended up), then aims by that position with a free yaw AND pitch
  // search rather than trusting a remembered angle, and only then narrows to
  // the exact cell with a fine spiral, the same shape `tryAt`'s old fine sweep
  // used, widened from one axis to two because the coarse aim may not land
  // exactly square either.
  of.build(2);
  await rotateTo(2);
  await walkToPoint(midBuild.pos, 3.0);
  aimFreeToWalk(midBuild.pos);
  const y1 = of.world().observer.yawDeg;
  const p1 = of.world().observer.pitchDeg;
  let rebuiltCell = null;
  const tryAt = async (yy, pp) => {
    const g = await ghostAt(yy, pp);
    if (g === null || !g.ok || g.cell !== midCell) return false;
    const n0 = fac().buildings;
    await placeHere();
    if (fac().buildings <= n0) return false;
    rebuiltCell = g.cell;
    return true;
  };
  const REBUILD_SPIRAL = (() => {
    const out = [];
    for (let a = -5; a <= 5; ++a) for (let b = -5; b <= 5; ++b) out.push([a, b]);
    out.sort((x, z) => (Math.abs(x[0]) + Math.abs(x[1])) - (Math.abs(z[0]) + Math.abs(z[1])));
    return out;
  })();
  for (const [dy, dp] of REBUILD_SPIRAL) {
    if (rebuiltCell !== null) break;
    await tryAt(y1 + dy * 0.5, Math.max(-88, Math.min(20, p1 + dp * 0.5)));
  }
  of.build(0);
  log.push(`rebuilt ${rebuiltCell ?? 'NOTHING'} (wanted ${midCell} near `
    + `yaw ${y1.toFixed(1)} pitch ${p1.toFixed(1)})`);

  const rebuilt = await measure('rebuilt');

  // --- THE KEY ITSELF -------------------------------------------------------
  // Everything above went through of.demolish, which is the X key's own
  // handler; this proves the KEY reaches it. THE PLAYER HAS TO WALK UP TO THE
  // LINE FIRST: the whole run was laid out at arm's length down the aim, five to
  // eight metres away, and Factory.pick only reaches 3.5 m. Every measurement is
  // finished by now, so moving costs nothing. Whatever ends up under the
  // crosshair is fair game, so the assertion is only that exactly one building
  // went and the ledger grew, which is all a keybinding has to prove.
  const rig = [{ n: 'smelter', ...smelterAt }, ...laid.map((b, i) => ({ n: `b${i}`, ...b }))];
  const nearest = () => {
    const e = eye();
    let bestD = Infinity;
    for (const b of rig) bestD = Math.min(bestD, gdist(b.pos, [e.x, e.y, e.z]));
    return bestD;
  };
  let stepsIn = 0;
  for (; stepsIn < 8 && nearest() > 2.6; ++stepsIn) {
    of.input.tape([{ hold: 22, keys: ['KeyW'] }, { hold: 3, keys: [] }]);
    await sleep(0.5);
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.3);
  log.push(`walked ${stepsIn} steps in, nearest building ${nearest().toFixed(2)} m`);
  let byKey = null;
  for (let p = -8; p >= -80; p -= 2) {
    of.look(yaw, p);
    await sleep(0.2);
    const keyBefore = of.game();
    of.input.tape([{ hold: 3, keys: ['KeyX'] }, { hold: 5, keys: [] }]);
    await sleep(0.3);
    const keyAfter = of.game();
    byKey = {
      pitch: p,
      buildingsBefore: keyBefore.factory.buildings,
      buildingsAfter: keyAfter.factory.buildings,
      removalsBefore: keyBefore.demolition.buildings,
      removalsAfter: keyAfter.demolition.buildings,
    };
    if (byKey.buildingsAfter === byKey.buildingsBefore - 1) break;
  }
  log.push(`X key at pitch ${byKey.pitch}: `
    + `${byKey.buildingsBefore} -> ${byKey.buildingsAfter} buildings`);

  const dem = of.game().demolition;
  const packIron = ironIn();

  return {
    advanced: {
      windows: [running, stalled, rebuilt].map((w) => ({
        label: w.label, coreTicks: w.coreTicks, expected: w.expected,
      })),
      rebuilds: fac().rebuilds,
      drillRatePerSec: drill.rate,
      residueAtRemoval: residue,
      drainSecs,
    },
    // THE CLAIM. Not "removal returned", but: it produced, then it did not,
    // then it produced again, over three windows of identical length.
    line: { running: running.produced, stalled: stalled.produced, rebuilt: rebuilt.produced },
    topology: {
      runsRunning: running.runs, runsStalled: stalled.runs, runsRebuilt: rebuilt.runs,
      buildings: [running.buildings, stalled.buildings, rebuilt.buildings],
      removedCell: midCell, rebuiltCell, byKey,
    },
    ledger: {
      ...dem,
      // Nothing may be invented by a removal: the pack's iron can only ever have
      // come from the smelter, so a refund larger than what existed is a bug.
      packIron,
      refundOfRemoval: removal,
    },
    wiring: shape,
    valid:
      // every window actually ran, by /core's own counter
      [running, stalled, rebuilt].every((w) => Math.abs(w.coreTicks - w.expected) <= 90)
      // FS-17. The smelter is NOT wired onto the tail of the run that feeds it,
      // and the head IS wired into the smelter. Both, because a wiring pass that
      // simply linked nothing would satisfy the first on its own.
      && wired.linksToTail === 0
      && wired.linksFromHead === 1
      // the line worked, then the removal stopped it, then it worked again
      && running.produced > 0
      && stalled.produced === 0
      && rebuilt.produced > 0
      // the plan lost exactly one building and got exactly one back
      && stalled.buildings === running.buildings - 1
      && rebuilt.buildings === running.buildings
      && rebuiltCell === midCell
      // the removal split the run in two and the rebuild merged it again
      && stalled.runs.length > running.runs.length
      && rebuilt.runs.length === running.runs.length
      // and the loss is counted rather than swallowed
      && dem.buildings >= 2 && dem.itemsLost >= 0
      // and the X KEY reaches the same handler
      && byKey.buildingsAfter === byKey.buildingsBefore - 1
      && byKey.removalsAfter === byKey.removalsBefore + 1,
    audio: of.game().audio,
    fx: of.game().fx,
    plan: fac().list,
    cost: { drawCalls: of.stats().draw.calls, budget: of.stats().budget.drawCalls },
    log,
  };
})()
