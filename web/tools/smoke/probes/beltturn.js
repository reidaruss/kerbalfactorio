// FS-40: EVERY BELT TILE IS DRAWN WITH THE MESH THAT ACTUALLY JOINS ITS
// NEIGHBOURS, however it came to point where it points.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/beltturn.js
//
// Reid, verbatim: "I turned this belt and it functionally is turned - stuff
// flows to the other belt but visually it didnt turn to line up." His screenshot
// is two STRAIGHT belt bodies meeting at an angle with a step in the slats,
// which is the straight mesh drawn on a tile that has become a corner.
//
// WHY THIS IS NOT `beltcurve.js`. That probe lays an L by DRAGGING and asserts
// `view.curveTiles`, which is `FactoryView.cornersOf`'s own answer read straight
// back out. It therefore cannot see either defect class that matters here: a
// corner the view worked out and the batch never drew, and a corner reached by
// the R key rather than by a drag. This probe presses a REAL R, with an empty
// hand, through `Input.act` at a crosshair aimed at a real tile, which is the
// only path a player has; and it measures the geometry three is about to draw.
//
// WHAT IT LAYS, and why each shape is here.
//
//   D  a DRAG L. The control. It has always looked right and must stay so.
//   T  a straight run whose near tile is turned by R with NOTHING beyond it, so
//      the turned tile ENDS its run.
//   J  a straight run turned by R INTO A SECOND RUN, so the turned tile has a
//      SUCCESSOR and the ore flows on through it: Reid's shape, word for word.
//   S  the STORM. Every reachable tile is then turned, one quarter at a time,
//      and the whole invariant is re-measured after EVERY SINGLE PRESS. Three
//      hand-built shapes are three points in a space a player wanders freely;
//      the storm walks a base through dozens of topologies, including runs
//      splitting, runs merging, corners becoming straights again and two
//      corners landing back to back, and it stops at the FIRST press whose
//      result cannot be drawn correctly. That is the assertion that makes a
//      wrong tile mesh impossible to ship quietly, and it is deliberately not
//      a hand-picked scenario, because a hand-picked scenario is exactly what
//      already existed and already passed.
//
// WHAT IS MEASURED, AND WHY NONE OF IT IS THE DRAW CODE'S OWN OPINION.
//
//   the DRAWN MESH   `view.tiles[].mesh` is read out of the BatchedMesh's own
//                    per-instance geometry index (MachineBatch.drawnKeyAt), and
//                    `view.tiles[].m` out of its matrix texture. Those two are
//                    the last state before the GPU. A mirror of `cornersOf`
//                    would agree with the bug.
//
//   the SEAM         every belt tile publishes `socket_belt_in` at local
//                    (0, 0.25, -0.5) and `socket_belt_out` at +Z on the
//                    straight, -X on the left curve and +X on the right
//                    (ASSET-SPECS 4.12, verified against the three shipped
//                    .glb files). So where one tile's body ENDS and the next
//                    tile's body BEGINS are two points this probe rebuilds from
//                    the asset's own numbers and the matrices three will draw
//                    with, and the seam is the distance between them. Nothing
//                    in that chain asks the client which tiles it thinks are
//                    corners.
//
//   the EXPECTED     derived from TILE FRAMES ONLY. Every tile's inlet is on
//   MESH             local -Z, so a tile's frame is fixed by the flow ENTERING
//                    it: local +Z is the predecessor's heading `f`, local +Y is
//                    the tile's own `up`, and therefore local +X is `u x f`.
//                    The three meshes send the flow out along +Z, -(u x f) and
//                    +(u x f) respectively, so the right mesh is the one whose
//                    outlet points along the tile's OWN commanded heading. That
//                    is a fact about the assets and about the report's `fwd`
//                    and `up` rows, and it is the whole rule.
(async () => {
  const of = window.__of;
  const log = [];
  const settle = (secs) => of.run(secs, 60);
  const fac = () => of.game().factory;
  const view = () => of.game().view;

  await settle(1.0);
  await of.wipe();
  const t0 = of.world();
  if (of.game() === null) return { valid: false, why: 'no gameplay layer' };

  // ---- vector helpers. Plain arrays: three is not on the page. ---------------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a); return l < 1e-12 ? [0, 0, 0] : mul(a, 1 / l); };
  const vec3 = (v) => (Array.isArray(v) ? v.slice(0, 3) : [v.x, v.y, v.z]);
  /** A column-major Matrix4 applied to a local POINT. */
  const xf = (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

  /**
   * THE WHOLE ACCEPTANCE, as one pure read of the live client.
   *
   * Called after every gesture and after every press of the storm, so a failure
   * names the press that caused it instead of the state it left behind.
   */
  const measure = () => {
    const f = fac();
    const v = view();
    const S = v.beltSockets ?? {};
    const rows = new Map(f.list.map((b) => [b.id, b]));
    const draw = new Map((v.tiles ?? []).map((t) => [t.id, t]));
    const seams = [];
    for (let r = 0; r < f.runs.length; ++r) {
      const ids = f.runs[r].tileIds;
      for (let i = 1; i < ids.length; ++i) {
        const P = rows.get(ids[i - 1]), T = rows.get(ids[i]);
        const dP = draw.get(ids[i - 1]), dT = draw.get(ids[i]);
        if (P === undefined || T === undefined || dP?.m == null || dT?.m == null) continue;
        const sp = S[dP.mesh], st = S[dT.mesh];
        if (sp === undefined || st === undefined) continue;
        // --- what is DRAWN: asset socket through the matrix three will use. ---
        const seam = len(sub(xf(dP.m, sp.out), xf(dT.m, st.in)));
        // --- what SHOULD be: tile frames and the asset, and nothing else. -----
        const uP = norm(P.up);
        const fIn = norm(sub(P.fwd, mul(uP, dot(P.fwd, uP))));
        const u = norm(T.up);
        const x = norm(cross(u, fIn));
        const dirs = { belt: fIn, belt_l: mul(x, -1), belt_r: x };
        const tf = norm(T.fwd);
        let want = 'belt', bestDot = -2;
        for (const k of ['belt', 'belt_l', 'belt_r']) {
          const d = dot(dirs[k], tf);
          if (d > bestDot) { bestDot = d; want = k; }
        }
        // A REVERSAL has no mesh: the flow leaves the way it came in, and none
        // of the three shapes describes that. Excluded rather than mis-asserted.
        const reversal = bestDot < 0.5;
        seams.push({ run: r, prev: ids[i - 1], tile: ids[i],
          last: i === ids.length - 1,
          drawn: dT.mesh, want: reversal ? null : want,
          ok: reversal || (dT.mesh === want && seam < 0.005),
          seamM: +seam.toFixed(6),
          turn: dot(fIn, tf) > 0.9 ? 'straight' : (reversal ? 'reversal' : 'corner'),
          outDot: +bestDot.toFixed(4),
          prevPos: P.pos.map((n) => +n.toFixed(3)),
          tilePos: T.pos.map((n) => +n.toFixed(3)),
          prevFwd: P.fwd.map((n) => +n.toFixed(3)),
          tileFwd: T.fwd.map((n) => +n.toFixed(3)) });
      }
    }
    const corners = seams.filter((s) => s.turn === 'corner');
    const straights = seams.filter((s) => s.turn === 'straight');
    const worst = (list) => list.reduce((a, s) => Math.max(a, s.seamM), 0);
    const meshes = {};
    for (const t of (v.tiles ?? [])) meshes[t.mesh] = (meshes[t.mesh] ?? 0) + 1;
    return { seams, corners, straights, meshes,
      // EVERY TILE'S DRAWN MATRIX, by id, so a straight tile's transform can be
      // compared BIT FOR BIT across a code change. `cornersOf` writes the
      // corner tiles' transforms and nothing else, and this is how that claim
      // is checked rather than asserted: the straight rows must be identical
      // between a run of the old code and a run of the new one on this same
      // driven scene.
      matrices: (v.tiles ?? []).map((t) => ({ id: t.id, mesh: t.mesh, m: t.m }))
        .sort((x, y) => x.id - y.id),
      bad: seams.filter((s) => !s.ok),
      joined: corners.filter((s) => !s.last),
      hands: [...new Set(corners.map((s) => s.want))].sort().join(','),
      worstSeamM: +worst(seams).toFixed(6),
      worstCornerM: +worst(corners).toFixed(6),
      worstStraightM: +worst(straights).toFixed(9),
      runs: f.runs.map((r) => r.tileIds.join('-')).join(' | ') };
  };

  const yaw0 = of.world().observer.yawDeg;
  const eyeP = vec3(of.world().player.aim.origin);
  of.build(2);                              // the belt, i.e. the 2 key
  await settle(0.2);

  const addr = (c) => {
    const k = c.indexOf(':');
    const ij = c.slice(k + 1).split(',').map(Number);
    return { site: c.slice(0, k), i: ij[0], j: ij[1] };
  };

  // One tile first, to adopt a site: until one exists every ghost founds a fresh
  // PROSPECTIVE one under its own aim point and every cell reads the same
  // (FS-19). Nothing below can be aimed until that is fixed, and one press
  // fixes it.
  of.look(yaw0, -55);
  await settle(0.2);
  of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 6, keys: [] }]);
  await settle(0.4);
  if (fac().buildings === 0) return { valid: false, why: 'the seed tile would not go down' };
  const seed = addr(fac().list[0].cell);

  /**
   * ONE two-dimensional scan of where the crosshair can put a tile, with the
   * DISTANCE from the eye to each cell, and everything below aims out of it.
   *
   * A yaw sweep at fixed pitch traces an ARC across the grid, so dead reckoning
   * an aim two cells across lands somewhere else entirely; beltcurve.js learned
   * that the expensive way. Scanning once and looking cells up by address is
   * that lesson with the search hoisted out of the legs. The distance matters
   * because R only reaches 3.5 m (BuildMode.TURN_REACH_M, the same as interact
   * and demolish), so which tile a player can turn is a measured fact here and
   * not an assumption about where the run happened to land.
   */
  const cells = new Map();
  for (let y = -70; y <= 70; y += 2) {
    for (let p = -70; p <= -12; p += 2) {
      of.look((yaw0 + y + 720) % 360, p);
      await settle(0.03);
      const g = of.build().ghost;
      if (g === null) continue;
      const a = addr(g.cell);
      if (a.site !== seed.site) continue;
      const k = `${a.i},${a.j}`;
      const s = { i: a.i, j: a.j, cell: g.cell, ok: g.ok, yaw: yaw0 + y, pitch: p,
        distM: len(sub(vec3(g.pos), eyeP)) };
      if (!cells.has(k) || (s.ok && !cells.get(k).ok)) cells.set(k, s);
    }
  }
  const at = (i, j) => cells.get(`${i},${j}`) ?? null;
  const spanJ = [...cells.values()].reduce((a, c) => [Math.min(a[0], c.j),
    Math.max(a[1], c.j)], [99, -99]);
  log.push(`scan: ${cells.size} cells, j in [${spanJ[0]},${spanJ[1]}], `
    + `seed ${seed.i},${seed.j}`);

  /** Drag a run through the given scanned cells, one held gesture. */
  const drag = async (...via) => {
    const before = fac().buildings;
    of.look((via[0].yaw + 720) % 360, via[0].pitch);
    await settle(0.2);
    of.input.tape([{ hold: 600, actions: ['use'] }]);
    await settle(0.25);
    for (let k = 1; k < via.length; ++k) {
      of.look((via[k].yaw + 720) % 360, via[k].pitch);
      await settle(0.6);
    }
    of.input.tape([{ hold: 6, keys: [] }]);
    await settle(0.4);
    return fac().buildings - before;
  };

  /**
   * Aim at a cell with an EMPTY HAND and press R once. Returns what the game
   * says it turned, which is not always the cell aimed at: the pick is a ray
   * against real bodies and the nearest one wins, exactly as it is for a
   * player. `id` of -1 means nothing was in reach and nothing turned.
   */
  const turnAt = async (c) => {
    of.build(0);
    await settle(0.15);
    of.look((c.yaw + 720) % 360, c.pitch);
    await settle(0.15);
    const before = of.build().turns;
    of.input.act(['rotate'], 4);
    await settle(0.25);
    const r = of.build();
    return { turned: r.turns - before, id: r.lastTurn === null ? -1 : r.lastTurn.id };
  };

  // The reachable lattice at the spawn is long in j and short in i (measured:
  // i in [-5,2], j in [-6,9] on this seed), so every run below is laid along j
  // and every cross step is one cell of i.
  const COL_T = 2, COL_J = 0, COL_D = -3;

  /**
   * A column of `ok` cells at constant i, with the run laid so that it flows
   * TOWARDS the player: the tail at the far end and the head on the cell they
   * are standing beside. That way the tile inside R's 3.5 m has a PREDECESSOR,
   * which is what a corner needs. Laying it the other way put the only
   * reachable tile at the tail, where no mesh describes a turn, which is how
   * the first version of this probe reported "no tile within R reach" for a run
   * it had just built.
   */
  const column = (i) => {
    const col = [];
    for (let j = spanJ[0]; j <= spanJ[1]; ++j) {
      const c = at(i, j);
      if (c !== null && c.ok) col.push(c);
    }
    let near = 0;
    for (let k = 1; k < col.length; ++k) if (col[k].distM < col[near].distM) near = k;
    const away = (col[near + 1]?.distM ?? -1) > (col[near - 1]?.distM ?? -1) ? 1 : -1;
    const tailIdx = Math.max(0, Math.min(col.length - 1, near + away * 4));
    return { col, near, head: col[near], tail: col[tailIdx], away, tailIdx };
  };

  // --- LEG T: a straight run, and its NEAREST tile turned by R. --------------
  const legT = await (async () => {
    const { col, head, tail } = column(COL_T);
    if (col.length < 3 || head === tail) {
      return { fail: 'no column for leg T', have: col.length };
    }
    const laid = await drag(tail, head);
    if (head.distM > 3.2) {
      return { fail: 'leg T head out of R reach', laid,
        headM: +head.distM.toFixed(3) };
    }
    const t = await turnAt(head);
    of.build(2); await settle(0.15);
    const m = measure();
    log.push(`leg T: ${tail.cell} -> ${head.cell}, ${laid} tiles; R at `
      + `${head.cell} (${head.distM.toFixed(2)} m) turned id ${t.id}; `
      + `bad ${m.bad.length}, worst seam ${m.worstSeamM}`);
    return { from: tail.cell, to: head.cell, laid, aimed: head.cell,
      aimedDistM: +head.distM.toFixed(3), ...t,
      bad: m.bad, worstSeamM: m.worstSeamM };
  })();

  // --- LEG J: REID'S SHAPE. Two runs at right angles, joined by one R press. --
  // Run 1 flows along j; run 2 leaves the joint sideways along -i. They are
  // SEPARATE until the joint tile is turned, and after it the ore flows on
  // through a tile that now has a SUCCESSOR. Leg T has no successor, and that
  // one difference is what this leg exists to isolate.
  const legJ = await (async () => {
    const { col, head, tail } = column(COL_J);
    if (col.length < 3 || head === tail) {
      return { fail: 'no column for leg J', have: col.length };
    }
    const laid1 = await drag(tail, head);
    if (head.distM > 3.2) {
      return { fail: 'leg J joint out of R reach', laid1,
        headM: +head.distM.toFixed(3) };
    }
    const c2 = at(COL_J - 1, head.j), d2 = at(COL_J - 3, head.j);
    if (c2 === null || d2 === null || !c2.ok || !d2.ok) {
      return { fail: 'no cross row for run 2', laid1, joint: head.cell };
    }
    const laid2 = await drag(c2, d2);
    const runsBefore = fac().runs.length;
    // Up to four presses: which quarter turn faces run 2 depends on the site's
    // own handedness, and a player simply keeps pressing until it points the
    // way they want. Stop the moment the turned tile has gained a successor.
    let turned = 0, id = -1, joinedAt = -1;
    for (let k = 0; k < 4; ++k) {
      const r = await turnAt(head);
      turned += r.turned;
      if (r.id >= 0) id = r.id;
      const run = fac().runs.find((rr) => rr.tileIds.includes(id));
      if (run !== undefined && run.tileIds.indexOf(id) < run.tiles - 1) {
        joinedAt = k + 1; break;
      }
    }
    of.build(2); await settle(0.15);
    const m = measure();
    log.push(`leg J: run1 ${tail.cell} -> ${head.cell} (${laid1}), run2 `
      + `${c2.cell} -> ${d2.cell} (${laid2}); R x${turned} turned id ${id}; `
      + `runs ${runsBefore} -> ${fac().runs.length}; joined on press ${joinedAt}; `
      + `bad ${m.bad.length}, worst seam ${m.worstSeamM}`);
    return { run1: [tail.cell, head.cell], laid1, run2: [c2.cell, d2.cell], laid2,
      joint: head.cell, turned, id, runsBefore, runsAfter: fac().runs.length,
      joinedAt, bad: m.bad, worstSeamM: m.worstSeamM };
  })();

  // --- LEG D: the DRAG control. One gesture, out along j then across in i. ----
  const legD = await (async () => {
    const { col } = column(COL_D);
    if (col.length < 4) return { fail: 'no column for leg D', have: col.length };
    const a = col[0], b = col[Math.min(col.length - 1, 4)];
    const c = at(COL_D - 2, b.j);
    if (c === null || !c.ok) return { fail: 'no cross cell for leg D', b: b.cell };
    const laid = await drag(a, b, c);
    const m = measure();
    log.push(`leg D (drag): ${a.cell} -> ${b.cell} -> ${c.cell}, ${laid} tiles; `
      + `bad ${m.bad.length}, worst seam ${m.worstSeamM}`);
    return { path: [a.cell, b.cell, c.cell], laid,
      bad: m.bad, worstSeamM: m.worstSeamM };
  })();

  // --- LEG S: THE STORM. -----------------------------------------------------
  // Every reachable cell that has a tile on it, turned one quarter at a time,
  // with the whole invariant re-measured after every press. It runs until it
  // finds a press it cannot draw, or until it runs out of presses.
  const storm = await (async () => {
    const reach = [...cells.values()]
      .filter((c) => c.distM < 3.2)
      .sort((a, b) => a.distM - b.distM);
    const presses = [];
    let firstBad = null;
    for (let round = 0; round < 3 && firstBad === null; ++round) {
      for (const c of reach) {
        const r = await turnAt(c);
        if (r.turned === 0) continue;
        const m = measure();
        presses.push({ aimed: c.cell, id: r.id, corners: m.corners.length,
          straights: m.straights.length, bad: m.bad.length,
          worstSeamM: m.worstSeamM, runs: m.runs });
        if (m.bad.length > 0) {
          firstBad = { press: presses.length, aimed: c.cell, id: r.id,
            bad: m.bad, runs: m.runs, meshes: m.meshes,
            curveTiles: view().curveTiles };
          break;
        }
      }
    }
    of.build(2); await settle(0.15);
    log.push(`storm: ${presses.length} presses over ${reach.length} reachable `
      + `cells, first bad ${firstBad === null ? 'none' : firstBad.press}`);
    return { presses: presses.length, reachable: reach.length, firstBad,
      trail: presses };
  })();

  of.build(0);
  await settle(0.8);

  const f = fac();
  const v = view();
  const m = measure();

  of.look(yaw0, -34);
  await settle(0.6);

  return {
    valid: [legT, legJ, legD].every((l) => l.fail === undefined)
      && f.buildings >= 12 && (of.world().tick - t0.tick) > 200
      && legT.turned > 0 && legJ.turned > 0 && storm.presses >= 10
      && m.corners.length >= 2 && m.straights.length >= 6,

    // --- THE ACCEPTANCE ------------------------------------------------------
    // 1. Every tile is drawn with the mesh that actually joins its neighbours,
    //    and the bodies MEET: 5 mm on a 1 m tile, where the assets are authored
    //    to 1 mm and the site grid is exact. A straight mesh drawn on a square
    //    corner reads 0.7071 m here.
    meshMatchesGeometry: m.bad.length === 0,
    // 2. And that held after EVERY press of the storm, not only at the end.
    heldThroughEveryPress: storm.firstBad === null,
    // 3. A turned tile with a SUCCESSOR is drawn as a curve too. Reid's shape.
    joinedCornerCurved: m.joined.length > 0 && m.joined.every((s) => s.ok),
    // 4. Both hands, so a sign error cannot pass as a missing detection.
    bothHands: m.hands === 'belt_l,belt_r',
    // 5. The straights are untouched, which is the regression this must not
    //    cause: they met exactly before and must meet exactly after.
    straightsUnmoved: m.worstStraightM < 1e-5
      && m.straights.every((s) => s.drawn === 'belt'),

    worstSeamM: m.worstSeamM,
    worstCornerSeamM: m.worstCornerM,
    worstStraightSeamM: m.worstStraightM,
    corners: m.corners, joined: m.joined, bad: m.bad,
    straightCount: m.straights.length, meshes: m.meshes, hands: m.hands,
    legT, legJ, legD, storm, matrices: m.matrices,
    curveTiles: v.curveTiles, curveCount: v.curves,
    runs: f.runs, buildings: f.buildings,
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw.calls },
    log,
  };
})()
