// GP-1026. THE FLANK MISREAD, ON A BASE THAT HAS THE STOREY THE MISREAD INVENTS.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/padflank.js
//
// WHY THIS FILE EXISTS AND WHY `pad.js` COULD NOT BE IT.
//
// GP-969 left one finding open and UNASSERTED, on purpose: a placement ghost
// aimed at a tall structure's FLANK takes its level from the hit point's height
// (`round(l.z / storey)`), so a point partway up a vertical face is attributed
// to the storey ABOVE it, and the ghost is addressed at a storey nothing is
// standing on. On `pad.js`'s single-storey fixture that reads `[-2,-4,3]` and
// refuses, because level 3 has no decks, so it is a LEGIBILITY defect there and
// nothing worse. Two verifiers argued the real worst case from the code without
// being able to measure it: on a base that GENUINELY HAS a platform at the
// invented level, the same read resolves a LEGAL, GREEN ghost at a cell the
// player never aimed at, and `overlapping()` only rejects pads sharing a level,
// so nothing downstream refuses it either. That was an argument. This is the
// measurement, and it is the deliverable whether or not the fix ships with it.
//
// THE FIXTURE, and every choice in it is forced by the arithmetic rather than
// picked. `cellM` 4, `deckH` 0.5, `wallH` 3.5, `storey` 4:
//
//   * THE TALL BODY IS A WALL, NOT THE LAUNCH PAD, and that is the point rather
//     than a convenience. A level-0 wall spans z 0.5 to 4.0, so a hit anywhere
//     on its face between 2.0 and 4.0 rounds to level 1 -- the CHEAPEST storey
//     to invent, and therefore the cheapest to actually build. The pad's 28 m
//     tower invents level 3 (clamped from 4), which needs three real storeys
//     under it before the worst case can be reached at all. Same expression,
//     same defect, one storey instead of four.
//   * THE WALL GOES ON THE NORTH EDGE OF THE PLATFORM'S OWN CENTRE CELL and the
//     player stands SOUTH of it. That is what makes the invented block land
//     exactly on top of the platform: the face the ray meets is 0.125 m south of
//     the cell line, so `floor(l.y / 4)` is the centre cell and the 6 x 6 block
//     centred on it is the platform's own block, one storey up. Every deck of
//     the upper storey therefore has a deck DIRECTLY BELOW IT, which is what
//     `supported()` asks for, so the fixture is a base a player can build rather
//     than one only a probe can hold.
//   * THE UPPER STOREY IS BROUGHT IN THROUGH `Structures.adopt`, which is the
//     call `commitTarget` and `StructureSave.restore` BOTH make, and then the
//     whole world is SAVED AND RELOADED before a single reading is taken. After
//     that round trip every part in the fixture has been through the real
//     serialiser and the real restore, so whatever this probe wrote, the state
//     under measurement is one the shipped game produced from a save file.
//
// THE A/B, and it is the one GP-966 did not get. That experiment compared two
// BUILDS at ONE standoff of 3 m, where `MIN_PLACE_M` discards the hit before
// the block is derived, so neither arm ever reached the flank path: it was
// inconclusive, not negative. Here the eye and the aim ray are IDENTICAL across
// the two arms and the only difference in the world is one wall, demolished
// through the X key's own handler between the readings.
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
  const r3 = (v) => +v.toFixed(3);
  const D = 180 / Math.PI;
  // pad.js's clamp, same reason: `y / r` is mathematically in [-1, 1] and lands
  // a few ULPs outside it at this body's 600 km radius often enough to matter.
  const latDeg = (y, r) => Math.asin(Math.max(-1, Math.min(1, y / (r || 1)))) * D;

  await sleep(1.0);
  check('this run is SANDBOX', of.game().mode.sandbox === true,
    JSON.stringify(of.game().mode));
  let st = of.structures();
  let pads = of.pads();
  if (st === null || pads === null) return { valid: false, why: 'no structures/pads' };

  // ---- aiming at a POINT, by calibration. Verbatim from pad.js, same reason:
  // this file has no business knowing what frame `of.look` speaks.
  const aimRay = () => of.world().player.aim;
  let yawOffset = 0;
  const horizAngle = (o, d) => {
    const r = Math.hypot(o[0], o[1], o[2]) || 1;
    const u = [o[0] / r, o[1] / r, o[2] / r];
    const k = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const h = [d[0] - u[0] * k, d[1] - u[1] * k, d[2] - u[2] * k];
    const e = [-u[1], u[0], 0];
    const el = Math.hypot(e[0], e[1], e[2]) || 1;
    const ex = [e[0] / el, e[1] / el, e[2] / el];
    const nx = [u[1] * ex[2] - u[2] * ex[1], u[2] * ex[0] - u[0] * ex[2],
      u[0] * ex[1] - u[1] * ex[0]];
    return Math.atan2(h[0] * ex[0] + h[1] * ex[1] + h[2] * ex[2],
      h[0] * nx[0] + h[1] * nx[1] + h[2] * nx[2]) * D;
  };
  const pitchOf = (o, d) => {
    const r = Math.hypot(o[0], o[1], o[2]) || 1;
    const ratio = Math.max(-1, Math.min(1,
      (d[0] * o[0] + d[1] * o[1] + d[2] * o[2]) / r));
    return Math.asin(ratio) * D;
  };
  {
    const a = aimRay();
    yawOffset = of.world().observer.yawDeg - horizAngle(a.origin, a.dir);
  }
  const aimAt = async (p) => {
    for (let i = 0; i < 2; ++i) {
      const a = aimRay();
      const d = [p.x - a.origin[0], p.y - a.origin[1], p.z - a.origin[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      const r0 = Math.hypot(a.origin[0], a.origin[1], a.origin[2]) || 1;
      const up0 = [a.origin[0] / r0, a.origin[1] / r0, a.origin[2] / r0];
      const vert0 = d[0] * up0[0] + d[1] * up0[1] + d[2] * up0[2];
      const horiz = Math.hypot(d[0] - up0[0] * vert0, d[1] - up0[1] * vert0,
        d[2] - up0[2] * vert0);
      if (horiz < 0.5) {
        of.look(of.world().observer.yawDeg, -82); await sleep(1 / 60); continue;
      }
      const u = [d[0] / l, d[1] / l, d[2] / l];
      const pitch = Math.max(-82, Math.min(82, pitchOf(a.origin, u)));
      of.look(horizAngle(a.origin, u) + yawOffset, pitch);
      await sleep(1 / 60);
    }
  };
  // How far along the CURRENT aim ray the first solid of ANY kind sits, marched
  // in probe space with the walker's own unfiltered question. -1 means the ray
  // reached 24 m of REACH_M without meeting anything. This is what says whether
  // a reading is on the flank path at all: a hit inside MIN_PLACE_M (3.2 m) is
  // thrown away by `aimHit` before the block is derived, which is exactly the
  // trapdoor GP-966's A/B fell through.
  const firstSolidT = () => {
    const a = aimRay();
    for (let t = 0.2; t <= 24; t += 0.2) {
      if (of.solidBuild(a.origin[0] + a.dir[0] * t, a.origin[1] + a.dir[1] * t,
        a.origin[2] + a.dir[2] * t) === true) return +t.toFixed(2);
    }
    return -1;
  };
  const ghost = () => of.game().build.padGhost;
  const sGhost = () => of.game().build.structGhost;
  // A body-frame point in the site's own (east, north, up) metres. `localOf`'s
  // three lines, because every height in this file is a height over the site
  // plane and that is the number the level derivation reads.
  const localOf = (p) => {
    const dx = p.x - site.o.x, dy = p.y - site.o.y, dz = p.z - site.o.z;
    return {
      e: dx * site.east.x + dy * site.east.y + dz * site.east.z,
      n: dx * site.north.x + dy * site.north.y + dz * site.north.z,
      u: dx * site.up.x + dy * site.up.y + dz * site.up.z,
    };
  };
  const bar = () => of.game().hotbar;
  const slotOf = (part) => bar().slots.findIndex((s) => s.part === part);
  const hold = async (i) => { of.input.act([`slot${i + 1}`], 4); await sleep(0.25); };

  // ======================================================================
  // 0. THE MODULE. Every offset below is derived from these four numbers, so a
  //    re-authored module moves the fixture instead of breaking its claims.
  // ======================================================================
  const M = st.module;
  const C = M.cellM, STOREY = M.storey;
  // `AIM_STEP_M` (StructureGrid.ts). The march samples every 0.2 m and returns
  // the first sample INSIDE a solid, so every hit height in this file is up to
  // one step past the surface it names. It is the tolerance the shipped
  // derivation carries and therefore the tolerance this file compares against.
  const AIM_STEP = 0.2;
  const CELLS = pads.cells(C);
  log.push(`module: ${JSON.stringify(M)}, pad covers ${CELLS} x ${CELLS} cells`);
  check('the storey is the wall plus its deck, so a wall TOP is a storey plane',
    Math.abs(M.deckH + M.wallH - STOREY) < 1e-9, `${M.deckH}+${M.wallH}`);
  check('and a wall face therefore spans MORE than half a storey, which is what '
    + 'makes a mid-face hit round UP to a storey nothing stands on',
    M.deckH + M.wallH > STOREY * 0.5, `${M.wallH} of ${STOREY}`);

  // ======================================================================
  // 1. THE GROUND FLOOR. pad.js's own 6 x 6, laid by real aims at real cells.
  // ======================================================================
  const fSlot = slotOf('foundation');
  const wSlot = slotOf('wall');
  const padSlot = slotOf('launchpad');
  check('foundation, wall and launch pad all have hotbar slots',
    fSlot >= 0 && wSlot >= 0 && padSlot >= 0,
    JSON.stringify(bar().slots.map((s) => s.part)));
  await hold(fSlot);
  of.look(of.world().observer.yawDeg, -34);
  await sleep(0.2);
  of.input.act(['use'], 4);
  await sleep(0.35);
  check('the first foundation founded a site', st.sites.length >= 1, st.sites.length);
  let site = st.sites[st.sites.length - 1];
  const siteId = site.id;
  // Site-local (east, north, up) metres to a body-frame point. `worldOf`'s own
  // arithmetic, three lines, because the probe needs it before anything is built.
  const at = (e, n, u) => ({
    x: site.o.x + site.east.x * e + site.north.x * n + site.up.x * u,
    y: site.o.y + site.east.y * e + site.north.y * n + site.up.y * u,
    z: site.o.z + site.east.z * e + site.north.z * n + site.up.z * u,
  });
  const cellPoint = (i, j) => at((i + 0.5) * C, (j + 0.5) * C, 0);
  const first = of.game().structures.parts.find((p) => p.kind === 'foundation');
  const base = first?.addr ?? [0, 0, 0];
  const HALF = Math.floor(CELLS / 2);
  const i0 = base[0] - HALF, j0 = base[1] - HALF;
  const deckAt = (i, j, level) => of.game().structures.parts.some((q) =>
    q.kind === 'foundation' && q.addr !== null && q.addr[0] === i
    && q.addr[1] === j && q.addr[2] === level);
  for (let di = 0; di < CELLS; ++di) {
    for (let dj = 0; dj < CELLS; ++dj) {
      await aimAt(cellPoint(i0 + di, j0 + dj));
      of.input.act(['use'], 3);
      await sleep(1 / 30);
    }
  }
  // pad.js's repair pass, and for pad.js's reason: the aim march stops on the
  // nearest deck's top face, so a crosshair swung across a part-built platform
  // addresses the wrong cell. A player solves this by walking; so does this.
  const standOff = async (p, m) => {
    const s = { x: p.x - site.north.x * m, y: p.y - site.north.y * m,
      z: p.z - site.north.z * m };
    const cr = Math.hypot(s.x, s.y, s.z) || 1;
    of.teleport(latDeg(s.y, cr), Math.atan2(s.z, s.x) * D, 0);
    await sleep(0.45);
  };
  for (let pass = 0; pass < 60; ++pass) {
    let gap = null;
    for (let di = 0; di < CELLS && gap === null; ++di) {
      for (let dj = 0; dj < CELLS && gap === null; ++dj) {
        if (!deckAt(i0 + di, j0 + dj, 0)) gap = [i0 + di, j0 + dj];
      }
    }
    if (gap === null) break;
    const c = cellPoint(gap[0], gap[1]);
    await standOff(c, 3);
    await aimAt(c);
    of.input.act(['use'], 3);
    await sleep(1 / 20);
    if (!deckAt(gap[0], gap[1], 0)) {
      log.push(`cell ${gap} would not take a foundation, ghost `
        + `${JSON.stringify(sGhost()?.addr)}: ${sGhost()?.reason}`);
      break;
    }
  }
  let ground = 0;
  for (let di = 0; di < CELLS; ++di) {
    for (let dj = 0; dj < CELLS; ++dj) if (deckAt(i0 + di, j0 + dj, 0)) ground++;
  }
  log.push(`ground floor: ${ground} of ${CELLS * CELLS} cells at level 0, `
    + `block [${i0},${j0},0]`);
  check('the ground floor is a complete 6 x 6', ground === CELLS * CELLS, ground);

  // ======================================================================
  // 2. THE WALL, PLACED BY THE PLAYER'S OWN KEY. North edge of the centre cell.
  //
  //    `addressAt` puts a wall on the NEAREST cell edge, so aiming at the middle
  //    of the north edge line of cell `base` gives axis 0 at (base_i, base_j+1)
  //    by its own rule (|a - round(a)| is 0.5 and |b - round(b)| is 0, so the
  //    north-south tie goes to the east-spanning edge). Asserted rather than
  //    assumed, because everything below is addressed off this wall.
  // ======================================================================
  await hold(wSlot);
  const wallLineN = (base[1] + 1) * C;
  const wallMid = at((base[0] + 0.5) * C, wallLineN, M.deckH);
  await standOff(wallMid, 6);
  await aimAt(wallMid);
  await sleep(0.2);
  log.push(`wall ghost before the press: ${JSON.stringify(sGhost()?.addr)} `
    + `ok ${sGhost()?.ok} "${sGhost()?.reason}"`);
  of.input.act(['use'], 4);
  await sleep(0.35);
  // THE DUMP AND THE LIVE PART ARE DIFFERENT OBJECTS, and mixing them is a real
  // trap this file already fell into once: `game().structures.parts` publishes
  // `addr` as the five-number array a save uses and has no THREE vectors on it,
  // while `structures().parts` holds the live `StructurePart` with an `Addr`
  // OBJECT and real `up`/`fwd`. Addresses are asserted off the dump; anything
  // that has to be handed back to `adopt` comes off the live part.
  const wallDump = of.game().structures.parts.find((p) => p.kind === 'wall');
  check('a wall went down on the centre cell\'s north edge, by the real key',
    wallDump !== undefined && wallDump.addr !== null
      && wallDump.addr[0] === base[0] && wallDump.addr[1] === base[1] + 1
      && wallDump.addr[2] === 0 && wallDump.addr[3] === 0,
    JSON.stringify(wallDump?.addr));
  const wall = st.parts.find((p) => p.kind === 'wall');
  if (wall === undefined) return { valid: false, fails, log, why: 'no wall' };
  const wallRec = { addr: { ...wall.addr }, key: wall.key,
    pos: { x: wall.pos.x, y: wall.pos.y, z: wall.pos.z },
    up: wall.up.clone(), fwd: wall.fwd.clone() };

  // ======================================================================
  // 2b. THE BOUNDARY PROFILE, and it is what any fix to the level derivation
  //     has to be judged against, because a wall is a legal base and its TOP is
  //     a storey plane. DW-32 ships on that: `addressAt`'s own doc says "aiming
  //     at a wall top puts the next floor over it", and `supported()` accepts a
  //     deck at level L over a WALL at L-1. So the set of bodies the march may
  //     see cannot be the answer -- the same wall must be visible for its top
  //     and invisible for its face -- and the only thing that separates those
  //     two readings is the HEIGHT of the hit.
  //
  //     This walks the aim up the wall with a foundation in hand and records,
  //     at each step, the height the march actually returned and the level the
  //     shipped expression makes of it. The wall spans 0.5 to 4.0. Everything
  //     from 2.0 upward is called level 1 today; only the readings at the very
  //     top are aiming at anything a floor could rest on.
  // ======================================================================
  await hold(fSlot);
  const profile = [];
  for (const zt of [1.0, 2.0, 2.5, 3.0, 3.5, 3.8, 3.95, 4.0, 4.3]) {
    const p = at((base[0] + 0.5) * C, wallLineN - M.wallT * 0.5 - 0.1, zt);
    await standOff(at((base[0] + 0.5) * C, wallLineN, 0), 6);
    await aimAt(p);
    await sleep(0.15);
    const t = firstSolidT();
    const a = aimRay();
    const h = t < 0 ? null : localOf({ x: a.origin[0] + a.dir[0] * t,
      y: a.origin[1] + a.dir[1] * t, z: a.origin[2] + a.dir[2] * t });
    const g = sGhost();
    profile.push({ aimZ: zt, firstSolidM: t, hitU: h === null ? null : r3(h.u),
      level: g?.addr?.[2] ?? null, ok: g?.ok ?? null });
  }
  log.push(`GP-1027 boundary profile, foundation in hand, aim walked up a wall `
    + `that spans u ${M.deckH} to ${M.deckH + M.wallH}: ${JSON.stringify(profile)}`);
  // THE PROFILE IS THE WHOLE ARGUMENT ABOUT THE FIX, in one row of numbers, and
  // it is why "ignore the bodies a placement cannot stand on" (GP-966) could
  // never have been the answer even if its A/B had reached the flank path. A
  // WALL IS A LEGAL BASE: `supported()` accepts a deck at level L over a wall at
  // L-1, and DW-32 ships on aiming at a wall's top to put the next floor over
  // it. So the wall has to stay in the march, and the same body has to give a
  // level-1 answer for its crown and a level-0 answer for its face. No filter
  // over BODIES can do that. Only the height can.
  //
  // MEASURED, both arms on this fixture, hit heights identical to the mm:
  //   aim z    1.0    2.0    2.5    3.0    3.5    3.8    3.95   4.0
  //   hit u    0.978  1.995  2.514  3.024  3.561  3.852  3.993  none
  //   before   0      0      1      1      1      1      1      0 (fallback)
  //   after    0      0      0      0      0      1      1      0 (fallback)
  // The band that changed is 2.0 to 3.8 m up a 4 m wall, which is face and
  // nothing else; the crown band 3.8 to 4.0 is `AIM_STEP_M` wide and is exactly
  // the march's own undershoot, because from below the ray never reaches the top
  // FACE at all -- it grazes and stops on the face 0.007 m under the crown.
  const crownAims = profile.filter((r) => r.hitU !== null
    && r.hitU > STOREY - 0.2);
  const faceAims = profile.filter((r) => r.hitU !== null && r.hitU > 2.0
    && r.hitU <= STOREY - 0.2);
  check('DW-32 SURVIVES: an aim that reaches the wall\'s crown, within the '
    + 'march\'s own 0.2 m undershoot of it, still names the storey over the wall',
    crownAims.length > 0 && crownAims.every((r) => r.level === 1 && r.ok === true),
    JSON.stringify(crownAims));
  check('and an aim at the wall\'s FACE, above the old half-storey line, now '
    + 'names the storey the wall is STANDING ON instead of one that is not there',
    faceAims.length > 0 && faceAims.every((r) => r.level === 0),
    JSON.stringify(faceAims));

  // ======================================================================
  // 3. THE VANTAGE, and it is FIXED from here to the end of the file. One eye
  //    position, one aim point, re-established before every reading, so the two
  //    arms below differ in the world and in nothing else.
  //
  //    FACE_Z 2.5 m is chosen because it is the middle of the band that makes
  //    the defect: the wall spans 0.5 to 4.0, and `round(z / 4)` is 1 for
  //    everything above 2.0. STAND_M 14 keeps the whole ray between the eye
  //    (about 2.1 m, standing on the deck) and 2.5 m, which is under the upper
  //    storey's 4.0 m underside for its whole length, so the ray reaches the
  //    WALL and not the roof. Both are checked below rather than trusted.
  // ======================================================================
  const FACE_Z = 2.5, STAND_M = 14;
  const faceOffset = M.wallT * 0.5 + 0.1;
  const target = at((base[0] + 0.5) * C, wallLineN - faceOffset, FACE_Z);
  const goVantage = async () => {
    const s = at((base[0] + 0.5) * C, wallLineN - STAND_M, 0);
    const cr = Math.hypot(s.x, s.y, s.z) || 1;
    of.teleport(latDeg(s.y, cr), Math.atan2(s.z, s.x) * D, 0);
    await sleep(0.6);
    await aimAt(target);
    await sleep(0.2);
  };
  // Every reading is this object, so the two arms are literally comparable.
  const reading = (label) => {
    const g = ghost();
    const a = aimRay();
    const eye = localOf({ x: a.origin[0], y: a.origin[1], z: a.origin[2] });
    const t = firstSolidT();
    const hit = t < 0 ? null
      : localOf({ x: a.origin[0] + a.dir[0] * t, y: a.origin[1] + a.dir[1] * t,
        z: a.origin[2] + a.dir[2] * t });
    const r = {
      label, addr: g?.addr ?? null, ok: g?.ok ?? null,
      missing: g?.missingCells ?? null, reason: g?.reason ?? '',
      firstSolidM: t, eyeU: r3(eye.u),
      hitU: hit === null ? null : r3(hit.u),
      hitLevelRounded: hit === null ? null : Math.round(hit.u / STOREY),
      hitLevelFloor: hit === null ? null : Math.floor(hit.u / STOREY),
    };
    log.push(`${label}: ${JSON.stringify(r)}`);
    return r;
  };

  await hold(padSlot);
  await goVantage();
  const rLegibility = reading('A0 one storey, wall present (GP-969 reproduced)');
  // THE FLANK PATH IS ACTUALLY REACHED, and this is the assertion GP-966's own
  // A/B could not make. 3.2 m is `MIN_PLACE_M`: a hit inside it never reaches
  // the block derivation at all.
  check('the flank hit is BEYOND MIN_PLACE_M, so the march result is the thing '
    + 'being measured (GP-966 measured at 3 m and never got here)',
    rLegibility.firstSolidM > 3.2, `${rLegibility.firstSolidM} m`);
  check('the ray meets the WALL, not the ground and not the deck: the hit is '
    + 'partway up a vertical face',
    rLegibility.hitU !== null && rLegibility.hitU > 2.0
      && rLegibility.hitU < M.deckH + M.wallH,
    `${rLegibility.hitU} m`);
  // GP-1027, THE FIRST ASSERTION THE FIX OWNS. Before it, this same reading was
  // `[-3,-3,1] ok false "36 of 36 cells have no foundation"`: the hit 2.506 m up
  // a face was addressed at the storey plane 4 m up, and refused only because
  // this base has no second floor. Now it is the storey the wall stands on.
  check('a hit partway up a face names the storey it STANDS ON, not the one it '
    + 'is nearest to (before GP-1027 this read level 1 off a hit at 2.5 m)',
    rLegibility.addr !== null && rLegibility.addr[2] === 0,
    JSON.stringify(rLegibility.addr));
  check('and that is the floor the hit is over, which is what the shipped '
    + '`floor` branch computes from the same height',
    rLegibility.hitLevelFloor === (rLegibility.addr ?? [0, 0, -1])[2],
    `${rLegibility.hitLevelFloor} against ${rLegibility.addr?.[2]}`);
  check('the two derivations genuinely DISAGREE at this hit, so the reading is '
    + 'not vacuous: rounding to the nearest plane still says one storey up',
    rLegibility.hitLevelRounded === 1 && rLegibility.hitLevelFloor === 0,
    `${rLegibility.hitLevelRounded} / ${rLegibility.hitLevelFloor}`);
  // THE STOREY THE OLD EXPRESSION WOULD HAVE INVENTED is what the fixture below
  // has to build, so it is taken from `hitLevelRounded` rather than from the
  // (now fixed) ghost. `[-3,-3]` in plan, exactly over the ground floor, so
  // every cell of it is one `supported()` already allows.
  const bi = i0, bj = j0, bl = rLegibility.hitLevelRounded ?? 1;
  check('the storey the OLD expression named sits exactly over the ground '
    + 'floor, so the worst case can be built out of addresses the shipped rule '
    + 'already accepts rather than out of a state only a probe can hold',
    rLegibility.addr !== null && rLegibility.addr[0] === i0
      && rLegibility.addr[1] === j0 && bl === 1,
    `[${bi},${bj},${bl}] against the ghost ${JSON.stringify(rLegibility.addr)}`);

  // ======================================================================
  // 4. THE SECOND STOREY, at exactly the level the flank read just invented.
  //
  //    Brought in through `Structures.adopt`, which is the ONE call both
  //    `commitTarget` and `StructureSave.restore` make, and then put through a
  //    real save and a real reload before anything is measured. `supported()`
  //    accepts a deck at level L whenever a deck exists at (i, j, L-1), and the
  //    block sits over the ground floor, so all 36 are addresses the shipped
  //    rule already allows: this is a shortcut past the AIMING, not past the
  //    rule. That the rule allows them is asserted, not asserted-by-comment: one
  //    of the 36 is left out and placed by the player's own key at the end.
  // ======================================================================
  const def = st.defFor('foundation');
  check('the foundation definition is loaded', def !== null, JSON.stringify(def));
  const adoptDeck = (i, j, level) => {
    const key = `d:${siteId}:${i},${j},${level}`;
    if (st.partAt(key) !== undefined) return null;
    return st.adopt('foundation', def, siteId,
      { kind: 'foundation', i, j, level, axis: 0, flip: 0 }, key,
      at((i + 0.5) * C, (j + 0.5) * C, level * STOREY),
      site.up.clone(), site.north.clone());
  };
  let adopted = 0;
  for (let di = 0; di < CELLS; ++di) {
    for (let dj = 0; dj < CELLS; ++dj) {
      if (adoptDeck(bi + di, bj + dj, bl) !== null) adopted++;
    }
  }
  log.push(`upper storey: ${adopted} decks adopted at level ${bl}, `
    + `block [${bi},${bj},${bl}]`);
  check('the upper storey is complete', adopted === CELLS * CELLS, adopted);

  // THE ROUND TRIP. After this, every part under measurement came out of the
  // real restore, so the fixture is a state the shipped game produced.
  const wrote = await of.save();
  log.push(`save: ${JSON.stringify(wrote)}`);
  await of.load();
  await sleep(0.6);
  st = of.structures();
  pads = of.pads();
  site = st.sites.find((s) => s.id === siteId) ?? st.sites[st.sites.length - 1];
  let upper = 0;
  for (let di = 0; di < CELLS; ++di) {
    for (let dj = 0; dj < CELLS; ++dj) {
      if (deckAt(bi + di, bj + dj, bl)) upper++;
    }
  }
  const wall2Dump = of.game().structures.parts.find((p) => p.kind === 'wall');
  const wall2 = st.parts.find((p) => p.kind === 'wall');
  log.push(`after save+reload: ${upper} of ${CELLS * CELLS} upper decks, `
    + `wall ${JSON.stringify(wall2Dump?.addr)}`);
  check('the second storey survived a real save and a real reload, so the '
    + 'fixture is a base the shipped serialiser round-trips',
    upper === CELLS * CELLS, upper);
  check('and so did the wall', wall2Dump !== undefined && wall2Dump.addr !== null
    && wall2Dump.addr[1] === base[1] + 1, JSON.stringify(wall2Dump?.addr));
  if (wall2 === undefined) return { valid: false, fails, log, why: 'wall lost' };

  // ======================================================================
  // 5. THE WORST CASE, WHICH IS NOW THE REGRESSION GUARD. This is the state the
  //    whole file exists to reach: the storey the old expression invented is now
  //    REALLY THERE, so `missingDecks` is satisfied at it, `overlapping()` has
  //    no pad at it to object to, and the cost is free in sandbox. Every gate
  //    downstream of the address is open. Before GP-1027 the ghost here read
  //    `[-3,-3,1] ok TRUE missing 0` and the press put a launch pad 1.994 m
  //    above the point the crosshair was on, through a ceiling the player cannot
  //    see past. If that ever comes back, this block goes red.
  // ======================================================================
  await hold(padSlot);
  await goVantage();
  const armB = reading('B  two storeys, wall present  THE WORST CASE');
  check('the flank hit is still beyond MIN_PLACE_M', armB.firstSolidM > 3.2,
    `${armB.firstSolidM} m`);
  check('the ray still meets the WALL and not the new roof (the whole ray is '
    + 'under the upper storey\'s underside)',
    armB.hitU !== null && armB.hitU > 2.0 && armB.hitU < STOREY,
    `${armB.hitU} m`);
  check('THE WORST CASE IS CLOSED: with the invented storey really built, the '
    + 'same face hit still names the storey it stands on and NOT the one over it',
    armB.addr !== null && armB.addr[2] === 0, JSON.stringify(armB.addr));
  check('and the fixture is genuinely armed, so that is not a pass by absence: '
    + 'the storey the old expression named is complete and would have accepted '
    + 'a pad',
    upper === CELLS * CELLS && armB.hitLevelRounded === bl,
    `${upper} decks at level ${bl}, rounded ${armB.hitLevelRounded}`);

  // ======================================================================
  // 6. THE PAIRED CONTROL. The wall is demolished through the X key's own
  //    handler; the eye and the aim ray do not move. Whatever the ghost says
  //    now is what the aim is ACTUALLY pointing at once the face it cannot
  //    build on is out of the way, and the difference between the two readings
  //    is the whole defect with nothing else in it.
  // ======================================================================
  const gone = of.demolish({ part: wall2.id });
  await sleep(0.4);
  check('the wall was demolished', gone !== null
    && of.game().structures.parts.every((p) => p.kind !== 'wall'),
    JSON.stringify(gone));
  await aimAt(target);
  await sleep(0.2);
  const armA = reading('A  two storeys, wall REMOVED  the control');
  check('with the flank gone the aim does not name the upper storey either',
    armA.addr !== null && armA.addr[2] !== bl, JSON.stringify(armA.addr));
  // THE PAIR IS THE POINT AND THE LEVELS NOW AGREE. A wall is a real occluder in
  // PLAN and always was: with it there the address is the cell the ray stopped
  // in, and without it the ray reaches nothing inside REACH_M and GP-289's
  // ground fallback puts the point six metres ahead, three cells south. That
  // difference is legitimate. What the wall may no longer do is move the answer
  // to a STOREY, and the two arms now agree on the level while still differing
  // in plan, which is exactly the shape a correct occluder should have.
  log.push(`THE PAIR: wall present ${JSON.stringify(armB.addr)} ok ${armB.ok}; `
    + `wall removed ${JSON.stringify(armA.addr)} ok ${armA.ok}. One wall, and `
    + `the eye and the aim ray identical in both.`);
  check('the wall changes the cell, which an occluder legitimately does, and no '
    + 'longer changes the STOREY, which is the whole of GP-969',
    armA.addr !== null && armB.addr !== null && armA.addr[2] === armB.addr[2]
      && (armA.addr[0] !== armB.addr[0] || armA.addr[1] !== armB.addr[1]),
    `${JSON.stringify(armA.addr)} against ${JSON.stringify(armB.addr)}`);

  // Put it back, verbatim, through the same call a restore makes, and prove the
  // reading returns: a control that cannot be undone is a control that might
  // have changed something else.
  st.adopt('wall', st.defFor('wall'), siteId, wallRec.addr, wallRec.key,
    wallRec.pos, wallRec.up, wallRec.fwd);
  await sleep(0.3);
  await aimAt(target);
  await sleep(0.2);
  const armB2 = reading('B\' wall restored, the reading must come back');
  check('putting the wall back restores the reading exactly, so the control '
    + 'moved the wall and nothing else',
    armB2.addr !== null && armB.addr !== null
      && armB2.addr[0] === armB.addr[0] && armB2.addr[1] === armB.addr[1]
      && armB2.addr[2] === armB.addr[2] && armB2.ok === armB.ok,
    `${JSON.stringify(armB2.addr)} ok ${armB2.ok}`);

  // ======================================================================
  // 7. THE PRESS. A ghost is an argument; a placed pad is not, and the whole
  //    complaint GP-969 routed was about a pad that looks correct right up to
  //    the press. Before GP-1027 this put a pad at [-3,-3,1], on the roof, and
  //    the number that says so is the LIFT: how far the thing that appeared
  //    stands above the point the crosshair was actually on.
  // ======================================================================
  const wasThere = new Set(pads.list.map((p) => p.id));
  const before = pads.list.length;
  of.input.act(['use'], 4);
  await sleep(0.4);
  const after = of.pads().list;
  const placed = after.find((p) => !wasThere.has(p.id));
  const liftM = placed === undefined ? null
    : r3(placed.level * STOREY + M.deckH - (armB.hitU ?? 0));
  log.push(`THE PRESS, aimed at a wall face ${armB.hitU} m up: pads `
    + `${before} -> ${after.length}; the pad went to `
    + `${placed === undefined ? 'nowhere'
      : JSON.stringify([placed.i, placed.j, placed.level])}, standing `
    + `${liftM} m above the aimed point. It was +1.994 m, on the roof, before `
    + `GP-1027.`);
  // THE SIGN OF THE LIFT IS THE ASSERTION, not its size. A pad that stands on
  // the floor the crosshair is over sits BELOW the aimed point, by less than the
  // storey it is under; the defect put it ABOVE, on a floor out of sight through
  // a ceiling. Measured here: -2.006 m after, +1.994 m before, and the 4.000 m
  // between them is one storey exactly, which is the invention itself.
  check('the press puts the pad on the floor the crosshair is over rather than '
    + 'on the one over the crosshair: the pad stands BELOW the aimed point, '
    + 'within the storey it is under',
    placed !== undefined && liftM !== null
      && liftM <= AIM_STEP && liftM > -STOREY,
    `${liftM} m at level ${placed?.level}`);
  check('and there is no pad on the storey the old expression named',
    after.every((p) => p.level !== bl),
    JSON.stringify(after.map((p) => [p.i, p.j, p.level])));

  log.push(`GP-1026/GP-1027 VERDICT: flank hit at u ${armB.hitU} m on a wall `
    + `spanning ${M.deckH} to ${M.deckH + M.wallH}, crown ${STOREY} m; address `
    + `level ${armB.addr?.[2]} (rounding would say ${armB.hitLevelRounded}), `
    + `ghost ok ${armB.ok} missing ${armB.missing}; the press placed a pad at `
    + `${JSON.stringify(placed === undefined ? null
      : [placed.i, placed.j, placed.level])}, lift ${liftM} m. The storey the `
    + `old expression named is fully built (${upper} decks at level ${bl}) and `
    + `is NOT what the aim resolved.`);

  return { valid: fails.length === 0, fails, log,
    numbers: { groundBlock: [i0, j0, 0], inventedStorey: [bi, bj, bl],
      profile, armA, armB, armB2, padsBefore: before, padsAfter: after.length,
      placedAt: placed === undefined ? null
        : [placed.i, placed.j, placed.level], liftM } };
})()
