// GP-76. THE STAIRS ON THE LAUNCH PAD, WALKED. Reid, playtesting on 2026-07-27: "the
// stairs on the launch pad dont work".
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5412/ --sandbox=1 \
//     --evalfile=tools/smoke/probes/padstair.js
//
// WHAT THIS MEASURES AND WHY IT IS A HEIGHT AND NOT A BOOLEAN. `onDeck` is
// already true at the foot of the stairs, because the pad stands on 36
// foundations and their 0.50 m decks are structural solids too, so "am I on a
// deck" answers yes to a player who has climbed nothing. The number that means
// the stairs work is therefore the radius gained ABOVE THE PAD'S OWN BASE
// PLANE: the deck top is 2.00 m over it (`DECK_Z` in build_launch_pad.py, and
// the same 2.00 the shipped `socket_vessel` sits at, which the probe reads off
// the asset rather than retyping). Zero means the player is standing on the
// platform looking at a wall. Two means they are on the pad.
//
// THE WALK IS DRIVEN (standing rule 3): `of.input.tape` fills the same queue a
// keyboard fills and every fixed tick runs. Nothing here teleports the player
// up. The one teleport is to the FOOT of the stairs before the walk starts,
// which is a spawn and not a climb, and its radius is recorded as the baseline.
//
// It also prints a STATIC PROFILE of the stair run through `of.solidBuild`,
// which is the walker's own predicate: the highest solid point over each metre
// of the run. Before the fix that profile is flat 0.00 for the whole 2.72 m of
// stairs and then jumps to 2.00 at the top wall, which is the defect in one
// column of numbers.
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
  const R = (v, n = 3) => +v.toFixed(n);
  const D = 180 / Math.PI;

  await sleep(1.0);
  check('this run is SANDBOX', of.game().mode.sandbox === true,
    JSON.stringify(of.game().mode));
  const st = of.structures();
  const pads = of.pads();
  if (st === null || pads === null) return { valid: false, why: 'no structures/pads' };

  // ---- aiming at a POINT, by calibration (verbatim from probes/pad.js) ------
  const aimRay = () => of.world().player.aim;
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
    return Math.asin((d[0] * o[0] + d[1] * o[1] + d[2] * o[2]) / r) * D;
  };
  let yawOffset = 0;
  {
    const a = aimRay();
    yawOffset = of.world().observer.yawDeg - horizAngle(a.origin, a.dir);
  }
  const aimAt = async (p) => {
    for (let i = 0; i < 2; ++i) {
      const a = aimRay();
      const d = [p.x - a.origin[0], p.y - a.origin[1], p.z - a.origin[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      if (l < 0.5) { of.look(of.world().observer.yawDeg, -82); await sleep(1 / 60); continue; }
      const u = [d[0] / l, d[1] / l, d[2] / l];
      const pitch = Math.max(-82, Math.min(82, pitchOf(a.origin, u)));
      of.look(horizAngle(a.origin, u) + yawOffset, pitch);
      await sleep(1 / 60);
    }
  };
  const goTo = async (p, secs = 0.6) => {
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    of.teleport(Math.asin(p.y / r) * D, Math.atan2(p.z, p.x) * D, 0);
    await sleep(secs);
  };

  // ======================================================================
  // 1. A PLATFORM AND A PAD, through the real hotbar and the real aim march.
  //    Lifted from probes/pad.js so the thing being walked on is the thing that
  //    probe already accepts, rather than a pad this file invented.
  // ======================================================================
  const m = pads.module;
  const CELLS = pads.cells(st.module.cellM);
  const bar = () => of.game().hotbar;
  const slotOf = (part) => bar().slots.findIndex((s) => s.part === part);
  const hold = async (i) => { of.input.act([`slot${i + 1}`], 4); await sleep(0.25); };

  await hold(slotOf('foundation'));
  of.look(of.world().observer.yawDeg, -34);
  await sleep(0.2);
  of.input.act(['use'], 4);
  await sleep(0.35);
  if (st.sites.length === 0) return { valid: false, why: 'no site founded' };
  const site = st.sites[st.sites.length - 1];
  const C = st.module.cellM;
  const cellPoint = (i, j) => ({
    x: site.o.x + site.east.x * (i + 0.5) * C + site.north.x * (j + 0.5) * C,
    y: site.o.y + site.east.y * (i + 0.5) * C + site.north.y * (j + 0.5) * C,
    z: site.o.z + site.east.z * (i + 0.5) * C + site.north.z * (j + 0.5) * C,
  });
  const first = of.game().structures.parts.find((p) => p.kind === 'foundation');
  const base = first?.addr ?? [0, 0, 0];
  const HALF = Math.floor(CELLS / 2);
  const i0 = base[0] - HALF, j0 = base[1] - HALF;
  for (let di = 0; di < CELLS; ++di) {
    for (let dj = 0; dj < CELLS; ++dj) {
      await aimAt(cellPoint(i0 + di, j0 + dj));
      of.input.act(['use'], 3);
      await sleep(1 / 30);
    }
  }
  const laidAt = (i, j) => of.game().structures.parts.some((q) => q.kind === 'foundation'
    && q.addr !== null && q.addr[0] === i && q.addr[1] === j && q.addr[2] === 0);
  for (let pass = 0; pass < 40; ++pass) {
    let gap = null;
    for (let di = 0; di < CELLS && gap === null; ++di) {
      for (let dj = 0; dj < CELLS && gap === null; ++dj) {
        if (!laidAt(i0 + di, j0 + dj)) gap = [i0 + di, j0 + dj];
      }
    }
    if (gap === null) break;
    const c = cellPoint(gap[0], gap[1]);
    await goTo(c, 0.35);
    await aimAt(c);
    of.input.act(['use'], 3);
    await sleep(1 / 20);
    if (!laidAt(gap[0], gap[1])) {
      log.push(`cell ${gap} refused: ${of.game().build.structGhost?.reason}`);
      break;
    }
  }
  check('the 6 x 6 platform is complete',
    of.game().structures.parts.filter((p) => p.kind === 'foundation'
      && p.addr !== null && p.addr[0] >= i0 && p.addr[0] < i0 + CELLS
      && p.addr[1] >= j0 && p.addr[1] < j0 + CELLS && p.addr[2] === 0).length
    === CELLS * CELLS);

  await hold(slotOf('launchpad'));
  await goTo(cellPoint(base[0], base[1]), 0.6);
  of.look(of.world().observer.yawDeg, -82);
  await sleep(0.3);
  of.input.act(['use'], 4);
  await sleep(0.5);
  const pad = pads.list[pads.list.length - 1];
  if (pad === undefined) {
    return { valid: false, fails, log, why: 'no pad placed',
      ghost: of.game().build.padGhost };
  }

  // ======================================================================
  // 2. THE PAD'S OWN FRAME. `side` is local +X and `fwd` is local +Z, which is
  //    the same basis probes/pad.js resolves its solidity samples in, so the
  //    two files cannot drift into different ideas of where the trench is.
  // ======================================================================
  const side = { x: pad.up.y * pad.fwd.z - pad.up.z * pad.fwd.y,
    y: pad.up.z * pad.fwd.x - pad.up.x * pad.fwd.z,
    z: pad.up.x * pad.fwd.y - pad.up.y * pad.fwd.x };
  const local = (lx, ly, lz) => ({
    x: pad.pos.x + side.x * lx + pad.up.x * ly + pad.fwd.x * lz,
    y: pad.pos.y + side.y * lx + pad.up.y * ly + pad.fwd.y * lz,
    z: pad.pos.z + side.z * lx + pad.up.z * ly + pad.fwd.z * lz,
  });
  const solidAt = (lx, ly, lz) => {
    const p = local(lx, ly, lz);
    return of.solidBuild(p.x, p.y, p.z);
  };
  const padBaseR = Math.hypot(pad.pos.x, pad.pos.y, pad.pos.z);
  // The stair notch, in the pad's own local metres. Authored in
  // tools/blender/build_launch_pad.py: STAIR_X 6.70, STAIR_W 2.60, the run from
  // STAIR_S 9.20 to STAIR_N 11.92 of Blender +Y, which is glTF -Z.
  const STAIR_X = 6.70;
  const STAIR_Z0 = -11.92, STAIR_Z1 = -9.20;

  // ---- the static profile: the highest solid point over the stair run ------
  const topSolid = (lx, lz) => {
    for (let y = 2.60; y > -0.20; y -= 0.05) if (solidAt(lx, y, lz)) return y;
    return null;
  };
  const profile = [];
  for (let lz = -13.0; lz <= -8.4; lz += 0.4) {
    profile.push({ z: R(lz, 2), top: topSolid(STAIR_X, lz) });
  }
  log.push(`stair profile (local z -> highest solid y): ${profile
    .map((p) => `${p.z}:${p.top === null ? 'none' : p.top.toFixed(2)}`).join(' ')}`);
  // WHAT THE PROFILE HAS TO SHOW IS A RISE, NOT MERELY SOLIDITY. Every column
  // over the run reads solid at y = 0 whatever the pad does, because the pad
  // stands on 36 foundations and their decks are structural solids too. The
  // first version of this check asked "does the run carry ANY collision" and
  // went green 7 of 7 on the broken build. So the number is the HIGHEST solid
  // point reached inside the run: 0.00 with no tread proxies, 2.00 with them.
  const inRun = profile.filter((p) => p.z >= STAIR_Z0 && p.z <= STAIR_Z1);
  const runTopM = inRun.reduce((a, p) => Math.max(a, p.top ?? 0), 0);
  log.push(`stair run: highest solid point over the ${inRun.length} sampled `
    + `columns is ${R(runTopM)} m above the pad base`);

  // ======================================================================
  // 3. THE WALK. Spawn at the foot of the run, face along the pad's local +Z
  //    (which is uphill: the bottom tread is at local z -11.92 and the deck
  //    resumes at -9.20), then hold the walk key.
  // ======================================================================
  const foot = local(STAIR_X, 0, STAIR_Z0 - 2.2);
  await goTo(foot, 1.2);
  // Face uphill. The yaw solve is the calibrated one above; aiming at a point
  // 12 m straight ahead on the stair centre line keeps the heading parallel to
  // the run rather than converging on the pad centre and walking off the treads.
  await aimAt(local(STAIR_X, 1.0, STAIR_Z1 + 9.0));
  await sleep(0.4);
  {
    const a = aimRay();
    const dot = a.dir[0] * pad.fwd.x + a.dir[1] * pad.fwd.y + a.dir[2] * pad.fwd.z;
    check('the crosshair points UP the stairs, along the pad local +Z', dot > 0.9,
      R(dot, 4));
  }

  const feetNow = () => of.world().player.feet;
  const radiusNow = () => { const f = feetNow(); return Math.hypot(f[0], f[1], f[2]); };
  const localZof = () => {
    const f = feetNow();
    const d = [f[0] - pad.pos.x, f[1] - pad.pos.y, f[2] - pad.pos.z];
    return d[0] * pad.fwd.x + d[1] * pad.fwd.y + d[2] * pad.fwd.z;
  };
  const localXof = () => {
    const f = feetNow();
    const d = [f[0] - pad.pos.x, f[1] - pad.pos.y, f[2] - pad.pos.z];
    return d[0] * side.x + d[1] * side.y + d[2] * side.z;
  };

  const startR = radiusNow();
  const startZ = localZof();
  log.push(`start: r ${R(startR)} (pad base ${R(padBaseR)}), local z ${R(startZ, 2)}`
    + `, local x ${R(localXof(), 2)}, onDeck ${of.world().player.onDeck}`);

  // A tape long enough to outlast the whole walk, then short slices so the
  // climb is sampled rather than only its endpoint.
  const WALK_SECS = 5.0, SLICE = 0.2;
  of.input.tape([{ hold: Math.ceil(60 * WALK_SECS) + 120, keys: ['KeyW'] }]);
  const track = [];
  let bestR = startR, blocked = 0, walked = 0;
  for (let t = 0; t < WALK_SECS; t += SLICE) {
    await of.run(SLICE, 60);
    walked = t + SLICE;
    const w = of.world().player;
    const r = radiusNow();
    if (r > bestR) bestR = r;
    if (w.blockedByBuild) blocked++;
    track.push({ t: R(walked, 2), gain: R(r - padBaseR, 3), z: R(localZof(), 2),
      x: R(localXof(), 2), onDeck: w.onDeck, stuck: w.blockedByBuild });
    // Stop the instant the deck has been reached, so the walk does not run on
    // across the pad and into the propellant tank.
    if (w.onDeck && r - padBaseR > m.standM - 0.15 && localZof() > STAIR_Z1) break;
  }
  of.input.tape([{ hold: 240, keys: [] }]);
  await sleep(0.6);

  const endR = radiusNow();
  const deckGainM = endR - padBaseR;
  const climbM = endR - startR;
  const endZ = localZof(), endX = localXof();
  log.push(`end: r ${R(endR)}, deck gain ${R(deckGainM)} m, total climb `
    + `${R(climbM)} m, local z ${R(endZ, 2)}, local x ${R(endX, 2)}`);
  log.push(`track: ${track.map((s) => `${s.t}s z${s.z} +${s.gain}`).join('  ')}`);

  // ---- the assertions ------------------------------------------------------
  // The pad's own `socket_vessel` height IS the deck top, read off the asset by
  // `measurePad`, so the bar is the file's number and not one retyped here.
  check('the player ENDED on the pad deck, 2.00 m above the pad base',
    deckGainM > m.standM - 0.15, `${R(deckGainM)} m of ${R(m.standM)}`);
  check('and got there by walking, past the top of the stair run',
    endZ > STAIR_Z1, `local z ${R(endZ, 2)} vs run top ${STAIR_Z1}`);
  check('the walker reports standing on a structure', of.world().player.onDeck === true);
  check('it never wedged: the run was not spent refused by the pad',
    blocked < track.length * 0.5, `${blocked} of ${track.length} slices blocked`);
  check('and it stayed ON the treads rather than drifting off the side',
    Math.abs(endX - STAIR_X) < 1.6, `local x ${R(endX, 2)} vs ${STAIR_X}`);
  check('the stair run RISES: there is tread under the top of it, statically',
    runTopM > m.standM - 0.3, `highest solid ${R(runTopM)} m over the run`);

  return {
    valid: fails.length === 0,
    fails,
    log,
    heightGainedM: R(climbM),
    deckGainM: R(deckGainM),
    padDeckHeightM: R(m.standM),
    startRadiusM: R(startR, 4),
    endRadiusM: R(endR, 4),
    padBaseRadiusM: R(padBaseR, 4),
    walkSecs: R(walked, 2),
    blockedSlices: blocked,
    stairRunTopSolidM: R(runTopM),
    structureTestsPerTick: of.world().player.structureTests,
    stairProfile: profile,
    track,
  };
})()
