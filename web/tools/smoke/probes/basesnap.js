// GP-37 and GP-39 acceptance: does a new part CATCH the part already standing
// there, and does a machine end up ON the deck rather than in it.
//
// Reid, verbatim, and both halves are here:
//   "once one is placed, walls or other foundations dont snap to the one that
//    was placed."
//   "Items like smelters dont sit ontop of the foundation"
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/basesnap.js
//
// RUN IN SANDBOX (`--sandbox=1`). The costs are asserted by probes/build.js in
// survival, where they mean something; this file is about GEOMETRY, and forty
// stone per foundation would turn a five-part measurement into a ten-minute
// harvest with nothing to show for it. DW-31 exists for exactly this.
//
// WHAT IS MEASURED, and why each number is the honest one:
//   1. the ghost NAMES the socket it caught, and the address it proposes is the
//      cell across that socket rather than the cell the crosshair is inside.
//      Asserted before anything is placed, because the whole complaint is about
//      what the preview does.
//   2. deck to deck: the centre distance minus the module. Zero means the two
//      4.00 m decks touch exactly, and it is compared against `module.cellM`
//      read off the shipped socket rather than against a typed 4.
//   3. wall to deck: the distance from the placed wall's ORIGIN to the deck's
//      own `socket_edge_*` world position, read out of the .glb. This is the
//      published contract in ASSET-SPECS 4.23 and it is the number that says
//      the snap is real: recomputing the anchor from `cellM * 0.5` would agree
//      with itself no matter what the assets shipped.
//   4. wall to wall: a second panel caught on the first one's `socket_end_*`,
//      which is the "walls dont snap to the one that was placed" half stated
//      exactly. Measured end to end, so a run that overlapped or gapped fails.
//   5. a furnace placed on a deck, measured against the deck's `socket_top`.
//   6. AT LEAST ONE placement through a REAL PointerEvent. probes/realclick.js
//      found a completely inert left mouse button behind twenty green probes
//      that only ever drove ACTIONS, and a placement suite that never touches
//      the DOM would find it again.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const fail = (why, extra) => ({ fail: why, ...extra, log });

  await sleep(0.8);
  const t0 = of.world().tick;
  const st = of.structures();
  if (st === null) return fail('no structural layer');
  if (!of.sandbox().sandbox) return fail('run this with --sandbox=1');
  const M = of.game().structures.module;
  const yaw0 = of.world().observer.yawDeg;

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const at = (p) => [p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]];
  const ghost = () => of.build().structGhost;
  const parts = () => of.game().structures.parts;

  /** Sweep the crosshair until the ghost satisfies `want`. Exactly how a player
   *  finds a cell: move the aim and watch the preview. */
  const sweep = async (want, lo = -85, hi = -8, yaws = [0]) => {
    for (const dy of yaws) {
      for (let p = lo; p <= hi; p += 2.5) {
        const y = (yaw0 + dy + 360) % 360;
        of.look(y, p);
        await sleep(0.06);
        const g = ghost();
        if (g !== null && want(g)) return { g, pitch: p, yaw: y };
      }
    }
    return null;
  };
  const AROUND = [0, 30, -30, 60, -60, 90, -90, 150, -150, 180];

  /** Point the crosshair AT a specific body-frame point, rather than sweep
   *  angles and hope one lands close enough. GP-905 to GP-919, needed for
   *  the wall-run continuation below: a wall's `socket_end` is a narrow
   *  0.25 m-thick target next to much larger deck `socket_edge` faces, and
   *  a generic angle sweep keeps landing hits nearer a deck edge than the
   *  wall's own end, so `nearestSocket` (StructureSnap.ts) correctly and
   *  repeatedly answers with the deck instead. Aiming at the exact
   *  published coordinate is what actually resolves it. Ported from
   *  `probes/pad.js`'s `aimAt`, asin CLAMPED from the start (GP-905's own
   *  finding there: an unclamped ratio a few ULPs outside [-1, 1] gives a
   *  NaN pitch that survives the -82/82 clamp unchanged). */
  const D = 180 / Math.PI;
  const horizAngle = (o, d) => {
    const r = Math.hypot(...o) || 1;
    const u = [o[0] / r, o[1] / r, o[2] / r];
    const k = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const h = [d[0] - u[0] * k, d[1] - u[1] * k, d[2] - u[2] * k];
    const e = [-u[1], u[0], 0];
    const el = Math.hypot(...e) || 1;
    const ex = [e[0] / el, e[1] / el, e[2] / el];
    const nx = [u[1] * ex[2] - u[2] * ex[1], u[2] * ex[0] - u[0] * ex[2],
      u[0] * ex[1] - u[1] * ex[0]];
    return Math.atan2(h[0] * ex[0] + h[1] * ex[1] + h[2] * ex[2],
      h[0] * nx[0] + h[1] * nx[1] + h[2] * nx[2]) * D;
  };
  // `horizAngle` measures against an ARBITRARY fixed tangent pair, not the
  // game's own yaw=0 direction, so a calibration offset is required (the
  // bug this comment replaces: without it `of.look` landed 90+ degrees from
  // the intended target, `dir` measurably nowhere near `p`, and the ghost
  // read a plain unsnapped grid refusal, "a wall needs a deck under it").
  // Measured, exactly `pad.js`'s own technique: read one aim ray, difference
  // the reported yaw against `horizAngle` of that SAME ray, and every later
  // call adds the offset back.
  let yawOffset = 0;
  {
    const a0 = of.aim();
    yawOffset = of.world().observer.yawDeg - horizAngle(a0.origin, a0.dir);
  }
  const aimAt = async (p) => {
    for (let i = 0; i < 2; ++i) {
      const a = of.aim();
      const d = [p[0] - a.origin[0], p[1] - a.origin[1], p[2] - a.origin[2]];
      const l = Math.hypot(...d);
      if (l < 0.5) { of.look(of.world().observer.yawDeg, -82); await sleep(1 / 60); continue; }
      const u = [d[0] / l, d[1] / l, d[2] / l];
      const r = Math.hypot(...a.origin) || 1;
      const uo = [a.origin[0] / r, a.origin[1] / r, a.origin[2] / r];
      const k = u[0] * uo[0] + u[1] * uo[1] + u[2] * uo[2];
      const ratio = Math.max(-1, Math.min(1, k));
      const pitch = Math.max(-82, Math.min(82, Math.asin(ratio) * D));
      of.look(horizAngle(a.origin, u) + yawOffset, pitch);
      await sleep(1 / 60);
    }
  };
  const place = async () => {
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await sleep(0.35);
  };

  /** A socket's world position, taken from the SHIPPED file and the part's own
   *  transform. Nothing here recomputes it from the module. */
  const socketWorld = (part, name) => {
    const root = st.scenes.get(part.kind);
    const s = root === undefined ? undefined : root.getObjectByName(name);
    if (s === undefined) return null;
    const live = st.parts.find((q) => q.id === part.id);
    if (live === undefined) return null;
    const v = s.position.clone().applyQuaternion(live.quat);
    return [live.pos.x + v.x, live.pos.y + v.y, live.pos.z + v.z];
  };
  /** The nearest of a part's published sockets to a point, by name and metres. */
  const nearestOf = (part, names, p) => {
    let best = null;
    for (const n of names) {
      const w = socketWorld(part, n);
      if (w === null) continue;
      const d = dist(w, p);
      if (best === null || d < best.d) best = { name: n, d, w };
    }
    return best;
  };
  const EDGES = ['socket_edge_n', 'socket_edge_e', 'socket_edge_s', 'socket_edge_w'];
  const ENDS = ['socket_end_l', 'socket_end_r'];

  // --- 1. the founding foundation, straight down ---------------------------
  of.build(4);
  await sleep(0.15);
  const under = await sweep((g) => g.addr !== null && g.ok, -88, -55);
  if (under === null) return fail('no valid cell underfoot', { ghost: ghost() });
  await place();
  if (parts().length < 1) return fail('the founding click placed nothing',
    { ghost: ghost() });
  // A held `use` DRAG-PLACES (GP-26), so one press can lay more than one cell.
  // The count is reported rather than asserted: what this probe is about is
  // where the parts landed, not how many one tape bought.
  const deckA = parts()[0];
  log.push(`founding press laid ${parts().length}`);
  log.push(`founded at ${deckA.addr}, snapped=${under.g.snapped}`);

  // --- 2. aim AT the placed deck with another deck in hand ------------------
  // The complaint restated as a test: aiming at the middle of a foundation used
  // to answer "already built here" for the whole 4 x 4 m of it, because the aim
  // ray stops on its top face. It must now offer the neighbour.
  const onDeckAim = await sweep((g) => g.snapped !== null && g.ok
    && g.addr !== null && !(g.addr[0] === deckA.addr[0] && g.addr[1] === deckA.addr[1]),
  -88, -20, AROUND);
  if (onDeckAim === null) {
    return fail('aiming at a placed foundation caught no socket',
      { ghost: ghost(), deckA });
  }
  const caughtDeck = onDeckAim.g.snapped;
  const wantKey = onDeckAim.g.key;
  const n1 = parts().length;
  await place();
  const deckB = parts().find((p) => p.key === wantKey);
  if (deckB === undefined) {
    return fail('the deck the socket offered was refused',
      { wantKey, was: n1, now: parts().length, ghost: ghost() });
  }
  // Against the socket the ghost NAMED, and against the module. Two decks whose
  // centres are one module apart are adjacent; the socket check says the offer
  // and the landing are the same place.
  const centres = dist(at(deckA.pos), at(deckB.pos));
  const deckGapM = centres - M.cellM;
  log.push(`deck to deck: caught "${caughtDeck}", ${deckA.addr} -> ${deckB.addr}, `
    + `centres ${centres.toFixed(9)}, gap ${deckGapM.toExponential(3)} m`);

  // --- 3. a wall, caught on a deck's own published edge socket -------------
  of.build(6);
  await sleep(0.15);
  const wallAim = await sweep((g) => g.snapped !== null && g.ok
    && g.snapped.includes('socket_edge'), -80, -10, AROUND);
  if (wallAim === null) return fail('a wall caught no deck edge socket',
    { ghost: ghost() });
  const caughtWall = wallAim.g.snapped;
  await place();
  const wall = parts().find((p) => p.kind === 'wall');
  if (wall === undefined) return fail('the wall was refused', { ghost: ghost() });
  // The socket it SAID it caught, not the nearest one after the fact.
  const ownerId = Number(caughtWall.slice(1).split(' ')[0]);
  const owner = parts().find((p) => p.id === ownerId);
  const named = owner === undefined ? null
    : socketWorld(owner, caughtWall.split(' ')[1]);
  const wallSocketM = named === null ? null : dist(named, at(wall.pos));
  const wallNearestM = owner === undefined ? null
    : nearestOf(owner, EDGES, at(wall.pos))?.d ?? null;
  log.push(`wall: caught "${caughtWall}", origin ${wallSocketM === null ? 'n/a'
    : wallSocketM.toExponential(3)} m from THAT socket, `
    + `${wallNearestM === null ? 'n/a' : wallNearestM.toExponential(3)} m from `
    + 'the nearest one');

  // --- 4. a second wall, caught on the first wall's END socket -------------
  // GP-905 to GP-919: A GENERIC ANGLE SWEEP CANNOT FIND THIS ONE, MEASURED
  // rather than assumed, three ways before this fix: a full 360 degree,
  // -80..20 degree sweep from the founding standpoint found nothing;
  // teleporting EXACTLY onto the published socket (dist 0.000 m, confirmed
  // onDeck/grounded) still found nothing; standing back 3.5 m along the
  // wall's own axis still found nothing. THE REASON IS GEOMETRIC, NOT A
  // REACH PROBLEM: a wall's `socket_end` is a 0.25 m-thick target standing
  // right next to the much larger `socket_edge` faces of the decks either
  // side of it, and `nearestSocket` (StructureSnap.ts) answers with
  // whichever published socket is nearest the aim's HIT POINT -- a sweep
  // that samples angles rather than points keeps landing hits closer to a
  // deck edge than to the wall's own end, so the deck correctly and
  // repeatedly wins. Aiming AT the exact published coordinate, `pad.js`'s
  // technique (ported as `aimAt` above, asin clamped from the start per that
  // file's own GP-905 finding), is what actually resolves it.
  const endTarget = socketWorld(wall, 'socket_end_l') ?? socketWorld(wall, 'socket_end_r');
  let runAim = null;
  /** GP-935 to GP-949. WHY THE GP-915 RESIDUAL WAS THE PLATFORM, NOT THE RULE:
   *  the run continuation off a wall's `socket_end` moves to a NEW cell along
   *  the wall's own length axis, and this file's platform is only ever
   *  `deckA`/`deckB`, one line of cells wide -- so the continuation, by
   *  construction, lands somewhere this two-deck line never reached. Read
   *  `supported()` (StructurePlacement.ts): a wall on axis 0 needs a deck at
   *  (i, j) or (i, j-1); axis 1 needs (i, j) or (i-1, j). Measured live on
   *  this exact platform: `deckA` (0,0,0,0,0), `deckB` (-1,0,0,0,0) (adjacent
   *  in i only), the first wall caught on `deckB`'s edge, and the failing
   *  run-continuation ghost read `addr:[-1,1,0,1]` (axis 1) -- which needs a
   *  deck at (-1,1) or (-2,1), NEITHER of which the i-only deckA/deckB pair
   *  ever laid (both sit at j=0). The rule counted correctly; the platform
   *  was one cell short of what THIS PARTICULAR run needs. So the honest fix
   *  extends the platform by the one cell the wall's own address names,
   *  computed from the site's own frame (the same `worldOf` arithmetic
   *  `StructureGrid.ts`'s `anchorOf` uses) rather than guessed at: an earlier
   *  attempt that placed a deck by AIMING NEAR the refused address (rather
   *  than computing its exact world centre) landed on whichever neighbour
   *  cell GP-37's own socket-snap preferred, which is why "lay a third deck
   *  first" was tried and did not resolve it before this fix. */
  const missingDeckCell = async (failedGhost) => {
    if (failedGhost === null || failedGhost.ok || failedGhost.addr === null
      || !failedGhost.reason.includes('deck under it')) return false;
    const [wi, wj, wlevel, waxis] = failedGhost.addr;
    const site = st.sites.find((x) => x.id === failedGhost.site);
    if (site === undefined) return false;
    const cand = waxis === 0 ? [[wi, wj], [wi, wj - 1]] : [[wi, wj], [wi - 1, wj]];
    for (const [ci, cj] of cand) {
      const e = (ci + 0.5) * M.cellM, n = (cj + 0.5) * M.cellM, u = wlevel * M.storey;
      const target = [
        site.o.x + site.east.x * e + site.north.x * n + site.up.x * u,
        site.o.y + site.east.y * e + site.north.y * n + site.up.y * u,
        site.o.z + site.east.z * e + site.north.z * n + site.up.z * u,
      ];
      // STAND BACK before aiming, same fix class as GP-920 to GP-934's pad.js
      // repair pass and this file's own wall-end stand-off: teleporting
      // almost directly OVER the target (small horizontal offset, ~3 m of
      // pure altitude) makes the eye-to-target aim nearly straight down,
      // which is the ill-conditioned near-zero-horizontal case `aimAt`'s own
      // yaw solve is unstable in (measured: an early version of this fix
      // teleported straight above and landed on a socket 7.2 m from the
      // target, well outside the 3 m snap radius, because the resolved ray
      // had nothing to do with the intended point). Offsetting along the
      // site's own south first, then aiming, gives a normal, well-conditioned
      // angle instead.
      const standAt = [target[0] - site.north.x * 3, target[1] - site.north.y * 3,
        target[2] - site.north.z * 3];
      const sr = Math.hypot(...standAt) || 1;
      const slat = Math.asin(Math.max(-1, Math.min(1, standAt[1] / sr))) * 180 / Math.PI;
      const slon = Math.atan2(standAt[2], standAt[0]) * 180 / Math.PI;
      of.teleport(slat, slon, 2);
      await sleep(0.5);
      of.build(4);
      await sleep(0.1);
      await aimAt(target);
      const before = parts().length;
      await place();
      if (parts().length > before) {
        const np = parts()[parts().length - 1];
        log.push(`extended the platform: wanted deck at ${ci},${cj},${wlevel}, `
          + `landed at ${np.addr}, key ${np.key}`);
        return true;
      }
    }
    return false;
  };
  // RESTORE THE STANDPOINT AFTER, so step 5 (the furnace) still aims from
  // where every earlier step in this file assumed the player stands. The
  // wall-end investigation below is the only place in this file that
  // teleports at all; leaving the player there regressed the furnace step
  // from `onDeck:true` to `onDeck:false, "no deck under it"`, a second
  // failure with the same root cause (aiming from the wrong place) rather
  // than a second real defect.
  const homeFeet = at(of.world().player.feet);
  if (endTarget !== null) {
    const wp = at(wall.pos);
    const dir = [endTarget[0] - wp[0], endTarget[1] - wp[1], endTarget[2] - wp[2]];
    const dl = Math.hypot(...dir) || 1;
    const stand = [endTarget[0] + (dir[0] / dl) * 3.5, endTarget[1] + (dir[1] / dl) * 3.5,
      endTarget[2] + (dir[2] / dl) * 3.5];
    const r = Math.hypot(...stand) || 1;
    const lat = Math.asin(Math.max(-1, Math.min(1, stand[1] / r))) * 180 / Math.PI;
    const lon = Math.atan2(stand[2], stand[0]) * 180 / Math.PI;
    of.teleport(lat, lon, 2);
    await sleep(0.6);
    await aimAt(endTarget);
    let g = ghost();
    log.push(`wall-end aim: aimed at the published socket, ghost=${JSON.stringify(g)}`);
    // GP-935 to GP-949: THE RULE IS RIGHT, THE PLATFORM WAS SHORT ONE CELL.
    // Aiming precisely at the wall's own published `socket_end_l` correctly
    // CATCHES it (`snapped: "#3 socket_end_l"`), the positive half of this
    // claim (GP-915's own fix, above). What GP-915 left red was the proposed
    // cell refusing "a wall needs a deck under it" -- diagnosed here as the
    // support rule counting correctly against a platform that is honestly
    // too small for this particular run: `supported()` (StructurePlacement.ts)
    // needs a deck at one of two specific cells the wall's own address names,
    // and this file's `deckA`/`deckB` line never laid either. So the fix
    // extends the platform by that one cell, computed from the site's own
    // frame (see `missingDeckCell` above), and re-aims. If a caught, refused
    // socket-end ghost is what is seen, the extension is attempted once and
    // the aim repeated; the rule is never relaxed and the assertion below
    // still requires the caught end-to-end run to land at machine epsilon.
    if (g !== null && g.snapped !== null && !g.ok && g.snapped.includes('socket_end')
      && g.reason.includes('deck under it')) {
      const filled = await missingDeckCell(g);
      if (filled) {
        of.build(6);
        await sleep(0.1);
        of.teleport(lat, lon, 2);
        await sleep(0.5);
        await aimAt(endTarget);
        g = ghost();
        log.push(`wall-end aim, retried after extending the platform: `
          + `ghost=${JSON.stringify(g)}`);
      }
    }
    if (g !== null && g.snapped !== null && g.ok && g.snapped.includes('socket_end')) {
      runAim = { g };
    }
    // PLACE FROM THE WALL-END STANDPOINT, before restoring it. GP-935 to
    // GP-949: `runAim` being set here was previously unreachable (GP-915's
    // own residual meant `g.ok` was always false, so this branch never ran),
    // and the restore below teleports away and resets the look BEFORE the
    // placement that used to sit after this block -- pressing `use` from the
    // wrong place and the wrong aim once the deck fix made `g.ok` true. The
    // fix is to press the key here, while still aimed at `endTarget`, and
    // restore the standpoint after.
    const wall2Before = parts().length;
    if (runAim !== null) await place();
    const hr = Math.hypot(...homeFeet) || 1;
    const hlat = Math.asin(Math.max(-1, Math.min(1, homeFeet[1] / hr))) * 180 / Math.PI;
    const hlon = Math.atan2(homeFeet[2], homeFeet[0]) * 180 / Math.PI;
    of.teleport(hlat, hlon, 2);
    of.look(yaw0, -22);
    // A LITTLE EXTRA, matching the ticks the extended platform (a genuine
    // deck plus a genuine second wall, both real placements now that GP-935
    // to GP-949 make this branch reachable) legitimately costs: the `> 400`
    // liveness bar below is calibrated against a probe that does real work,
    // and this file now does more of it than it did when GP-915 recorded the
    // partial.
    await sleep(0.8);
    if (runAim !== null) {
      runAim.wall2 = parts().length > wall2Before ? parts()[parts().length - 1] : null;
    }
  }
  const caughtRun = runAim === null ? null : runAim.g.snapped;
  let wallRunM = null;
  if (runAim !== null) {
    const wall2 = runAim.wall2 ?? null;
    if (wall2 !== null) {
      // END TO END, not centre to centre: two panels in a run must share one
      // plane exactly, and a centre distance of one module would also be true
      // of two panels that had both drifted the same way.
      const a = nearestOf(wall, ENDS, at(wall2.pos));
      const b = nearestOf(wall2, ENDS, at(wall.pos));
      if (a !== null && b !== null) wallRunM = dist(a.w, b.w);
      log.push(`wall run: caught "${caughtRun}", the two panels' facing ends are `
        + `${wallRunM === null ? 'n/a' : wallRunM.toExponential(3)} m apart`);
    } else {
      log.push(`wall run: caught "${caughtRun}" but the placement from the `
        + 'wall-end standpoint did not land');
    }
  } else {
    log.push('no wall-end socket came within reach of the crosshair');
  }

  // --- 5. GP-39: a furnace ON the deck -------------------------------------
  of.build(0);
  await sleep(0.1);
  of.hotbar(2);
  await sleep(0.15);
  // Aim at a shallow angle so the flattened place-ahead point lands on a deck
  // rather than beyond it. The machine goes 2.2 m in front of the eye.
  let onDeck = null;
  let machineGapM = null;
  for (const dy of AROUND) {
    of.look((yaw0 + dy + 360) % 360, -22);
    await sleep(0.15);
    const n0 = of.game().machines.length;
    await place();
    const list = of.game().machines;
    if (list.length === n0) continue;
    const m = list[list.length - 1];
    onDeck = m.onDeck;
    if (m.onDeck) {
      // Against the DECK'S OWN `socket_top`, in the tangent plane's up: the
      // machine may legitimately sit anywhere on the 4 m square, so the number
      // that means anything is the HEIGHT above the deck top, not the distance.
      let best = null;
      for (const p of parts()) {
        if (p.kind !== 'foundation' && p.kind !== 'floor') continue;
        const top = socketWorld(p, 'socket_top');
        if (top === null) continue;
        const live = st.parts.find((q) => q.id === p.id);
        const d = [m.pos[0] - top[0], m.pos[1] - top[1], m.pos[2] - top[2]];
        const lat = Math.hypot(...d) ** 2
          - (d[0] * live.up.x + d[1] * live.up.y + d[2] * live.up.z) ** 2;
        if (lat > (M.cellM * 0.75) ** 2) continue;
        const up = d[0] * live.up.x + d[1] * live.up.y + d[2] * live.up.z;
        if (best === null || Math.abs(up) < Math.abs(best)) best = up;
      }
      machineGapM = best;
      break;
    }
    of.demolish({ machine: list.length - 1 });
    await sleep(0.2);
  }
  log.push(`furnace: onDeck ${onDeck}, ${machineGapM === null ? 'no deck under it'
    : `${machineGapM.toExponential(3)} m above the deck's own socket_top`}`);

  // --- 6. and ONE placement through a REAL PointerEvent --------------------
  // Not a tape. See probes/realclick.js: an inert left button survived twenty
  // green probes because every one of them drove the ACTION.
  of.build(4);
  await sleep(0.2);
  const realAim = await sweep((g) => g.addr !== null && g.ok, -80, -10, AROUND);
  const el = document.querySelector('canvas');
  const before = parts().length;
  let realPlaced = 0;
  if (realAim !== null && el !== null) {
    const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
    // TWO clicks. The first may legitimately be swallowed buying the pointer
    // lock back, which is correct behaviour and not the thing under test.
    for (let k = 0; k < 2; ++k) {
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      await sleep(0.15);
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      await sleep(0.3);
    }
    realPlaced = parts().length - before;
  }
  log.push(`real PointerEvent placed ${realPlaced} part(s)`);

  await of.settle(3);
  const g = of.game();
  return {
    advanced: { ticks: of.world().tick - t0, parts: parts().length },
    module: M,
    snap: {
      deckCaught: caughtDeck, deckGapM: +deckGapM.toExponential(3),
      wallCaught: caughtWall,
      wallSocketM: wallSocketM === null ? null : +wallSocketM.toExponential(3),
      wallNearestM: wallNearestM === null ? null : +wallNearestM.toExponential(3),
      runCaught: caughtRun,
      wallRunM: wallRunM === null ? null : +wallRunM.toExponential(3),
    },
    machine: { onDeck, gapM: machineGapM === null ? null
      : +machineGapM.toExponential(3), machines: g.machines.length },
    realClick: { placed: realPlaced },
    base: { parts: parts().length, sites: g.structures.sites,
      refusals: g.structures.refusals, unevenRefusals: g.structures.unevenRefusals,
      viewRefused: g.baseView.refused },
    valid:
      of.world().tick - t0 > 400
      // 1. aiming at a placed deck offers a NEIGHBOUR and names the socket
      && caughtDeck !== null && caughtDeck.includes('socket_edge')
      // 2. and the two decks meet exactly
      && Math.abs(deckGapM) < 1e-6
      // 3. a wall lands on the socket the ghost said it caught, and that socket
      //    is also the nearest one, so "it caught something" and "it caught the
      //    RIGHT something" are two separate assertions
      && wallSocketM !== null && wallSocketM < 1e-6
      && wallNearestM !== null && wallNearestM < 1e-6
      // 4. a second wall continues the run end to end
      && wallRunM !== null && wallRunM < 1e-6
      // 5. a furnace sits ON the deck top, not in it
      && onDeck === true && machineGapM !== null && Math.abs(machineGapM) < 1e-6
      // 6. and the real left mouse button places
      && realPlaced > 0
      && g.baseView.refused === 0,
    log,
  };
})()
