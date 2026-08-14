// FS-33: CARGO ON A CORNER RIDES THE ARC. Measured against the belt's own
// centre-line geometry, with items actually flowing, which no probe ever did.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/beltcargo.js \
//        --out=docs/screenshots/FS33_belt_cargo_corner.png
//
// Reid, verbatim: "when a belt turns the resource appears to fall off the end
// instead of turning." His screenshot shows coal bunched at and past a corner's
// outer edge, riding straight off the bend, while the line itself works.
//
// THE GAP THIS CLOSES WAS NAMED WHEN FS-31 SHIPPED: "beltcurve carries no cargo
// at probe time." The arc solver was property-checked headlessly and the curve
// tiles were asserted to DRAW, but no probe ever put an item on a turning belt
// and measured where it was RENDERED. The defect lived precisely where the
// check never looked (standing rule 11), so this probe is the deliverable as
// much as any fix: it drives ore through an L-bend and asserts every drawn
// item against the centre-line, at multiple offsets through the corner tile.
//
// THE GROUND TRUTH IS THE RUN'S OWN GEOMETRY, NOT BeltCargo's PATH DATA.
// Asserting cargo against the Path objects BeltCargo solved would be circular:
// the suspected defect is exactly that a corner tile evaluates the wrong path.
// Instead the expected centre-line is rebuilt here from the report's tile
// frames (pos, fwd, up) and the art lane's published convention (ASSET-SPECS
// 4.12/4.13.1): a straight tile's item path is the line x=0 from z=-0.5 to
// z=+0.5 at deck height h; a corner tile's is the quarter circle of radius
// 0.5 m through the two face midpoints, whose centre sits at the corner the
// inlet and outlet faces share. Both in the frame orient() builds: +Y on up,
// +Z on the HORIZONTAL projection of the heading (for a corner, the heading
// ENTERING it, exactly as FactoryView orients the curve mesh). h is calibrated
// from the straight tiles' own items rather than hardcoded, so the corner
// assertion cannot pass by reciting the asset back at itself.
//
// WHAT FAILS AGAINST THE DEFECT REID SAW: an item on the corner tile drawn on
// a straight path continues up to ~0.6 m past the arc (measured below as
// cornerMaxDevM), and the quadrant-containment count goes nonzero. What stays
// green regardless: straightMaxLatM, the straight tiles' lateral deviation,
// which is this probe's own regression guard for the fix.
//
// FS-44 REBUILT THE SETUP AND NOT ONE LINE OF THE MEASUREMENT, and the split is
// worth naming here because everything below the setup gate is still exactly
// what FS-33 shipped. The port model stopped connecting buildings by the
// distance between their centres and started connecting an OUTLET socket to an
// INLET socket, so this probe's old habit of picking any placeable cell beside
// the drill and then choosing the run's direction separately no longer produces
// a fed line: it produces a belt running crosswise past the drill's nose, which
// the model refuses on purpose. The tail and the leg direction are now one
// choice taken off the drill's own outlet (see the block that makes it), the
// drill's rotation is measured against the ground rather than assumed, and the
// sample interval is dithered because a fixed one phase-locked to the sim and
// read the same four offsets on every crossing. The arc assertions, the
// tolerances, the containment count and the setup gate are untouched, and the
// numbers they produce are the ones FS-33 published: 0.0000 m at the corner and
// 0.00000 m on the straights.
(async () => {
  const of = window.__of;
  const log = [];
  const settle = (secs) => of.run(secs, 60);
  const fac = () => of.game().factory;
  const bld = () => of.build();

  // --- small vector kit over plain arrays ----------------------------------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a); return l > 0 ? mul(a, 1 / l) : a; };
  const perp = (v, u) => sub(v, mul(u, dot(v, u)));   // u must be unit
  const gdist = (a, b) => len(sub(a, b));

  await settle(1.0);
  await of.wipe();
  if (of.game() === null) return { valid: false, why: 'no gameplay layer' };

  // --- walk to the ore (shortline.js's search, guard and all) --------------
  const eye = () => { const o = of.aim().origin; return [o[0], o[1], o[2]]; };
  const nodePos = (n) => [n.x, n.y, n.z];
  const ore = () => of.nodes().find((n) => n.kind === 3 && n.remaining > 20)
            ?? of.nodes().find((n) => n.kind === 2 && n.remaining > 20);
  let node = ore();
  if (node === undefined) return { valid: false, why: 'no ore node in the clearing' };
  const miss = () => {
    const a = of.aim();
    const v = sub(nodePos(node), a.origin);
    const t = dot(v, a.dir);
    if (t <= 0) return Infinity;
    return len(sub(v, mul(a.dir, t)));
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
  let closest = gdist(eye(), nodePos(node));
  let worse = 0;
  for (let i = 0; i < 45; ++i) {
    node = of.nodes().find((n) => n.index === node.index) ?? node;
    const d = gdist(eye(), nodePos(node));
    if (d < 5.0) break;
    if (d < closest - 0.05) { closest = d; worse = 0; }
    else if (++worse >= 2) { aimAt(); worse = 0; }
    of.input.tape([{ hold: 60, keys: ['KeyW'] }]);
    await settle(1.1);
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await settle(0.2);
  aimAt();
  const standoff = gdist(eye(), nodePos(node));
  if (standoff > 10.6) return { valid: false, why: 'the walk never reached the deposit', standoff, log };
  const yaw0 = of.world().observer.yawDeg;
  log.push(`stood off ${standoff.toFixed(2)} m at yaw ${yaw0.toFixed(1)}`);

  // --- the drill first: it is the SEED (adopts the site, FS-19) and the
  // SOURCE, and because it is placed along the aim at the node it stands on
  // the patch, so the run's tail can hug it.
  //
  // ITS ROTATION IS NOW A MEASUREMENT AND NOT A CONSTANT, and the reason is
  // FS-44's PORT MODEL. This block used to say `rotateTo(2)` with the note
  // "rotation 2 points its outlet back at the player, which is the direction
  // the belts will flow", and under the old wiring that note could be wrong
  // without costing anything: `FactoryWiring.wire` connected two buildings
  // whose CENTRES were within a reach derived from their footprints, so an
  // outlet pointing any which way still fed a belt tile 1.00 m off and no
  // orientation was ever consulted. A connection is now an OUTLET socket
  // meeting an INLET socket (`FactoryPorts`: within PORT_MATE_M = 0.65 m in the
  // tangent plane, facing each other within PORT_FACE_DOT = -0.85), so which
  // face the drill's `socket_item_out` sits on decides whether the drill feeds
  // anything at all.
  //
  // Rotation 0 aims that outlet AWAY from the player and rotation 2 aims it
  // back at him, and the run has to leave along it, so the rotation has to be
  // whichever one points at the ground there is actually room to lay a run on.
  // That is measured below rather than asserted: the drill lands on the first
  // patch cell the pitch sweep finds walking from steep to shallow, which is
  // the patch's NEAR lobe, and how much placeable ground lies beyond it as
  // against between it and the player is a property of where the walk stopped.
  const placeHere = async () => {
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
    await settle(0.18);
  };
  const ghostAt = async (y, p) => {
    of.look((y + 720) % 360, p);
    await settle(0.04);
    return bld().ghost;
  };
  const rotateTo = async (q) => {
    while (bld().rotation !== q) {
      of.input.tape([{ hold: 3, keys: ['KeyR'] }, { hold: 3, keys: [] }]);
      await settle(0.12);
    }
  };
  /**
   * Steer the crosshair until the GHOST's own proposed cell sits on `ideal`.
   *
   * Hill-climbed on the ghost's reported position rather than on ray geometry,
   * because the ghost resolves aim -> cell against the REAL ground: aiming at
   * an ideal 3D point missed by a whole cell on sloped terrain (a few cm of
   * height error displaces a shallow ray's ground hit by half a metre) and a
   * dead-reckoned chain of them laid a pure diagonal staircase. Measured.
   */
  const aimGhost = async (ideal) => {
    let y = of.world().observer.yawDeg;
    let p = -30;
    const dEval = async (yy, pp) => {
      const g = await ghostAt(yy, Math.max(-84, Math.min(-8, pp)));
      return g === null ? { d: Infinity, g: null } : { d: gdist(g.pos, ideal), g };
    };
    let cur = await dEval(y, p);
    for (const step of [10, 3.5, 1.2, 0.5]) {
      for (let hop = 0; hop < 10; ++hop) {
        let best = null;
        for (const [dy, dp] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
          const e = await dEval(y + dy, p + dp);
          if (best === null || e.d < best.d) best = { ...e, dy, dp };
        }
        if (best === null || best.d >= cur.d) break;
        y += best.dy; p = Math.max(-84, Math.min(-8, p + best.dp)); cur = best;
      }
    }
    return { yaw: (y + 720) % 360, pitch: Math.max(-84, Math.min(-8, p)),
      pos: cur.g === null ? ideal : cur.g.pos, missM: +cur.d.toFixed(3),
      ok: cur.g === null ? false : cur.g.ok === true,
      snapped: cur.g === null ? '' : cur.g.snapped };
  };

  // GP-762 FIX: THE ROOM DRY-SCAN THIS BLOCK USED TO OPEN WITH IS GONE.
  //
  // It counted placeable cells ahead of and behind a PROSPECTIVE drill cell
  // (nothing adopted yet, FS-19) on a coarse 2 degree by 3 degree grid, and
  // picked whichever side scored higher as the rotation to commit to. MEASURED
  // WRONG, at exactly the default site this probe stands on: the dry scan read
  // 16 cells "ahead" against 49 "behind" and committed to the rotation that
  // faces "behind" — and after the REAL drill went down there, the corridor
  // scan below found `legRoom: 0` on that axis and only 2 cells free on the
  // other (`roomBehindTheOutlet`). `assembler.js`'s own iron chain places a
  // drill on this identical site and lays a real, exhaustive belt run the
  // OPPOSITE way, which is direct proof the ground the coarse scan called
  // "more room" was the wrong lobe: a prospective-cell sweep at a wide angular
  // step cannot tell a patch's near rim from its far one when both stretch
  // away from the same point, and this site is exactly that shape.
  //
  // So this no longer guesses a rotation from a cheap proxy and hopes: it
  // PLACES the drill for real at rotation 0, runs the whole corridor scan and
  // tail search against what actually went down, and only if THAT measures no
  // straight leg does it tear the drill back up and try rotation 2. The same
  // "try in turn, do not compute one more single guess a rescale falsifies
  // again" shape GP-690's `placeUntil` and this lane's own `standCandidatesFor`
  // (assembler.js, GP-760) already use for this exact class of stale
  // assumption, applied here to a RUN, not a stand-point.
  const attemptDrill = async (rot) => {
    of.build(1);
    await rotateTo(rot);
    let drill = null;
    for (let p = -40; p <= -8 && drill === null; p += 0.25) {
      const g = await ghostAt(yaw0, p);
      if (g === null || !g.ok || g.patch < 0) continue;
      const before1 = fac().buildings;
      await placeHere();
      if (fac().buildings > before1) {
        const row = fac().list.find((b) => b.kind === 'miner');
        drill = { id: row.id, cell: row.cell, pos: row.pos, fwd: row.fwd, pitch: p };
      }
    }
    if (drill === null) {
      return { ok: false, rot, drill: null, why: 'the drill would not go down on the patch' };
    }
    log.push(`[rot ${rot}] drill ${drill.cell} at pitch ${drill.pitch}, `
      + `outlet heading [${drill.fwd.map((v) => v.toFixed(3)).join(' ')}]`);

    of.build(2);
    // Back to rotation 2 for the belt ghost whatever the drill ended up at. It
    // no longer decides anything (a dragged tile's heading is re-derived from
    // the run's own positions), but the rotation is a mode-wide setting the
    // drill may just have moved and the press that starts the drag reads it.
    await rotateTo(2);
    await settle(0.2);

    // --- THE AXIS IS THE DRILL'S OUTLET, WHICH IS WHY THERE IS NO SWEEP HERE
    //
    // shortline.js's yaw sweep used to stand here, turning the crosshair until
    // the belt ghost's reported heading came back anti-parallel to the aim,
    // because "a cell row is a SITE-GRID fact and the yaw at the node is not on
    // any axis". That was the right way to FIND an axis when any axis would do.
    // Under FS-44's port model only one axis will do: the one the drill's
    // `socket_item_out` faces, because the run has to leave along it or it is
    // not fed (see the tail block below). The drill has been placed, so that
    // axis is already known, and a sweep that might land on a different one of
    // the four is now a liability rather than a service.
    const upD = norm(drill.pos);
    const tangD = (v) => norm(perp(v, upD));
    // The drill's heading IS its outlet's face. `Factory.orient` puts local +Z
    // on `fwd` and `socket_item_out` is authored at local [0, 0.55, +1.0],
    // which `FactoryPorts.faceOf` reduces to local +Z. Nothing here maps a
    // socket's NAME to a direction in space; the shipped asset's own socket
    // position does, which is the rule that file states about itself.
    const outDir = tangD(drill.fwd);
    // The yaw that looks four cells down the outlet, which is the row the run
    // will occupy. The corridor scan is centred on it rather than on the
    // player's own heading, so the swath follows the leg instead of crossing
    // it.
    const legAim = await aimGhost(add(drill.pos, mul(outDir, 4.008)));
    const yawG = legAim.yaw;
    log.push(`[rot ${rot}] outlet row: yaw ${yaw0.toFixed(1)} -> ${yawG.toFixed(1)}`
      + ` (four cells out, miss ${legAim.missM} m)`);

    // --- THE TAIL AND THE LEG DIRECTION ARE ONE CHOICE, NOT TWO -------------
    //
    // WHAT THIS USED TO BE, WHY IT WAS RIGHT THEN, AND WHY IT IS NOT NOW. The
    // tail used to be "any placeable cell beside the drill": the corridor scan
    // filtered by DISTANCE ALONE (0.7 m to 1.35 m of the drill's centre) and
    // the first hit won. The leg's direction was decided separately and later,
    // off whichever way the scan happened to hold a row of cells. Those two
    // choices could not conflict under the wiring that existed when this probe
    // was written, and that is the whole point: `FactoryWiring.wire` compared
    // the two buildings' CENTRES against a reach derived from their
    // footprints, 1.00 m was inside it, and orientation was never consulted at
    // all. A tail beside the drill with the run heading off crosswise past its
    // nose WAS fed, so taking the first cell in the band was a legitimate
    // choice.
    //
    // FS-44 MADE THAT ARRANGEMENT ILLEGAL, ON PURPOSE. A connection is now an
    // OUTLET socket meeting an INLET socket: within `FactoryPorts.PORT_MATE_M`
    // (0.65 m) in the tangent plane and facing each other within
    // `PORT_FACE_DOT` (-0.85). The drill presents `socket_item_out` on the
    // face its own heading points at, a run's tail presents `socket_belt_in`
    // on the face BEHIND it, and a dragged tile's heading is re-derived from
    // the run's own positions on every commit (`FactoryCommit.pitchRuns`), so
    // the tail faces wherever the leg goes. So the tail is asked for BY
    // POSITION, along the drill's outlet heading, and the leg then runs the
    // way the tail was reached.
    //
    // GP-762/GP-775: "ONE CELL OUT OR TWO" WAS FS-73's OWN CLASS OF STALE
    // ASSUMPTION, one door down from the smelter's in `demolish.js` (GP-770)
    // and the assembler's (GP-760). It was true when a miner was 2 m: a drill
    // and a belt on a common axis then mated 0.498 m or 1.500 m apart
    // (`FactorySnap.stepsFor(belt, miner)` was `ceil((1+2)/2)` = 1, plus the
    // spare cell "when the near cell is not offered"), both comfortably inside
    // `PORT_MATE_M` (0.65 m) of a literal `k` in `[1, 2]` grid steps. FS-73
    // took `miner` to footprint 4, `stepsFor` is now `ceil((1+4)/2)` = 3, and a
    // real 3-cell candidate measured `gapM: 3` here, `ok: true`, outside the
    // `[1, 2]` steps this loop tried and the `0.9`-to-`2.1` m band it tested
    // against. So both the steps tried and the band they are judged against
    // are derived from `FOOTPRINT` (the same table `demolish.js`,
    // `assembler.js` and `FactorySnap.ts` itself already read for this exact
    // reason) instead of carrying the pre-FS-73 numbers forward.
    const FPT = of.game().factory.footprint;
    const CELL_M = 1.002;
    const mateCells = Math.max(1, Math.ceil((FPT.belt + FPT.miner) / 2));
    const tries = [];
    let tailAim = null;
    for (const k of [mateCells, mateCells + 1]) {
      const a = await aimGhost(add(drill.pos, mul(outDir, CELL_M * k)));
      const v = sub(a.pos, drill.pos);
      const t = { k, gapM: +len(v).toFixed(3), align: +dot(tangD(v), outDir).toFixed(3),
        missM: a.missM, ok: a.ok, snapped: a.snapped };
      tries.push(t);
      // Both halves of the mate, restated as a test on the cell the ghost
      // found. The DISTANCE band is the whole legal range with a margin,
      // centred on `mateCells` rather than a literal 1-to-2 steps; the
      // ALIGNMENT is the half this probe never used to check, and it is the
      // half that decides.
      //
      // GP-774: `t.ok` IS PART OF THE TEST TOO, and the gap this lane closed proves
      // why that is not a formality: at rotation 0 on this site the k=1
      // (pre-fix) candidate measured `gapM: 1, align: 1`, a geometrically
      // perfect tail, with `ok: false` underneath it, and the old test
      // accepted it anyway; the drag that followed laid ZERO tiles onto a
      // cell that was never placeable to begin with. Geometry can be perfect
      // and the cell can still be taken, sloped wrong, or off the patch; only
      // `ok` says whether a press would actually land there.
      if (t.ok && t.align > 0.9
        && t.gapM > mateCells * CELL_M - 0.6 && t.gapM < (mateCells + 1) * CELL_M + 0.6) {
        tailAim = a; break;
      }
    }
    log.push(`[rot ${rot}] tail tries: ` + JSON.stringify(tries));
    if (tailAim === null) {
      return { ok: false, rot, drill,
        why: 'no cell along the drill\'s outlet to start a run on', outDir, tries };
    }
    const tailC = { pos: tailAim.pos, yaw: tailAim.yaw, pitch: tailAim.pitch };
    const drillToTail = sub(tailC.pos, drill.pos);
    const tailGapM = len(drillToTail);
    const tailAlign = dot(tangD(drillToTail), outDir);
    // The leg is the direction the tail was actually reached in, measured on
    // the ground rather than recomputed from the heading, so it is exactly one
    // site grid step and the tiles after it chain by construction.
    const legDir = tangD(drillToTail);

    // GP-762/GP-774/GP-775. THE FOOTPRINT FIX ALONE IS NOT THE WHOLE STORY,
    // AND THE REST IS RECORDED RATHER THAN FORCED. `mateCells` above (3, not
    // the pre-FS-73 1-or-2) makes the tail land where a real mate actually
    // forms, which is the mechanism GP-762 named. But the corridor scan below,
    // unchanged since before FS-73, still measures its OWN reach from wherever
    // the player already stands, and a tail one cell further from the drill
    // than it used to be pushes the leg's own far cells past what that reach
    // sees: measured, the scan's own along-axis range topped out at 2.00 cells
    // past the tail, short of the `2.6` a straight leg needs by four tenths of
    // a metre, on BOTH rotations. Walking the player closer first (the fix
    // every other placement in this lane needed for the identical reason,
    // demolish.js's GP-770/771 included) was tried here and hit something this
    // lane could not root-cause: `KeyW` held for a full 9 seconds (500 frames)
    // from this exact stand-point moved the player 0.000 m (feet bit-identical
    // before and after), while `grounded: true`, `blockedByBuild: false`,
    // `blockedByRock: false` and `slopeCos: 1` all read as an ordinary, clear
    // stand. `KeyS`/`KeyA`/`KeyD` each moved the eye a suspiciously IDENTICAL
    // 9.053 m in the same test, which does not read as three different
    // directions of ordinary strafing either. That is a genuine, reproducible
    // player-movement anomaly, distinct from anything FactoryGhost, FactorySnap
    // or FactoryWiring owns, and it is out of this lane's scope to chase into
    // the movement/physics code: recorded here as GP-775 rather than forced
    // past with a workaround this lane cannot verify is honest.
    const scan = [];
    for (let dy = -18; dy <= 18; dy += 2) {
      for (let p = -62; p <= -12; p += 1.2) {
        const g = await ghostAt(yawG + dy, p);
        if (g === null || !g.ok) continue;
        const s = { pos: g.pos, fwd: g.fwd, yaw: yawG + dy, pitch: p,
          snapped: g.snapped !== '' };
        const near = scan.find((q) => gdist(q.pos, s.pos) < 0.4);
        if (near === undefined) scan.push(s);
        else if (near.snapped && !s.snapped) Object.assign(near, s);
      }
    }
    log.push(`[rot ${rot}] corridor scan: ${scan.length} distinct placeable cells`);
    const alongOf = (s) => dot(sub(s.pos, tailC.pos), legDir);
    const acrossOf = (s) => len(sub(sub(s.pos, tailC.pos), mul(legDir, alongOf(s))));
    const legRoom = scan.filter((s) => alongOf(s) >= 2.6 && acrossOf(s) < 0.35).length;
    const maxAlong = scan.reduce((m, s) => Math.max(m, alongOf(s)), -Infinity);
    const minAlong = scan.reduce((m, s) => Math.min(m, alongOf(s)), Infinity);
    log.push(`[rot ${rot}] tail ${tailGapM.toFixed(2)} m along the drill's outlet `
      + `(align ${tailAlign.toFixed(3)}, aim miss ${tailAim.missM} m), leg room ${legRoom}, `
      + `scan along range [${minAlong.toFixed(2)}, ${maxAlong.toFixed(2)}]`);
    if (legRoom === 0) {
      // Reported WITH the room on the other hand, because that is what proves
      // the OTHER rotation is the one worth trying next.
      const behind = scan.filter((s) => alongOf(s) <= -2.6 && acrossOf(s) < 0.35).length;
      return { ok: false, rot, drill,
        why: 'no straight leg of three cells along the outlet',
        tail: tailC, legDir, legRoom, roomBehindTheOutlet: behind,
        cells: scan.map((s) => [+alongOf(s).toFixed(2), +acrossOf(s).toFixed(2)]) };
    }
    return { ok: true, rot, drill, outDir, tangD, scan, tailC, legDir };
  };

  let attempt = await attemptDrill(0);
  if (!attempt.ok) {
    log.push(`rotation 0 failed (${attempt.why}); trying rotation 2 before giving up`);
    if (attempt.drill !== null) {
      const demolished = of.demolish({ id: attempt.drill.id });
      log.push(`demolished the rotation-0 drill: ${JSON.stringify(demolished)}`);
      await settle(0.3);
    }
    const second = await attemptDrill(2);
    if (!second.ok) {
      return { valid: false, why: 'no straight leg of three cells along the outlet, '
        + 'on EITHER drill rotation',
        attempts: [{ rot: 0, why: attempt.why, legRoom: attempt.legRoom ?? null,
          roomBehindTheOutlet: attempt.roomBehindTheOutlet ?? null },
          { rot: 2, why: second.why, legRoom: second.legRoom ?? null,
            roomBehindTheOutlet: second.roomBehindTheOutlet ?? null }],
        second, log };
    }
    attempt = second;
  }
  const { drill, outDir, tangD, scan, tailC, legDir } = attempt;
  log.push(`settled on rotation ${attempt.rot} after `
    + `${attempt.rot === 0 ? 1 : 2} attempt(s)`);
  // ONE AIM PER CELL, precomputed before the drag, each anchored on the CELL
  // THE PREVIOUS AIM ACTUALLY RESOLVED so error cannot accumulate: a big
  // crosshair jump lets dragRun path through the diagonal and lay a staircase
  // of corners (measured: one jump of (-2,+3) cells laid five). The aims are
  // not gated on ghost `ok`: single-placement mode refuses cells beside the
  // drill that a drag lays happily (measured), and the shape gate below is
  // the arbiter of what actually went down.
  const plan = [];
  let cursor = tailC.pos;
  for (let k = 1; k <= 3; ++k) {
    const a = await aimGhost(add(cursor, mul(legDir, 1.002)));
    plan.push(a);
    cursor = a.pos;
  }
  // The axis as WALKED, then square across it on whichever hand the corridor
  // scan actually saw placeable ground.
  const walked = norm(sub(cursor, tailC.pos));
  const up0 = norm(tailC.pos);
  const crossDir = norm([
    up0[1] * walked[2] - up0[2] * walked[1],
    up0[2] * walked[0] - up0[0] * walked[2],
    up0[0] * walked[1] - up0[1] * walked[0]]);
  const sideScore = (sgn) => scan.filter((s) =>
    dot(sub(s.pos, tailC.pos), crossDir) * sgn >= 0.8).length;
  const side = sideScore(1) >= sideScore(-1) ? 1 : -1;
  // TWO CELLS ACROSS, NOT THREE, AND THE CORNER IS THEREFORE TWO FROM THE HEAD.
  //
  // This is a sampling decision and not a measurement one, so the reason is
  // worth writing down. A run with nothing at its head fills up: items ride to
  // the head and park, and the queue grows BACKWARDS. Every item that gets past
  // the corner before the queue reaches it crosses the arc in about half a
  // second and is caught three or four times by the 0.15 s sampling, which is
  // what spreads samples across `cornerFBinsSeen`; every item after that parks,
  // and once the queue covers the corner tile a parked item holds it for the
  // rest of the window, which is what fills `cornerSamples`. The probe needs
  // both, so the corner wants to be a couple of tiles from the head: far enough
  // that a handful of items transit it, near enough that the queue reaches it
  // well inside the window. Measured with the corner four tiles from the head:
  // exactly one item ever crossed it (three samples, three bins) because the
  // drill on this ground yields about one item every six seconds and the queue
  // never got that far in sixty. The third cross cell was also the one aim in
  // the plan that missed, by 0.998 m, so the ground was running out there too.
  for (let k = 1; k <= 2; ++k) {
    const a = await aimGhost(add(cursor, mul(crossDir, 1.002 * side)));
    plan.push(a);
    cursor = a.pos;
  }
  log.push(`plan misses: ${plan.map((a) => a.missM).join(' ')}`);
  // ONE tape for the whole gesture (a released frame is a second press).
  const before = fac().buildings;
  of.look((tailC.yaw + 720) % 360, tailC.pitch);
  await settle(0.15);
  of.input.tape([{ hold: 400, actions: ['use'] }]);
  await settle(0.3);
  for (const a of plan) {
    of.look((a.yaw + 720) % 360, a.pitch);
    await settle(0.3);
  }
  of.input.tape([{ hold: 6, keys: [] }]);
  await settle(0.5);
  of.build(0);
  await settle(0.4);
  log.push(`drag laid ${fac().buildings - before} tiles`
    + ` (tail beside drill at ${gdist(tailC.pos, drill.pos).toFixed(2)} m)`);

  // --- THE SETUP GATE (DW-20's setup half) ---------------------------------
  // The measurement does not need one PRETTY corner: it needs a single
  // drill-fed line with at least one interior corner and some straight tiles,
  // and every drawn item is measured against whatever geometry actually went
  // down. A gesture that lays a Z instead of an L is MORE coverage, not less.
  const f0 = fac();
  const v0 = of.game().view;
  const run0 = f0.runs[0];
  const interior = v0.curveTiles.filter((c) =>
    run0 !== undefined && c.id !== run0.head && c.id !== run0.tail);
  const setup = {
    oneRun: f0.runs.length === 1 && run0 !== undefined && run0.tiles >= 6,
    hasInteriorCorner: interior.length >= 1,
    hasStraights: run0 !== undefined && v0.curves <= run0.tiles - 3,
    drillFeedsTail: f0.links.some((l) => l.from === drill.id && l.to === run0?.tail),
  };
  log.push('setup: ' + JSON.stringify(setup));
  if (!Object.values(setup).every(Boolean)) {
    return { valid: false, why: 'the line did not form as required', setup,
      runs: f0.runs, curves: v0.curveTiles, links: f0.links, cells: f0.list.map((b) => b.cell), log };
  }

  // --- the static tile table, read once: nothing moves after the commit ----
  const tiles = new Map();
  for (const b of f0.list) {
    tiles.set(b.id, { pos: b.pos, fwd: b.fwd, up: b.up, kind: b.kind });
  }
  const runOrder = f0.runs.map((r) => r.tileIds);
  const TURN_COS = 0.9;                       // FactoryView's own threshold
  /** in/out headings of tile #k of a run: the heading it INHERITS and the one
   *  it SENDS ON, which is cornersOf's exact definition of a corner. */
  const frameOf = (runIdx, tileId) => {
    const order = runOrder[runIdx];
    const k = order.indexOf(tileId);
    if (k < 0) return null;
    const t = tiles.get(tileId);
    const inFwd = k === 0 ? t.fwd : tiles.get(order[k - 1]).fwd;
    return { t, inFwd, outFwd: t.fwd, k };
  };

  // --- run ore through it, sampling every drawn item -----------------------
  // Adaptive: the drill's rate is the GROUND's (richness where it stands), so
  // a fixed window starves on a lean spot. Sample until two dozen items have
  // been seen ON CORNER TILES, at least 120 frames for the moving coverage,
  // capped at 450 (~60 s of sim) so a dead line still reports rather than
  // hangs. Items in motion cover the corner early; once the head blocks and
  // the line backs up past the corner, parked items hold the four offsets.
  //
  // AND THE INTERVAL IS DITHERED, WHICH IS NOT FUSSINESS: IT IS AN ALIASING
  // FIX. /core runs at 60 Hz and a belt carries an item across a tile in
  // exactly 32 ticks, so a sampler that always waits the same nine ticks reads
  // the SAME handful of offsets on every single crossing. Measured here, twice,
  // on two different runs of two different lengths: 24 rows on the corner tile
  // at f of 0.719, 0.438, 0.156 and 0.000 and at no other value whatsoever,
  // because the drill's emission period is a whole multiple of the sample
  // period and the two phase-lock. `cornerFBinsSeen` exists precisely to refuse
  // a probe that measured one lucky parking spot, and a phase-locked sampler is
  // that same failure wearing a bigger sample count: it can report hundreds of
  // rows having only ever looked at three points on the arc. Nine, eight and
  // seven ticks in rotation share no factor with the periods the sim has, so
  // the read-out walks through a crossing instead of standing still in it.
  const DITHER = [0.15, 0.1333, 0.1167];
  const curveIds = new Set(v0.curveTiles.map((c) => c.id));
  const raw = [];
  let pulls0 = 0;
  let cornerRows = 0;
  let frames = 0;
  for (; frames < 450 && (cornerRows < 24 || frames < 120); ++frames) {
    await settle(DITHER[frames % DITHER.length]);
    const g = of.game();
    pulls0 += g.view.cargo.pulls;
    for (const r of g.view.cargo.trace) {
      raw.push(r);
      if (curveIds.has(r.tile)) cornerRows++;
    }
  }
  const fEnd = fac();
  log.push(`sampled ${raw.length} drawn items over ${frames} frames `
    + `(${cornerRows} on corner tiles), line now carries ${fEnd.runs[0].items}, `
    + `mined ${fEnd.minedFromNodes}`);
  // WHERE THE ITEMS WERE, which is not a measurement and is here because "the
  // corner was barely sampled" and "the corner was never occupied at all" look
  // identical from a count of three. Rows per tile in run order, tail first.
  const rowsPerTile = runOrder[0].map((id) => ({ id,
    n: raw.filter((r) => r.run === 0 && r.tile === id).length }));
  log.push('rows per tile, tail first: '
    + rowsPerTile.map((t) => `${t.id}:${t.n}`).join(' '));

  // --- measure every sample against the centre-line ------------------------
  // First pass: calibrate deck height h from STRAIGHT items only.
  const hs = [];
  const classified = [];
  for (const r of raw) {
    const fr = frameOf(r.run, r.tile);
    if (fr === null || fr.t.kind !== 'belt') { classified.push({ r, orphan: true }); continue; }
    const up = norm(fr.t.up);
    const iH = norm(perp(fr.inFwd, up));
    const oH = norm(perp(fr.outFwd, up));
    const headDot = dot(norm(fr.inFwd), norm(fr.outFwd));
    // A REVERSAL (headings opposed) is the one shape cornersOf declines to
    // draw as a curve, so its centre-line is undefined here: excluded from
    // both classes and counted, because silently folding it into either
    // would let a mis-set gate pass as geometry.
    if (headDot < -0.5) { classified.push({ r, rev: true }); continue; }
    const corner = headDot <= TURN_COS;
    const rel = sub(r.deck, fr.t.pos);
    if (!corner) hs.push(dot(rel, up));
    classified.push({ r, up, iH, oH, corner, rel });
  }
  hs.sort((a, b) => a - b);
  const h = hs.length > 0 ? hs[Math.floor(hs.length / 2)] : 0;

  const stat = () => ({ n: 0, maxDev: 0, sumDev: 0, maxVert: 0 });
  const straight = stat();
  const corner = stat();
  let contained = 0, containFails = 0, orphans = 0, offRuns = 0, reversals = 0;
  const fBins = new Set();
  const worst = [];
  for (const c of classified) {
    if (c.orphan === true) { orphans++; continue; }
    if (c.rev === true) { reversals++; continue; }
    // The trace's own tile must be the run tile its offset names, which pins
    // the tile-assignment half of the mapping (off-by-a-tile shows here even
    // before it shows as a deviation).
    const order = runOrder[c.r.run];
    const named = order[order.length - 1 - Math.min(order.length - 1,
      Math.max(0, Math.floor(c.r.off)))];
    if (named !== c.r.tile) { offRuns++; continue; }
    if (c.corner) {
      // Quarter circle: centre at the shared corner of the inlet and outlet
      // faces, radius 0.5, in the deck plane at calibrated height h.
      const cRel = add(add(mul(c.up, h), mul(c.iH, -0.5)), mul(c.oH, 0.5));
      const v = sub(c.rel, cRel);
      const vert = dot(v, c.up);
      const vh = sub(v, mul(c.up, vert));
      const dev = Math.abs(len(vh) - 0.5);
      const inQuad = dot(vh, c.iH) >= -0.02 && dot(vh, mul(c.oH, -1)) >= -0.02;
      if (inQuad) contained++; else containFails++;
      corner.n++;
      corner.maxDev = Math.max(corner.maxDev, dev);
      corner.sumDev += dev;
      corner.maxVert = Math.max(corner.maxVert, Math.abs(vert));
      fBins.add(Math.min(4, Math.floor(c.r.f * 5)));
      if (worst.length < 6 || dev > worst[worst.length - 1].dev) {
        worst.push({ dev: +dev.toFixed(4), f: +c.r.f.toFixed(3), off: +c.r.off.toFixed(3),
          tile: c.r.tile, turn: c.r.turn, vert: +vert.toFixed(4), inQuad });
        worst.sort((a, b) => b.dev - a.dev);
        if (worst.length > 6) worst.pop();
      }
    } else {
      const relH = sub(c.rel, mul(c.up, h));
      const along = dot(relH, c.oH);
      const p2 = sub(relH, mul(c.oH, along));
      const vert = dot(p2, c.up);
      const lat = len(sub(p2, mul(c.up, vert)));
      straight.n++;
      straight.maxDev = Math.max(straight.maxDev, lat);
      straight.sumDev += lat;
      straight.maxVert = Math.max(straight.maxVert, Math.abs(vert));
    }
  }

  const measured = {
    // THE NUMBER. How far a drawn corner item sits off the belt's centre-line
    // arc, in metres. The defect Reid photographed reads ~0.5 m here; the arc
    // followed correctly reads authoring noise plus ground pitch, well under
    // the 0.03 m tolerance.
    cornerMaxDevM: +corner.maxDev.toFixed(4),
    cornerMeanDevM: corner.n > 0 ? +(corner.sumDev / corner.n).toFixed(4) : -1,
    cornerMaxVertM: +corner.maxVert.toFixed(4),
    cornerSamples: corner.n,
    // Items must be seen at MULTIPLE offsets through the corner tile (five
    // bins over f in 0..1), or the probe measured one lucky parking spot.
    cornerFBinsSeen: [...fBins].sort().length,
    containFails,
    // The regression guard: straight tiles were right before and must stay
    // bit-identically right after any corner fix.
    straightMaxLatM: +straight.maxDev.toFixed(5),
    straightMaxVertM: +straight.maxVert.toFixed(5),
    straightSamples: straight.n,
    deckHeightM: +h.toFixed(4),
    orphans, offRuns, reversals,
  };
  log.push('measured: ' + JSON.stringify(measured));

  // Frame the corner for the screenshot: stand back and look down the line.
  of.look(yaw0, -30);
  await settle(0.5);

  return {
    valid: Object.values(setup).every(Boolean)
      // DW-20's measuring half: enough samples, spread through the corner.
      && corner.n >= 12 && measured.cornerFBinsSeen >= 4 && straight.n >= 12
      && fEnd.minedFromNodes > 0
      // THE ACCEPTANCE: every drawn item within 3 cm of the centre-line arc,
      // inside the corner's own quadrant, on the tile its offset names.
      && measured.cornerMaxDevM <= 0.03
      && measured.cornerMaxVertM <= 0.05
      && containFails === 0 && orphans === 0 && offRuns === 0
      // and the straights stayed straight.
      && measured.straightMaxLatM <= 0.005,
    measured,
    worst,
    setup,
    // FS-44's rows, carried into the PASSING report and not only the failing
    // one. `drillFeedsTail` is a boolean and a boolean cannot say WHICH ports
    // met or by how much they missed; the gap, the rise and the facing are what
    // make "the drill feeds the tail" a measurement rather than an assertion.
    links: f0.links,
    rowsPerTile,
    corners: v0.curveTiles,
    run: f0.runs[0],
    lineAtEnd: { items: fEnd.runs[0].items, mined: fEnd.minedFromNodes,
      cargoPulls: pulls0 },
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw.calls },
    log,
  };
})()
