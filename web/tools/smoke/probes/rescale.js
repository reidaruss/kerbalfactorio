// FS-78 / FS-80: A FACTORY BUILT WHEN THE MACHINES WERE SMALLER SURVIVES THE
// LOAD, AND THE THING THAT MAKES IT SURVIVE IS LOAD BEARING.
//
// WHAT THIS IS ACTUALLY PROTECTING. Reid has a roughly 140-structure base he has
// been playing for days. FS-73 took the smelter, the electric smelter and the
// drill from 2 m to 4 m, and a `SaveBuilding` records `pos` and `cell` and
// carries NO footprint, so every machine in that world is re-drawn one metre
// wider on each side in the position it was placed at for the old size. The
// failure this probe exists to make impossible is that he loads it and the base
// is geometrically wrong while every indicator says it is fine.
//
// AND "EVERY INDICATOR SAYS IT IS FINE" IS THE WHOLE POINT, so it is worth
// spelling out. `PortFit.gapM` was a `Math.hypot`, an unsigned magnitude. At the
// old spacing a belt's outlet stands 1.502 m from the smelter's centre and the
// inlet of a 4 m smelter stands 2.000 m from it, so they are 0.498 m apart and
// `gap <= PORT_MATE_M` is true, exactly as it was when they were 0.502 m apart
// the right way round. The belt's last half metre is INSIDE the housing and the
// link list, the crosshair, the ghost and five probes all read healthy. FS-76
// added the signed `alongM` so the measurement can say which side it is on, and
// this probe asserts on the SIGN and not on the magnitude, because the magnitude
// is the thing that could not tell the two apart.
//
// WHY A SYNTHESISED SLOT. His save is on his machine and cannot be in a probe.
// So this lays two belt tiles through the REAL ghost and the REAL FS-26 socket
// snap, saves, and then edits the saved bytes into exactly the shape a
// pre-FS-73 slot has: the run extended along its own measured one-cell step, and
// a smelter placed TWO cells from the belt head, which is the spacing the game
// itself produced for a 2 m smelter and which `stepsFor` now requires to be
// three. That is not a mock of the failure. It IS the failure, assembled
// deliberately, and the one-cell step is measured off the two real tiles rather
// than assumed, because the site grid is 1.002 m and not 1.000 m.
//
// THE NEGATIVE CONTROL IS THE HALF THAT MAKES IT MEAN ANYTHING (standing rule 11
// and INSTRUMENTS.md's "a negative control is not finished when it goes red").
// The SAME synthesised slot is loaded with `?rescale=0`, which skips the move and
// keeps the measurement. Its shape is chosen from FS-71's lesson: under the
// control `buildingsBack` STILL PASSES, because nothing is ever deleted and the
// migration is not what keeps the buildings, while `noPairTooClose` and
// `beltIsNotInsideTheHousing` go RED with both numbers printed. A control in
// which everything failed would prove nothing about which assertion is carrying
// the claim.
//
// AND A PARTIAL MIGRATION IS DISTINGUISHABLE FROM A COMPLETE ONE, which the
// brief asked for by name and which a single boolean cannot do. Three fields
// answer it together and the probe asserts on all three:
//
//   moved === 0 && tooCloseAfter  > 0   the migration never ran
//   moved  >  0 && tooCloseAfter  > 0   it ran and did not finish: PARTIAL
//   moved  >  0 && tooCloseAfter === 0  complete
//   moved === 0 && tooCloseAfter === 0  nothing needed doing (a modern world)
//
// WHAT IT ASSERTS, in order:
//   buildingsBack                every building comes back, always, both runs
//   rescaleRan                   it recognised a world at the old spacing
//   tooCloseBeforeSeen           and it SAW the overlap rather than guessing
//   noPairTooClose               nothing overlaps afterwards
//   notPartial                   moved > 0, so the zero above was earned
//   beltIsNotInsideTheHousing    alongM > 0, the assertion gapM cannot make
//   beltMatesTheInlet            and it is a real link at the derived gap
//   backupExists                 a rescue copy was written
//   backupIsThePreMigrationWorld and it holds the OLD cell, not the new one
//   drillsStayOnTheirPatches     nothing was mined off its ore
//   idempotent                   a second load moves nothing at all
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const log = [];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(name);
    log.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : `  ${detail}`}`);
    return ok;
  };
  const fac = () => of.game().factory;
  const gdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const eye = () => { const o = of.aim().origin; return [o[0], o[1], o[2]]; };
  const controlled = OF_ARGS.control === true;

  // THE STORE IS OPENED THE WAY A THIRD PARTY OPENS IT, not through an export.
  // This probe's whole job is to act as something that wrote a slot the client
  // did not write, which is what a slot from an older build is; reading it back
  // through a client helper would let the client validate its own bytes. The two
  // names and the key are `SaveGame.ts`'s and are transcribed on purpose, exactly
  // as `probes/portmigrate.js` transcribes them.
  const idbOn = (db, store, ver) => (mode, run) => new Promise((res, rej) => {
    const req = indexedDB.open(db, ver);
    req.onerror = () => rej(req.error);
    // The rescue database does not exist until a migration has written to it, and
    // this probe reads it BEFORE that to count what was there already. Creating
    // the store here matches the client's own schema exactly, so an empty probe
    // read and a real client write cannot end up in two different stores.
    req.onupgradeneeded = () => {
      const h = req.result;
      if (!h.objectStoreNames.contains(store)) h.createObjectStore(store);
    };
    req.onsuccess = () => {
      const h = req.result;
      const t = h.transaction(store, mode);
      const r = run(t.objectStore(store));
      r.onsuccess = () => { res(r.result); h.close(); };
      r.onerror = () => { rej(r.error); h.close(); };
    };
  });
  const saves = idbOn('orbital-foundry', 'saves', 1);
  const KEY = 'auto-sandbox';
  const readSlot = () => saves('readonly', (s) => s.get(KEY));
  const writeSlot = (v) => saves('readwrite', (s) => s.put(v, KEY));
  // FS-79's rescue database. Version 1, its own store, deliberately NOT the save
  // store, so a copy of the world can never appear in the player's load list nor
  // be swept by anything that operates on saves.
  const rescue = idbOn('of-rescue', 'slots', 1);
  const rescueKeys = () => rescue('readonly', (s) => s.getAllKeys());
  const rescueGet = (k) => rescue('readonly', (s) => s.get(k));

  await sleep(0.6);
  const fp = of.game().factory.footprint;
  if (!fp) return { valid: false, why: 'the report publishes no footprint table' };
  log.push(`footprint table: ${Object.entries(fp).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const stepsFor = (a, b) => Math.max(1, Math.ceil((fp[a] + fp[b]) * 0.5));
  const needBeltSmelter = stepsFor('belt', 'smelter');
  // THE LEGACY SPACING IS DERIVED FROM THE OLD TABLE, NOT TYPED IN. A 2 m smelter
  // against a 1 m belt is `ceil(3/2)` = 2 cells, which is what the game produced
  // for every belt-to-smelter pair that exists in any save Reid has. Writing `2`
  // here would be this probe carrying its own copy of a constant that moved,
  // which is exactly the rot standing rule 11 is about.
  const LEGACY_SMELTER_FP = 2;
  const legacySteps = Math.max(1, Math.ceil((fp.belt + LEGACY_SMELTER_FP) * 0.5));
  log.push(`belt to smelter needs ${needBeltSmelter} cells now, `
    + `${legacySteps} when the smelter was ${LEGACY_SMELTER_FP} m`);
  if (needBeltSmelter <= legacySteps) {
    return { valid: false, why: 'the smelter did not get bigger, there is nothing to migrate',
      log };
  }

  // --- two real belt tiles, through the real ghost ---------------------------
  const placeHere = async () => {
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
    await sleep(0.16);
  };
  const ghostAt = async (y, p) => { of.look(y, p); await sleep(0.035); return of.build().ghost; };
  const fromEye = (g) => gdist(g.pos, eye());

  let yaw = of.world().observer.yawDeg;
  of.build(2);
  await sleep(0.2);
  {
    let best = yaw;
    for (const [span, step] of [[23, 2], [5, 0.4]]) {
      let by = best;
      let bd = -2;
      for (let k = -span; k <= span; ++k) {
        const g = await ghostAt(best + k * step, -26);
        if (g === null) continue;
        const a = of.aim();
        const d = -(a.dir[0] * g.fwd[0] + a.dir[1] * g.fwd[1] + a.dir[2] * g.fwd[2]);
        if (d > bd) { bd = d; by = best + k * step; }
      }
      best = by;
    }
    yaw = best;
  }
  const sweep = [];
  for (let p = -12; p >= -52; p -= 0.3) {
    const g = await ghostAt(yaw, p);
    if (g !== null) sweep.push({ pitch: p, ok: g.ok, prospective: g.prospective,
      reachM: +fromEye(g).toFixed(2) });
  }
  const tailAim = sweep.filter((s) => s.ok && s.reachM <= 7.7)
    .reduce((a, b) => (a === null || b.reachM > a.reachM ? b : a), null);
  if (tailAim === null) return { valid: false, why: 'no belt cell inside the reach band', log };
  of.look(yaw, tailAim.pitch);
  await sleep(0.2);
  if (fac().buildings !== 0) return { valid: false, why: 'the world was not empty', log };
  await placeHere();
  if (fac().buildings !== 1) return { valid: false, why: 'the first belt press placed nothing', log };
  const tail0 = fac().list[0];
  let headAim = null;
  for (let p = tailAim.pitch - 0.1; p >= -52 && headAim === null; p -= 0.15) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok || g.prospective === true) continue;
    const d = gdist(g.pos, tail0.pos);
    if (d > 1.45) break;
    if (d > 0.6) headAim = p;
  }
  if (headAim === null) return { valid: false, why: 'no cell adjacent to the tail', log };
  of.look(yaw, headAim);
  await sleep(0.2);
  await placeHere();
  of.build(0);
  await sleep(0.3);
  if (fac().buildings !== 2) return { valid: false, why: 'the second belt press placed nothing', log };

  await of.save();
  const base = await readSlot();
  if (!base || base.buildings.length !== 2) {
    return { valid: false, why: 'the slot did not come back with two belts', log };
  }

  // --- the legacy world, assembled from the two real tiles --------------------
  // THE ONE-CELL STEP IS MEASURED, not assumed. The site grid is 1.002 m per cell
  // on the shipped world and not 1.000 (see `PORT_MATE_M`'s derivation), and it
  // is a different vector at every latitude, so the only honest source for it is
  // the two tiles the game just placed one cell apart.
  const cellOf = (b) => { const m = /^m(\d+):(-?\d+),(-?\d+)$/.exec(b.cell); return m
    ? { site: +m[1], i: +m[2], j: +m[3] } : null; };
  const c0 = cellOf(base.buildings[0]);
  const c1 = cellOf(base.buildings[1]);
  if (c0 === null || c1 === null || c0.site !== c1.site) {
    return { valid: false, why: 'the two tiles are not on one site', cells:
      base.buildings.map((b) => b.cell), log };
  }
  const di0 = c1.i - c0.i;
  const dj0 = c1.j - c0.j;
  if (Math.abs(di0) + Math.abs(dj0) !== 1) {
    return { valid: false, why: 'the two tiles are not one cell apart', di0, dj0, log };
  }
  // WHICH END OF THE RUN THE ORE COMES OUT OF, read off the run rather than
  // assumed from the order the tiles were pressed. A run is stored tail first and
  // its FLOW direction is a property of the heading the tiles carry, which the
  // ghost chose; the first draft of this probe extended the line in the pressing
  // order, put the smelter behind the tail, and produced a perfectly valid
  // smelter-feeds-belt line that it then reported as "no link". The scene has to
  // be belt-feeds-smelter, because that is the pair Reid's base is made of and
  // the only one `FactoryRefusal` speaks about.
  const run0 = (fac().runs || [])[0];
  if (run0 === undefined) return { valid: false, why: 'the two tiles made no run', log };
  const byId = (id) => fac().list.find((b) => b.id === id);
  const cTail = cellOf(byId(run0.tail));
  const cHead = cellOf(byId(run0.head));
  if (cTail === null || cHead === null) {
    return { valid: false, why: 'the run ends have no parseable cells', log };
  }
  const di = Math.sign(cHead.i - cTail.i);
  const dj = Math.sign(cHead.j - cTail.j);
  if (Math.abs(di) + Math.abs(dj) !== 1) {
    return { valid: false, why: 'the run is not one axis long', cTail, cHead, log };
  }
  // The step VECTOR still comes from the two real positions, signed to match the
  // flow: the site grid is 1.002 m and not 1.000 and is a different vector at
  // every latitude, so the tiles the game just placed are the only honest source.
  const p0 = base.buildings[0].pos;
  const p1 = base.buildings[1].pos;
  const sign = (di !== 0 ? di / (di0 !== 0 ? di0 : di) : dj / (dj0 !== 0 ? dj0 : dj));
  const step = [(p1[0] - p0[0]) * sign, (p1[1] - p0[1]) * sign,
    (p1[2] - p0[2]) * sign];
  const stepM = Math.hypot(step[0], step[1], step[2]);
  log.push(`one cell measures ${stepM.toFixed(4)} m along (${di},${dj})`);
  // Everything is measured from the run's HEAD, which is the end the ore leaves
  // by, so the extension grows the line forward and the smelter stands in front
  // of it. `srcOf` is whichever saved row the head is, so the new rows inherit
  // its `up` and `fwd` and the extension is collinear by construction.
  const headRow = base.buildings.find((b) => {
    const c = cellOf(b);
    return c !== null && c.i === cHead.i && c.j === cHead.j;
  });
  if (headRow === undefined) return { valid: false, why: 'the head is not in the slot', log };
  const rowAt = (n, over) => ({
    ...headRow,
    pos: [headRow.pos[0] + step[0] * n, headRow.pos[1] + step[1] * n,
      headRow.pos[2] + step[2] * n],
    cell: `m${cHead.site}:${cHead.i + di * n},${cHead.j + dj * n}`,
    ...over,
  });
  // Two more belt tiles so the run is four long and has a body to move, then the
  // smelter at the LEGACY two-cell spacing off the head. `ports: true` on every
  // row, so FS-46's port repair does NOT fire: this slot is a world that already
  // knew about ports and only ever had the wrong SIZES, which is precisely what
  // Reid's is, and it keeps the two migrations from being confused for each
  // other.
  const legacy = {
    ...base,
    buildings: [
      { ...base.buildings[0], ports: true },
      { ...base.buildings[1], ports: true },
      rowAt(1, { ports: true }),
      rowAt(2, { ports: true }),
      rowAt(2 + legacySteps, { kind: 'smelter', patch: -1, ports: true }),
    ],
  };
  const legacySmelterCell = legacy.buildings[4].cell;
  log.push(`legacy slot: 4 belts flowing (${di},${dj}), head ${legacy.buildings[3].cell}, `
    + `smelter ${legacySmelterCell} (${legacySteps} cells off the head)`);
  const keysBefore = (await rescueKeys()).length;
  await writeSlot(legacy);

  // --- the load under test ---------------------------------------------------
  await of.load();
  await sleep(0.8);
  const f = fac();
  const r = f.rescale;
  if (!r) return { valid: false, why: 'the report publishes no rescale record', log };
  log.push(`rescale: ${JSON.stringify(r)}`);

  // The one assertion that holds in BOTH runs, and the reason it is first:
  // nothing is ever deleted, so this cannot be what the migration is doing.
  // FS-71's lesson exactly, where "the box is there" passed and "the box has
  // contents" went red.
  check('buildingsBack', f.buildings === 5, `${f.buildings} of 5`);
  check('rescaleRan', r.ran === true, `ran ${r.ran}`);
  check('tooCloseBeforeSeen', r.tooCloseBefore > 0,
    `${r.tooCloseBefore} pairs closer than the table allows`);

  // THE END OF THE RUN NEAREST THE SMELTER, BY CELLS, NOT BY PLAN ID. A run is
  // stored tail first and which END faces the machine is a property of the
  // heading the tiles were laid on, so ranking by id got the far end and read
  // "no link" for a line that was perfectly connected at the other end. Which
  // way the pair hands off is also not this probe's claim: the claim is that ONE
  // port of the smelter meets ONE port of the belt beside it, at the spacing the
  // table requires, on the RIGHT SIDE of both faces.
  const smelter = f.list.find((b) => b.kind === 'smelter');
  const cellSm = smelter ? cellOf(smelter) : null;
  const cellsApart = (b) => {
    const c = cellOf(b);
    return c === null || cellSm === null ? Infinity
      : Math.max(Math.abs(c.i - cellSm.i), Math.abs(c.j - cellSm.j));
  };
  const head = f.list.filter((b) => b.kind === 'belt')
    .reduce((a, b) => (a === null || cellsApart(b) < cellsApart(a) ? b : a), null);
  const apart = head === null ? -1 : cellsApart(head);
  const link = smelter === undefined ? undefined
    : (f.links || []).find((l) => l.from === smelter.id || l.to === smelter.id);
  // The refusal is the other half of the same question and it is what the CONTROL
  // reads: once `mated` is gated on the sign, a buried belt stops producing a
  // link at all and starts producing a refusal, which is the whole improvement.
  const refusal = smelter === undefined ? undefined
    : (f.refusals || []).find((x) => x.from === smelter.id || x.to === smelter.id);

  if (controlled) {
    // THE CONTROL. `?rescale=0` skips the move and keeps the measurement, so the
    // two runs print the same fields and differ in one. Every line below is the
    // OPPOSITE of the real run's, and they are asserted rather than merely
    // observed, so a build in which the flag stopped working fails here loudly
    // instead of quietly passing as if it had migrated.
    check('controlIsDisabled', r.disabled === true, `disabled ${r.disabled}`);
    check('controlMovedNothing', r.moved === 0, `moved ${r.moved}`);
    check('controlLeavesThePairsTooClose', r.tooCloseAfter > 0,
      `tooCloseAfter ${r.tooCloseAfter}, tooCloseBefore ${r.tooCloseBefore}`);
    check('controlSpacingIsStillLegacy', apart === legacySteps,
      `belt to smelter ${apart} cells, the table requires ${needBeltSmelter}`);
    // BOTH NUMBERS, PRINTED. `gapM` is inside `PORT_MATE_M` and looks exactly
    // like a working hand-off; `alongM` is negative and says the port is behind
    // the face. Before FS-76 only the first existed and this world was WIRED.
    check('controlHasNoLink', link === undefined,
      link === undefined ? 'the buried pair no longer wires'
        : `still wired: gapM ${link.gapM}, alongM ${link.alongM}`);
    check('controlSaysWhy', refusal !== undefined && refusal.alongM < 0,
      refusal === undefined ? 'no refusal was raised'
        : `gapM ${refusal.gapM} (inside PORT_MATE_M, so it reads like a working `
          + `line), alongM ${refusal.alongM} (behind the face): "${refusal.reason}"`);
  } else {
    check('noPairTooClose', r.tooCloseAfter === 0,
      `tooCloseAfter ${r.tooCloseAfter} after ${r.passes} of ${r.passCap} passes`);
    check('notPartial', r.moved > 0,
      `moved ${r.moved} buildings, ${r.cells} cells`);
    check('spacingIsWhatTheTableRequires', apart === needBeltSmelter,
      `head to smelter ${apart} cells, needs ${needBeltSmelter}`);
    check('portTableIsWhole', f.portsLoaded === true,
      `portsMissing [${(f.portsMissing || []).join(', ')}]`);
    check('beltMatesTheInlet', link !== undefined,
      link === undefined ? 'the smelter appears in no link in the plan'
        : `${link.fromPort} -> ${link.toPort}, gapM ${link.gapM} `
          + `rise ${link.riseM} facing ${link.facing}`);
    check('beltIsNotInsideTheHousing', link !== undefined && link.alongM > 0,
      link === undefined ? 'no link' : `alongM ${link.alongM}`);
    check('drillsStayOnTheirPatches', r.drillsOffPatch === 0,
      `${r.drillsMoved} drills moved, ${r.drillsOffPatch} left their patch`);

    // --- the rescue copy ----------------------------------------------------
    const keys = await rescueKeys();
    check('backupExists', r.backupKey !== '' && keys.includes(r.backupKey),
      `key "${r.backupKey}", ${keysBefore} -> ${keys.length} copies`);
    const copy = r.backupKey === '' ? null : await rescueGet(r.backupKey);
    const copied = copy && copy.buildings
      ? copy.buildings.find((b) => b.kind === 'smelter') : null;
    check('backupIsThePreMigrationWorld',
      copied !== null && copied !== undefined && copied.cell === legacySmelterCell,
      copied ? `copy holds ${copied.cell}, world now holds ${smelter?.cell}`
        : 'the copy holds no smelter');

    // --- idempotence --------------------------------------------------------
    // The migration is not gated on a flag that says it ran, it is gated on the
    // GEOMETRY being wrong, so a second load of the world it just produced must
    // find nothing to do. A flag would pass this test while being unable to tell
    // a finished migration from an interrupted one; this cannot.
    await of.save();
    await of.load();
    await sleep(0.6);
    const r2 = fac().rescale;
    check('idempotent', r2.moved === 0 && r2.tooCloseBefore === 0,
      `second load: moved ${r2.moved}, tooCloseBefore ${r2.tooCloseBefore}, ran ${r2.ran}`);
    check('idempotentKeepsTheBuildings', fac().buildings === 5,
      `${fac().buildings} of 5`);
  }

  return {
    valid: true, control: controlled, pass: fails.length === 0, fails,
    footprint: fp, needBeltSmelter, legacySteps, oneCellM: +stepM.toFixed(4),
    rescale: r, beltToSmelterCells: apart, refusal: refusal ?? null,
    // Standing rule 11 in its cheapest form: the port table's own health is
    // reported beside the assertion that depends on it. FS-81 was found here,
    // because a link list that is empty because nothing mates and a link list
    // that is empty because the table never loaded are the same absence.
    portsLoaded: f.portsLoaded, portsMissing: f.portsMissing,
    allLinks: f.links, refusals: f.refusals, runs: f.runs,
    plan: f.list.map((b) => ({ id: b.id, kind: b.kind, cell: b.cell, build: b.build, run: b.run })),
    link: link ? { gapM: link.gapM, riseM: link.riseM, facing: link.facing,
      alongM: link.alongM, fromPort: link.fromPort, toPort: link.toPort } : null,
    buildings: f.buildings, log,
  };
})()
