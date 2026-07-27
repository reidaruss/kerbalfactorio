// WG-22/WG-23 terraforming: can the player flatten a spot, and does the game
// tell them the truth about what it managed?
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/level.js \
//        --out=docs/screenshots/W8_level_pad.png
//
// THE PREVIOUS VERSION OF THIS PROBE WAS GREEN WHILE THE TOOL DID NOTHING FOR
// THE PLAYER, and every assertion it added since is a correction to a specific
// way it managed that. Read them as a list of what a harness has to prove:
//
//   1. It moved ground: cells cut AND placed, from /core's own counters.
//   2. The height SPREAD across the disc collapsed, measured in metres.
//   3. NEGATIVE CONTROL: outside the radius nothing moved.
//   4. The player can walk onto it and the ground does not fight them.
//   5. It survives a save and a reload with the rock PUT BACK in between.
//   6. (WG-23) THE KEY REACHES THE TOOL THROUGH A REAL DOM KEY EVENT, and at
//      the pitch a player actually looks while walking. The old probe drove a
//      tape, which sets the held-code set directly, and aimed at -72 degrees
//      because a shallower aim "cost a run to learn". That was the bug wearing
//      the probe's own clothes: on the slope this tool exists for, the ray
//      found no ground at 0, -10, -20 or -30 degrees and the key did nothing,
//      silently, at every angle a person uses.
//   7. (WG-23) THE DRAWN SURFACE, not only the oracle. A player does not stand
//      on surface_field.h, they look at the mesh, and every claim this feature
//      ever made was about the oracle. Sampling the vertices the GPU is drawing
//      is what showed that levelling used to make the local step a player reads
//      as flatness WORSE (1.88 m of hillside to 2.73 m of terrace) while the
//      spread halved.
//   8. (WG-23) THE HONESTY. A 1 m voxel lattice cannot make a pad flat to a
//      shin, so the tool quotes the flatness it achieved on every press. The
//      number it says and the number the ground is have to be the same, and
//      that is assertable.
//   9. (WG-28) THE NEGATIVE CONTROL KNOWS ITS OWN SUBJECT. Item 3 above was
//      wrong for a night: it sized its "outside the radius" ring at 2.5x THIS
//      FILE'S copy of the pad radius, 6 m, so 15 m. WG-27 widened the tool to
//      10 m and, because the disc is centred on the AIM POINT up to 9 m
//      downhill rather than on the player, the pad reached 19 m and the control
//      ring was policing ground 1.2 m inside it. It then reported 2.779 m of
//      movement, which reads exactly like a regression in the level op's blast
//      radius and is not one. MEASURED: the two ring points that moved were
//      8.844 m and 9.968 m from the disc the tool reported, and the next point
//      out at 10.386 m moved 0.000000 m against a radius of 10.000 m. The ring
//      is now derived from `terraform().limits`, and the probe ASSERTS that its
//      ring cleared every disc the tool says it cut, so the control can no
//      longer quietly become a measurement of the pad.
//
// DW-20: input drains on the 60 Hz tick, not the render frame, so every wait
// here is real time through of.run and every claim is checked against a tick
// delta first.
(async () => {
  const of = window.__of;
  const R = OF_ARGS.radiusM ?? 6.0;
  const log = [];

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const hold = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };
  // A REAL key event, not a tape. `Input` turns a window keydown into a held
  // code, and nothing else does; a tape writes the held set directly and would
  // stay green through an unbound key (probes/realclick.js, the same trap).
  const realKey = async (code, secs) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    await of.run(secs, 60);
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    await of.run(0.4, 60);
  };
  // The EYE, in body-frame absolutes. Nothing on __of publishes the capsule's
  // base, so this probe measures the eye's altitude above the ONE surface and
  // asserts it stays CONSTANT rather than zero: a constant eye height over a
  // walk is the same claim (walker and oracle are one surface) and it is the
  // one that can be made from here.
  const eye = () => {
    const w = of.world();
    return w.player === null ? null : w.player.aim.origin;
  };
  const unit = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / r, p[1] / r, p[2] / r];
  };
  const basis = (u) => {
    const seed = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const cx = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]];
    let e1 = cx(u, seed);
    const L = Math.hypot(...e1); e1 = e1.map((v) => v / L);
    return [e1, cx(u, e1)];
  };
  const ring = (u, metres, n, radiusM) => {
    const [e1, e2] = basis(u);
    const out = [];
    for (let i = 0; i < n; ++i) {
      const a = (2 * Math.PI * i) / n;
      out.push(unit([0, 1, 2].map((k) =>
        u[k] * radiusM + (e1[k] * Math.cos(a) + e2[k] * Math.sin(a)) * metres)));
    }
    return out;
  };
  // Every height here comes from of.surface, i.e. from surface_field.h, or from
  // of.meshVerts, i.e. from the vertex buffer being drawn. Nothing in this probe
  // re-derives a terrain height (standing rule 1 applies to the verification
  // too, or the harness becomes another surface).
  const heights = (dirs) => dirs.map((d) => of.surface(d[0], d[1], d[2]).surfaceM);
  const spreadOf = (hs) => Math.max(...hs) - Math.min(...hs);
  const round = (a) => a.map((v) => +v.toFixed(3));

  await settle(1.2);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character, nothing can level' };
  if (of.terraform() === null) return { valid: false, why: 'no terraforming tool' };
  await of.wipe();
  of.forgetTunnels();

  const bodyR = w0.bodyRadiusM;
  const t0 = of.world();

  // --- 1. FIND A SLOPE, because flat ground cannot prove a levelling tool ---
  const spawn = of.world().observer;
  const site = { latDeg: spawn.latDeg, lonDeg: spawn.lonDeg, spread: -1, scanned: 0 };
  const scan = (cLat, cLon, stepDeg, span, maxM) => {
    for (let i = -span; i <= span; ++i) {
      for (let j = -span; j <= span; ++j) {
        const lat = cLat + i * stepDeg;
        const lon = cLon + j * stepDeg;
        of.teleport(lat, lon, 2.0);
        const uu = unit(eye());
        site.scanned++;
        const s = spreadOf(heights([uu, ...ring(uu, R * 0.7, 4, bodyR),
          ...ring(uu, R, 4, bodyR)]));
        if (s > site.spread && s <= maxM) {
          site.spread = s; site.latDeg = lat; site.lonDeg = lon;
        }
      }
    }
  };
  const maxSlopeM = OF_ARGS.maxSlopeM ?? 9.0;
  scan(spawn.latDeg, spawn.lonDeg, OF_ARGS.coarseStepDeg ?? 0.02, 10, maxSlopeM);
  scan(site.latDeg, site.lonDeg, OF_ARGS.fineStepDeg ?? 0.0016, 6, maxSlopeM);

  // --- 2. THE AIM. A fresh world per pitch, and the shallow ones are the point:
  // this is the assertion whose absence let "it didnt really work at all" ship.
  const aim = [];
  for (const p of (OF_ARGS.pitches ?? [0, -10, -20, -30, -45, -72])) {
    of.forgetTunnels();
    of.teleport(site.latDeg, site.lonDeg, 2.0);
    await settle(1.0);
    of.look(0, p);
    await settle(0.3);
    const r = of.level();
    aim.push({ pitchDeg: p, moved: r !== null && (r.dug + r.filled) > 0,
      ringVisible: of.terraform().ring.visible });
  }
  of.forgetTunnels();
  of.teleport(site.latDeg, site.lonDeg, 2.0);
  await settle(OF_ARGS.arriveSecs ?? 3.0);
  log.push(`site: lat ${site.latDeg.toFixed(5)} lon ${site.lonDeg.toFixed(5)} `
    + `after ${site.scanned} candidates, probe spread ${site.spread.toFixed(3)} m`);
  log.push(`aim: ground found at pitch ${aim.filter((a) => a.moved)
    .map((a) => a.pitchDeg).join(', ')}`);

  // The player looks where a player looks. NOT down at their boots: the disc
  // falls back to the ground underfoot when the ray finds none (WG-23), so a
  // natural pitch is now a supported way to use the tool and has to be tested
  // as one.
  of.look(OF_ARGS.yawDeg ?? 0, OF_ARGS.pitchDeg ?? -15);
  await settle(0.4);

  const u = unit(eye());
  const inner = ring(u, R * 0.25, 8, bodyR);
  const mid = ring(u, R * 0.45, 8, bodyR);
  const inside = [u, ...inner, ...mid];
  // THE CONTROL RING, sized from THE TOOL rather than from R. `R` is this
  // probe's own idea of a pad and is used above only to pick a slope and to
  // sample well inside whatever the tool cuts; it is NOT the tool's radius and
  // must never again be used as though it were. A press puts its disc up to
  // `reachM` downhill of the player and cuts `radiusM` around that, so
  // `maxReachFromPlayerM` is the furthest ground a press can touch, and the
  // control sits a metre beyond it.
  const limits = of.terraform().limits;
  const OUTSIDE_R = limits.maxReachFromPlayerM + (OF_ARGS.controlMarginM ?? 1.0);
  const outside = ring(u, OUTSIDE_R, 12, bodyR);

  // --- 3. THE DRAWN SURFACE. The worst height difference between two vertices
  // the GPU is drawing that are within one DW-32 foundation module of each
  // other: the step a player would have to take, which is what "flat" means to
  // a person. Skirt vertices hang below their edge twin, so the top of each
  // 0.4 m bucket is the surface and the rest is its apron.
  const SPAN = OF_ARGS.spanM ?? 4.0;
  const drawnStep = (centre, sampleR) => {
    const raw = of.meshVerts(centre[0], centre[1], centre[2], sampleR);
    const top = new Map();
    for (const v of raw) {
      const k = `${Math.round(v.dx / 0.4)},${Math.round(v.dy / 0.4)},${Math.round(v.dz / 0.4)}`;
      const cur = top.get(k);
      if (cur === undefined || v.hM > cur.hM) top.set(k, v);
    }
    const s = [...top.values()];
    let worst = 0;
    for (let i = 0; i < s.length; ++i) {
      for (let j = i + 1; j < s.length; ++j) {
        const dx = s[i].dx - s[j].dx, dy = s[i].dy - s[j].dy, dz = s[i].dz - s[j].dz;
        if (dx * dx + dy * dy + dz * dz > SPAN * SPAN) continue;
        const dh = Math.abs(s[i].hM - s[j].hM);
        if (dh > worst) worst = dh;
      }
    }
    return { worstStepM: +worst.toFixed(3), verts: s.length,
      spreadM: s.length ? +(Math.max(...s.map((v) => v.hM))
        - Math.min(...s.map((v) => v.hM))).toFixed(3) : 0 };
  };

  const feetOf = () => of.world().player.feet;
  const padCentre = feetOf();
  const padR = R * 0.55;
  const inBefore = heights(inside);
  const outBefore = heights(outside);
  const spreadBefore = spreadOf(inBefore);
  const drawnBefore = drawnStep(padCentre, padR);
  log.push(`before: oracle spread ${spreadBefore.toFixed(3)} m, `
    + `DRAWN step within ${SPAN} m ${drawnBefore.worstStepM} m`);

  // --- 4. level it WITH A REAL Q KEYPRESS -----------------------------------
  const beforeKey = of.terraform().action.levels;
  await realKey('KeyQ', OF_ARGS.holdSecs ?? 1.6);
  const afterKey = of.terraform().action.levels;
  await settle(0.8);

  // ...and the extra applications must report ZERO, or a held key would creep.
  const passes = [];
  let lastDisc = null;
  for (let i = 0; i < (OF_ARGS.passes ?? 2); ++i) {
    const r = of.level();
    // Keep the disc /core actually used. The tool quotes its flatness about the
    // centre it chose, and after a pad exists a shallow aim ray can start
    // reaching the pad's far rim, so a probe that assumed the feet would compare
    // two different discs and call an honest number a lie.
    if (r !== null) lastDisc = [r.centre.x, r.centre.y, r.centre.z];
    passes.push(r === null ? null : { dug: r.dug, filled: r.filled, scanned: r.scanned });
    await settle(0.3);
  }

  const tf = of.terraform();
  const inAfter = heights(inside);
  const outAfter = heights(outside);
  const spreadAfter = spreadOf(inAfter);
  const drawnAfter = drawnStep(padCentre, padR);
  let outMoved = 0;
  let outMaxDeltaM = 0;
  for (let i = 0; i < outside.length; ++i) {
    const d = Math.abs(outAfter[i] - outBefore[i]);
    if (d > outMaxDeltaM) outMaxDeltaM = d;
    if (d > 0.001) outMoved++;
  }
  log.push(`after: oracle spread ${spreadAfter.toFixed(3)} m, `
    + `DRAWN step ${drawnAfter.worstStepM} m, outside max delta `
    + `${outMaxDeltaM.toFixed(6)} m over ${outside.length} pts`);
  log.push(`the tool said: "${tf.action.lastMessage}"`);

  // --- 5. IS THE TOOL TELLING THE TRUTH? -----------------------------------
  // It quotes a flatness on every press. Measure the same thing independently,
  // through the oracle, over the same fraction of the disc, and require the two
  // to agree. An honest tool is one whose claim is checkable; this checks it.
  const quoteCentre = lastDisc ?? padCentre;
  const [e1, e2] = basis(unit(quoteCentre));
  const quoteDirs = [unit(quoteCentre)];
  for (let k = 1; k <= 2; ++k) {
    const rad = R * 0.7 * (k / 2);
    for (let i = 0; i < 8; ++i) {
      const a = (Math.PI * i) / 4;
      quoteDirs.push(unit([0, 1, 2].map((m) => quoteCentre[m]
        + e1[m] * Math.cos(a) * rad + e2[m] * Math.sin(a) * rad)));
    }
  }
  const measuredFlatM = spreadOf(heights(quoteDirs));
  const quotedFlatM = tf.action.lastFlatnessM;
  const quoteErrorM = Math.abs(measuredFlatM - quotedFlatM);

  // --- 6. the surface and the solid AGREE ----------------------------------
  let agree = 0;
  const disagree = [];
  for (let i = 0; i < inside.length; ++i) {
    const d = inside[i];
    const rr = bodyR + inAfter[i];
    const below = of.solidAt(d[0] * (rr - 0.5), d[1] * (rr - 0.5), d[2] * (rr - 0.5));
    const above = of.solidAt(d[0] * (rr + 1.5), d[1] * (rr + 1.5), d[2] * (rr + 1.5));
    if (below && !above) agree++;
    else disagree.push({ i, below, above, h: +inAfter[i].toFixed(2) });
  }

  // --- 7. walk it, with the level key RELEASED ------------------------------
  await settle(0.4);
  let metres = 0;
  let prev = eye();
  let grounded = 0, blocked = 0;
  const walk = [];
  const sample = () => {
    const p = eye();
    const d = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    metres += d;
    prev = p;
    const wv = of.world();
    const up = unit(p);
    const col = of.surface(up[0], up[1], up[2]);
    const altM = Math.hypot(p[0], p[1], p[2]) - (bodyR + col.surfaceM);
    if (wv.player.grounded) grounded++;
    if (wv.player.blockedByRock) blocked++;
    walk.push({ stepM: +d.toFixed(2), grounded: wv.player.grounded,
      blocked: wv.player.blockedByRock, eyeAltM: +altM.toFixed(3),
      loweringM: +col.loweringM.toFixed(3) });
  };
  prev = eye();
  for (let i = 0; i < 3; ++i) { await hold(0.15, ['KeyW']); sample(); }
  for (let i = 0; i < 3; ++i) { await hold(0.15, ['KeyS']); sample(); }
  await settle(0.5);
  const n = walk.length;
  const eyeAlt = walk.filter((s) => s.grounded).map((s) => s.eyeAltM);
  const eyeAltSpread = eyeAlt.length > 1 ? Math.max(...eyeAlt) - Math.min(...eyeAlt) : 0;

  // --- 8. save, PUT THE ROCK BACK, load ------------------------------------
  const padBefore = heights(inside);
  const written = await of.save();
  const forgot = of.forgetTunnels();
  const gone = of.terraform();
  const goneHeights = heights(inside);
  const goneSpread = spreadOf(goneHeights);
  const ledger = await of.load();
  const backHeights = heights(inside);
  const back = of.terraform();
  let restoredMaxDeltaM = 0;
  let forgottenMaxDeltaM = 0;
  for (let i = 0; i < padBefore.length; ++i) {
    const d = Math.abs(backHeights[i] - padBefore[i]);
    if (d > restoredMaxDeltaM) restoredMaxDeltaM = d;
    const g = Math.abs(goneHeights[i] - padBefore[i]);
    if (g > forgottenMaxDeltaM) forgottenMaxDeltaM = g;
  }
  log.push(`persist: saved ${written === null ? 'null' : written.voxelBytes + ' B'}, `
    + `forgot -> pad moved ${forgottenMaxDeltaM.toFixed(3)} m, restored max delta `
    + `${restoredMaxDeltaM.toFixed(6)} m`);

  const wEnd = of.world();

  // --- 9. frame the capture -------------------------------------------------
  await settle(0.4);
  of.setTime(OF_ARGS.shotSunT ?? 0.25);
  of.look(OF_ARGS.shotYawDeg ?? (OF_ARGS.yawDeg ?? 0), OF_ARGS.shotPitchDeg ?? -18);
  await settle(1.2);

  // THE PERCEPTUAL THRESHOLD, and it is not met, deliberately.
  //
  // 0.25 m over a 4 m span is what a player reads as flat: 4 m is the DW-32
  // foundation module, so it is the span a structure has to bridge, and 0.25 m
  // is just over the 0.22 m ground-unevenness tolerance the base-building lane
  // measured for placing one. Physically it is a step you take without noticing
  // at 1.6 m of eye height; half a metre is knee height and reads as a terrace.
  //
  // A 1 m Cartesian voxel lattice cut by a plane that is not axis-aligned
  // CANNOT reach it, and no amount of work on levelArea will change that: the
  // pad is flat to about one voxel and never to zero. So the number is measured
  // and reported rather than asserted, and what IS asserted is the bound the
  // medium does allow and the honesty that covers the rest.
  const PERCEPTUAL_M = 0.25;

  return {
    valid: (wEnd.tick - t0.tick) > 400
      && tf.action.levels > 0
      && (tf.action.cellsDug + tf.action.cellsFilled) > 0
      && tf.mouth.sent === tf.mouth.applied,
    advanced: {
      ticks: wEnd.tick - t0.tick, frames: wEnd.frames - t0.frames,
      levels: tf.action.levels, noops: tf.action.noops, misses: tf.action.misses,
      underfoot: tf.action.underfoot,
    },

    // --- THE ACCEPTANCE -----------------------------------------------------
    // A REAL key event reaches the tool, and it finds ground at every pitch a
    // player looks from. Before WG-23 the bottom four rows were all false.
    keyDrivesTheTool: afterKey > beforeKey,
    aimWorksAtEveryPitch: aim.every((a) => a.moved && a.ringVisible),
    // It cut AND filled, and the terrain spread collapsed.
    padIsFlat: tf.action.cellsDug > 0 && tf.action.cellsFilled > 0
      && spreadAfter <= 2.0 && spreadAfter * 2 < spreadBefore,
    // THE DRAWN SURFACE IMPROVED. This is the one the old probe could not make:
    // it must be flatter to LOOK at, not only in the oracle, and the step must
    // be inside one voxel. Against the pre-WG-23 code this reads 2.727 m and
    // fails both halves.
    drawnPadIsFlatterThanTheHill: drawnAfter.worstStepM < drawnBefore.worstStepM,
    drawnStepWithinOneVoxel: drawnAfter.worstStepM <= 1.0,
    // And only inside the radius. THE CONTROL PROVES ITS OWN SETUP FIRST
    // (DW-20): `outsideUntouched` is worth nothing unless the ring was outside
    // every disc the tool cut, and over a held key that is several discs at
    // several centres. `maxRimFromFeetM` is the tool's own record of the
    // furthest its rim ever reached, so this compares the control against the
    // subject instead of against a constant. The ring is centred on the eye and
    // the rim is measured from the feet, which share an up direction to within
    // the capsule's own lean, so the comparison is exact enough for a metre of
    // margin and is deliberately not tighter.
    controlRingClearsThePad: OUTSIDE_R > tf.action.maxRimFromFeetM
      && tf.action.maxRimFromFeetM > 0,
    outsideUntouched: outMoved === 0,
    surfaceAgreesWithSolid: agree === inside.length,
    padIsWalkable: metres >= 1.5 && grounded >= n - 2 && blocked === 0
      && eyeAlt.length >= 3 && eyeAltSpread <= 0.35,
    padSurvivesReload: written !== null && written.voxelBytes > 0
      && forgottenMaxDeltaM > 0.5
      && gone.removedCells === 0 && gone.addedCells === 0
      && restoredMaxDeltaM <= 0.001
      && back.addedCells === tf.addedCells && back.removedCells === tf.removedCells,
    idempotent: passes.every((p) => p !== null && p.dug === 0 && p.filled === 0),
    // THE HONESTY. The tool told the player a number; the number is true.
    toldThePlayer: tf.action.lastMessage.length > 0,
    quoteIsTrue: quoteErrorM <= 0.05,

    site,
    aim,
    // Reported, NOT asserted: the medium cannot reach it. See the note above.
    perceptual: { thresholdM: PERCEPTUAL_M, spanM: SPAN,
      drawnStepM: drawnAfter.worstStepM,
      meetsThreshold: drawnAfter.worstStepM <= PERCEPTUAL_M },
    flatness: { quotedM: quotedFlatM, measuredM: +measuredFlatM.toFixed(3),
      errorM: +quoteErrorM.toFixed(3), message: tf.action.lastMessage },
    spreadM: { before: +spreadBefore.toFixed(3), after: +spreadAfter.toFixed(3),
      forgotten: +goneSpread.toFixed(3),
      collapse: +(spreadBefore / Math.max(spreadAfter, 1e-6)).toFixed(2) },
    drawn: { before: drawnBefore, after: drawnAfter, spanM: SPAN },
    outside: { points: outside.length, moved: outMoved,
      maxDeltaM: +outMaxDeltaM.toFixed(6),
      ringRadiusM: +OUTSIDE_R.toFixed(3),
      toolReachM: limits.reachM, toolRadiusM: limits.radiusM,
      padRimReachedM: +tf.action.maxRimFromFeetM.toFixed(3),
      clearanceM: +(OUTSIDE_R - tf.action.maxRimFromFeetM).toFixed(3) },
    cells: { dug: tf.action.cellsDug, filled: tf.action.cellsFilled,
      removedSet: tf.removedCells, addedSet: tf.addedCells,
      scannedLast: tf.action.lastScanned },
    agreement: { samples: inside.length, agree, disagree },
    passes,
    keys: { levelsBeforeKey: beforeKey, levelsAfterKey: afterKey },
    walked: { metresWalked: +metres.toFixed(2), samples: n, grounded, blocked,
      groundedSamples: eyeAlt.length,
      eyeAltSpreadM: +eyeAltSpread.toFixed(3),
      eyeAltM: eyeAlt.map((v) => +v.toFixed(3)) },
    persist: {
      slot: written, forgot,
      gone: { removedCells: gone.removedCells, addedCells: gone.addedCells },
      ledger: ledger?.voxels ?? null,
      restoredMaxDeltaM: +restoredMaxDeltaM.toFixed(6),
      forgottenMaxDeltaM: +forgottenMaxDeltaM.toFixed(3),
      cellsBack: { added: back.addedCells, removed: back.removedCells },
    },
    heights: {
      insideBefore: round(inBefore), insideAfter: round(inAfter),
      insideRestored: round(backHeights),
    },
    ring: tf.ring,
    action: tf.action,
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw,
      levelMs: tf.action.lastMs },
    log,
  };
})()
