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
  // the patch, so the run's tail can hug it. Rotation 2 points its outlet back
  // at the player, which is the direction the belts will flow.
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
  of.build(1);
  await rotateTo(2);
  let drill = null;
  for (let p = -40; p <= -8 && drill === null; p += 0.25) {
    const g = await ghostAt(yaw0, p);
    if (g === null || !g.ok || g.patch < 0) continue;
    const before1 = fac().buildings;
    await placeHere();
    if (fac().buildings > before1) {
      const row = fac().list.find((b) => b.kind === 'miner');
      drill = { id: row.id, cell: row.cell, pos: row.pos, pitch: p };
    }
  }
  if (drill === null) return { valid: false, why: 'the drill would not go down on the patch', log };
  log.push(`drill ${drill.cell} at pitch ${drill.pitch}`);

  // --- align the aim with the site's own axis (shortline.js's sweep). A cell
  // row is a SITE-GRID fact and the yaw at the node is not on any axis, so a
  // dead-reckoned pitch walk misses the row; the ghost's reported heading with
  // rotation held is a site axis, and turning until it is anti-parallel to the
  // aim is how the probe finds one, exactly as a player does by watching the
  // preview. Snapped samples are skipped: a caught socket overrides the fwd.
  of.build(2);
  await settle(0.2);
  let yawG = yaw0;
  {
    let bestYaw = yaw0;
    let bestDot = -2;
    for (const [span, step] of [[23, 2], [5, 0.4]]) {
      let by = bestYaw;
      let bd = -2;
      for (let k = -span; k <= span; ++k) {
        const g = await ghostAt(bestYaw + k * step, -18);
        if (g === null || g.snapped !== '') continue;
        const a = of.aim();
        const d = -(a.dir[0] * g.fwd[0] + a.dir[1] * g.fwd[1] + a.dir[2] * g.fwd[2]);
        if (d > bd) { bd = d; by = bestYaw + k * step; }
      }
      bestYaw = by; bestDot = bd;
    }
    log.push(`grid axis: yaw ${yaw0.toFixed(1)} -> ${bestYaw.toFixed(1)}, dot ${bestDot.toFixed(3)}`);
    yawG = bestYaw;
  }

  // --- a corridor scan around that axis: every cell the ghost lands on, BY
  // POSITION. The waypoints of the drag are chosen off this map, which is the
  // probe watching the preview rather than assuming the grid.
  const scan = [];
  for (let dy = -10; dy <= 10; dy += 2) {
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
  log.push(`corridor scan: ${scan.length} distinct placeable cells`);
  // The tail hugs the drill; prefer an unsnapped aim (a snapped preview cell
  // and the cell a DRAG-press lays can differ, because a drag never snaps).
  const tailC = scan.filter((s) => {
    const d = gdist(s.pos, drill.pos);
    return d > 0.7 && d < 1.35;
  }).sort((a, b) => Number(a.snapped) - Number(b.snapped))[0];
  if (tailC === undefined) {
    return { valid: false, why: 'no placeable cell beside the drill', drill, log };
  }
  // The leg runs along the site axis the ghost reports, and the SIGN is read
  // off the scan itself: whichever direction actually has a row of placeable
  // cells. Nothing about the player's position decides it. (Measured, twice:
  // rotation semantics gave the axis exactly backwards, and "toward the
  // player" was wrong too, because the drill lands on the patch's NEAR lobe
  // at ~2.2 m and the only room for a leg is on the far side of it.)
  const axis = norm(tailC.fwd);
  const rowCount = (sgn) => scan.filter((s) => {
    const v = sub(s.pos, tailC.pos);
    const a = dot(v, axis);
    return a * sgn >= 1.2 && len(sub(v, mul(axis, a))) < 0.35;
  }).length;
  const legDir = mul(axis, rowCount(1) >= rowCount(-1) ? 1 : -1);
  const alongOf = (s) => dot(sub(s.pos, tailC.pos), legDir);
  const acrossOf = (s) => len(sub(sub(s.pos, tailC.pos), mul(legDir, alongOf(s))));
  if (scan.filter((s) => alongOf(s) >= 2.6 && acrossOf(s) < 0.35).length === 0) {
    return { valid: false, why: 'no straight leg of three cells on the axis',
      tail: tailC, legDir, cells: scan.map((s) => [
        +alongOf(s).toFixed(2), +acrossOf(s).toFixed(2)]), log };
  }
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
      pos: cur.g === null ? ideal : cur.g.pos, missM: +cur.d.toFixed(3) };
  };
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
  for (let k = 1; k <= 3; ++k) {
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
  // capped at 420 (~60 s of sim) so a dead line still reports rather than
  // hangs. Items in motion cover the corner early; once the head blocks and
  // the line backs up past the corner, parked items hold the four offsets.
  const curveIds = new Set(v0.curveTiles.map((c) => c.id));
  const raw = [];
  let pulls0 = 0;
  let cornerRows = 0;
  let frames = 0;
  for (; frames < 420 && (cornerRows < 24 || frames < 120); ++frames) {
    await settle(0.15);
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
    corners: v0.curveTiles,
    run: f0.runs[0],
    lineAtEnd: { items: fEnd.runs[0].items, mined: fEnd.minedFromNodes,
      cargoPulls: pulls0 },
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw.calls },
    log,
  };
})()
