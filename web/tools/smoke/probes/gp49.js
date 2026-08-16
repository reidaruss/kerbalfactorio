// GP-49: A MACHINE PLACED WHERE A NEIGHBOUR ALREADY STANDS.
//
//   npx --prefix web vite build --outDir dist-gp
//   npx --prefix web vite preview --outDir dist-gp --port 4185
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4185/ --scenario=walk \
//     --sandbox=1 --evalfile=web/tools/smoke/probes/gp49.js
//
// THE REPORTED DEFECT, verbatim from the roadmap: "a generator at y 21103.98
// and an electric smelter placed on a bearing 15 degrees away landed at
// y 21104.98, the same tangent position exactly 1.00 m up. It floats, a
// downward aim ray passes underneath it, and it can never be interacted with,
// demolished or fed again."
//
// THIS PROBE DOES NOT TAKE THAT DIAGNOSIS ON TRUST, because the number that
// makes it is a WORLD-FRAME y at a 600 km radius, where a tangent direction can
// carry almost all of a metre. So it DECOMPOSES the offset between the two
// machines into the site's own up and tangent components and reports both. If
// the second machine really is a metre in the air, `upM` is 1.00 and `tangentM`
// is 0. If it is one cell over on the ground, `tangentM` is 1.00 and `upM` is
// about 0. Those are different bugs with the same printout and they need
// different fixes.
//
// EITHER WAY THE PLAYER LOSES THE MACHINE, which is what makes this worth
// refusing rather than tidying: two 2 m machines whose centres are 1 m apart
// interpenetrate, and `Factory.pick` resolves every bearing that reaches one to
// whichever is better centred, so the other can never be aimed at, opened,
// demolished or fed again. It was paid for and it is gone.
//
// THE CLAIM AFTER THE FIX: a placement whose FOOTPRINT would overlap a
// neighbour's is refused, before the button is pressed, with a reason on the
// ghost naming what it is too close to.
//
// THE NEGATIVE CONTROL, and it is the assertion that makes the rest mean
// anything: THE SAME PART, THE SAME HAND, THE SAME TICK, far enough out, goes
// down. A build that had simply stopped placing electric smelters passes every
// assertion above this line and fails that one.
//
// FS-145: THE CONTROL USED TO BE A PAIR OF HARDCODED BEARINGS AND IT WENT STALE.
// It aimed 15 degrees off the generator for the refusal and 55 degrees off at a
// shallower pitch for the "clear" placement, and asserted the accepted smelter
// was `>= 1.999` m away because "2 m machines, 2 m apart". Every number in that
// sentence was the 2 m machine set. FS-73 took the electric smelter to 4 m, so
// the pair now needs `(2 + 4) / 2` = 3 cells and BOTH bearings landed inside the
// clash zone: measured on the shipped build, the 55 degree control resolved to a
// cell 2 over and came back `too close to #1 generator`. The bearings were never
// the claim. The claim is a metric offset from the neighbour, so this now aims at
// a POINT derived from `of.game().factory.footprint` (GP-760's rule: read the
// shipped table, never retype it) and lets `findGhost` resolve that point onto
// the lattice. Both distances are the footprint arithmetic itself: the refusal is
// aimed HALF A GENERATOR out, flush against its side face, which is the "one cell
// over" the roadmap reported; the control is aimed at the TOUCHING distance,
// `(fpA + fpB) / 2`, which is where the two housings stop overlapping. Neither
// mentions 2, or 4, or a degree.
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

  await sleep(1.0);

  // ======================================================================
  // 0. SETUP PROOF (DW-20). This is sandbox and the factory is empty, so
  //    every count below starts from a known zero rather than from whatever
  //    a previous run left behind.
  // ======================================================================
  check('this run is sandbox', of.game().mode.sandbox === true,
    JSON.stringify(of.game().mode));
  const f0 = of.game().factory;
  check('the factory starts empty', (f0.list ?? []).length === 0,
    (f0.list ?? []).length);

  // ======================================================================
  // 1. GET TWO 2 m MACHINES INTO THE HAND. Crafted and assigned through the
  //    same pack tiles a player clicks, so nothing is granted by fiat.
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
  check('the generator is craftable', await craftN('Burner generator', 1) === 1);
  check('the electric smelter is craftable',
    await craftN('Electric smelter', 3) === 3);
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
  check('the generator went on slot 5', await assign(0x003E, 5));
  check('the electric smelter went on slot 6', await assign(0x003D, 6));

  const listed = () => of.game().factory.list ?? [];
  const ghost = () => of.game().build?.ghost ?? null;
  const refusals = () => of.game().build?.refusals ?? 0;
  const aim = async (slot, dyaw, pitch) => {
    of.hotbar(slot);
    await sleep(0.15);
    of.look(yaw + dyaw, pitch);
    await sleep(0.3);
  };
  const placeAt = async (slot, dyaw, pitch) => {
    await aim(slot, dyaw, pitch);
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 10, keys: [] }]);
    await sleep(0.45);
  };

  // --- AIMING AT A POINT (FS-145) --------------------------------------------
  // `aimAtPoint` is `autoline.js`'s search and `assembler.js`'s copy of it,
  // unchanged and for the same reason: the observer's yaw lives in a local
  // tangent frame and cannot be computed from body-frame coordinates without
  // re-deriving that frame here, so the heading is MEASURED by minimising the
  // ray's perpendicular miss against a known point. The `u <= 0` guard is load
  // bearing: perpendicular distance to a LINE does not care which way along it
  // the target lies, so without it a heading 180 degrees wrong scores as well as
  // the right one.
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const norm3 = (v) => {
    const m = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / m, v[1] / m, v[2] / m];
  };
  const along = (p, v, m) => [p[0] + v[0] * m, p[1] + v[1] * m, p[2] + v[2] * m];
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
  /** The cell a placement's key names, or null. `MachinePlacement`'s format. */
  const ijOf = (cell) => {
    const m = /:(-?\d+),(-?\d+)$/.exec(cell ?? '');
    return m === null ? null : [Number(m[1]), Number(m[2])];
  };
  /** THE SHIPPED DIMENSION TABLE, read rather than retyped (FS-73 published it
   *  for exactly this). `stepsFor` is `FactorySnap`'s own rule and
   *  `MachinePlacement.footprintsOverlap` clears at the same number: the mating
   *  distance IS the minimum clash-free distance, at every size (FS-78). */
  const FP = of.game().factory.footprint;
  const touchM = (a, b) => (FP[a] + FP[b]) * 0.5;
  const stepsFor = (a, b) => Math.max(1, Math.ceil(touchM(a, b)));

  // ======================================================================
  // 2. THE GENERATOR GOES DOWN, and its position is read from the sim rather
  //    than from where the probe thought it aimed.
  // ======================================================================
  await placeAt(5, 0, -42);
  const gen = listed().find((b) => b.kind === 'generator') ?? null;
  check('the generator is on the ground', gen !== null,
    JSON.stringify(listed().map((b) => b.kind)));
  if (gen === null) return { valid: false, fails, log };
  log.push(`generator at ${JSON.stringify(gen.pos)} cell ${gen.cell}`);

  // The site frame the two machines share, so the offset can be decomposed
  // into an UP and a TANGENT part instead of being read off a world axis.
  const up = (() => {
    const [x, y, z] = gen.pos;
    const r = Math.hypot(x, y, z) || 1;
    return [x / r, y / r, z / r];
  })();

  // ======================================================================
  // 3. THE REPORTED GESTURE: put the electric smelter FLUSH AGAINST THE
  //    GENERATOR'S SIDE FACE. That is "one cell over" expressed in the shipped
  //    geometry rather than as a bearing, and it is inside the clash zone at
  //    every size the table will ever hold.
  //
  //    THE SIDE and not the front, deliberately: `fwd` points away from the
  //    player who just placed it, so a point beyond the generator along `fwd`
  //    is behind its own housing, and a machine is a solid (FS-92), so the aim
  //    would be measuring an occluded ray rather than the placement rule. The
  //    side axis is the third leg of the frame the two machines already share.
  // ======================================================================
  const side = norm3(cross3(gen.up, gen.fwd));
  const before = listed().length;
  const refusedBefore = refusals();
  of.hotbar(6);
  await sleep(0.15);
  const flush = along(gen.pos, side, FP.generator * 0.5);
  aimAtPoint(flush);
  await sleep(0.3);
  const g1 = ghost();
  log.push(`ghost on the neighbour: ${JSON.stringify(g1 && {
    ok: g1.ok, reason: g1.reason, cell: g1.cell, ij: g1.ij })}`);
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 10, keys: [] }]);
  await sleep(0.45);
  const after = listed().length;
  const near = listed().find((b) => b.kind === 'esmelter') ?? null;

  const offset = near === null ? null : (() => {
    const d = [near.pos[0] - gen.pos[0], near.pos[1] - gen.pos[1],
      near.pos[2] - gen.pos[2]];
    const upM = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    const total = Math.hypot(d[0], d[1], d[2]);
    const tangentM = Math.sqrt(Math.max(0, total * total - upM * upM));
    return { total, upM, tangentM, dy: d[1] };
  })();
  if (offset !== null) {
    log.push(`OFFSET generator -> smelter: total ${offset.total.toFixed(4)} m, `
      + `up ${offset.upM.toFixed(4)} m, tangent ${offset.tangentM.toFixed(4)} m, `
      + `world dy ${offset.dy.toFixed(4)} m`);
  }

  // THE ASSERTION. Two machines whose housings overlap interpenetrate, and
  // neither can then be reliably addressed. The refusal is the fix, and the
  // ghost has to have said so BEFORE the press.
  check('the ghost refused the overlapping cell', g1 !== null && g1.ok === false,
    JSON.stringify(g1 && { ok: g1.ok, reason: g1.reason }));
  check('and named what it was too close to',
    (g1?.reason ?? '').includes('too close'), g1?.reason ?? '');
  check('nothing was placed on top of the neighbour', after === before,
    `${before} -> ${after}`);
  check('and the refusal was counted', refusals() > refusedBefore,
    `${refusedBefore} -> ${refusals()}`);

  // ======================================================================
  // 4. THE NEGATIVE CONTROL. THE SAME PART, THE SAME HAND, out at the distance
  //    where the two housings stop overlapping. A build that had stopped
  //    placing electric smelters altogether passes every assertion above and
  //    fails this one.
  //
  //    THE AIM POINT IS `(fpGenerator + fpEsmelter) / 2` METRES ALONG THE SAME
  //    SIDE AXIS, which is the touching distance and nothing else: at the 2 m
  //    machine set it was 2.0, today it is 3.0, and this line does not change.
  //    `findGhost` then resolves that point onto the integer lattice, which is
  //    where the half-cell goes (`ceil` of the touching distance is the mating
  //    cell, FS-78), so the probe never has to know the cell pitch either.
  // ======================================================================
  const needCells = stepsFor('generator', 'esmelter');
  const clearAt = along(gen.pos, side, touchM('generator', 'esmelter'));
  const found = await findGhost(clearAt, (g) => g.ok === true);
  log.push(`clear ghost: ${JSON.stringify(found && { cell: found.g.cell,
    ij: found.g.ij, ok: found.g.ok })}, aimed ${touchM('generator', 'esmelter')
    .toFixed(3)} m out, ${needCells} cells required`);
  if (found !== null) {
    of.look(found.yaw, found.pitch);
    await sleep(0.2);
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 10, keys: [] }]);
    await sleep(0.45);
  }
  const far = listed().find((b) => b.kind === 'esmelter') ?? null;
  check('the SAME smelter goes down clear of the generator', far !== null,
    JSON.stringify(listed().map((b) => b.kind)));
  let clearM = 0;
  let clearCells = 0;
  if (far !== null) {
    clearM = Math.hypot(far.pos[0] - gen.pos[0], far.pos[1] - gen.pos[1],
      far.pos[2] - gen.pos[2]);
    const a = ijOf(far.cell), b = ijOf(gen.cell);
    clearCells = a === null || b === null ? -1
      : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    log.push(`the accepted smelter is ${clearM.toFixed(4)} m and ${clearCells} `
      + `cells from the generator (${far.cell} against ${gen.cell})`);
    // THE CELL CLAIM IS THE EXACT ONE and the metric claim is the readable one.
    // Cells are integers off the two placements' own keys, so the first cannot
    // be a rounding; metres come off the two positions the sim reports.
    check('and it stands at least the mating distance away, in cells',
      clearCells >= needCells, `${clearCells} cells, ${needCells} required`);
    check('and the two housings do not overlap, in metres',
      clearM >= touchM('generator', 'esmelter') - 0.005,
      `${clearM.toFixed(4)} m, ${touchM('generator', 'esmelter').toFixed(3)} needed`);
  }

  // ======================================================================
  // 5. BOTH MACHINES CAN STILL BE AIMED AT, which is the thing the defect
  //    destroyed. `pickAt` is the same resolve E and the demolish key use.
  // ======================================================================
  const reach = of.game().factory.list.length;
  check('both machines are in the world', reach === 2, reach);

  const valid = fails.length === 0;
  return {
    valid, fails, log,
    generator: gen.pos, cell: gen.cell,
    offsetOnRefusedAim: offset,
    ghostReason: g1?.reason ?? '',
    placedBefore: before, placedAfter: after,
    refusalsDelta: refusals() - refusedBefore,
    clearPlacementM: +clearM.toFixed(4),
    clearPlacementCells: clearCells,
    // FS-145: the table the two distances above were derived from, published
    // beside them, so a reader can check the arithmetic without the source.
    footprint: FP,
    requiredCells: needCells,
    requiredM: +touchM('generator', 'esmelter').toFixed(3),
    kinds: listed().map((b) => `${b.kind}@${b.cell}`),
  };
})()
