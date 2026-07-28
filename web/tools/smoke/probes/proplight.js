// proplight.js - do a PROP and the GROUND agree about the sun? (RN-60)
//
// OF_ARGS: { lat, lon, yaw, pitch, sweep }
//
// WHY THIS IS MEASURED BEFORE ANY ASSET WORK. The boulders photograph nearly
// black, and there are two completely different reasons that could be true:
// their albedo is too dark, or they are lit differently from the ground they
// stand on. The two look identical in a screenshot and they have opposite fixes.
// Re-authoring boulder albedo to compensate for a lighting mismatch would bake
// the error permanently into the assets, and the next lane would inherit a set
// of rocks tuned around a bug. So the lighting question is settled first.
//
// THE TWO PATHS GENUINELY DIFFER BY CONSTRUCTION, which is what makes this worth
// measuring rather than assuming either way:
//   terrain  TerrainShader lights itself, `sunT * (1.45 * ndl * shadow)` plus
//            its own uAmbient and a sky-ambient integral.
//   props    stock MeshStandardMaterial lit by three's light list, where
//            Systems.ts sets `light.intensity = 3.0 * k * sunK`, plus an IBL
//            environment from SkyIbl.
// Those are two authorities on one sun. This probe asks whether they agree.
//
// THE INSTRUMENT. `of.framehash` renders synchronously and returns per-tile
// means, so a sun sweep can be taken with nothing else moving. Prop pixels are
// identified by DIFFERENCE rather than by guessing at screen regions: capture
// with props visible and with them hidden, and the tiles that moved are the
// tiles props occupy. Tiles that did not move at all are pure ground. That is
// the same attribution trick `?waterfoam=0` used at RN-58, and it means neither
// band is a hand-picked rectangle that could drift when the world changes,
// which is the failure INSTRUMENTS.md opens with.
(async () => {
  const of = window.__of;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const TX = 80, TY = 45;
  const sweep = A.sweep ?? [0.16, 0.22, 0.30, 0.40, 0.50];

  of.teleport(A.lat ?? 12, A.lon ?? 150, 2);
  await of.settle(30);
  of.look(A.yaw ?? 300, A.pitch ?? -10);
  of.setTime(0.30);
  await of.settle(30);

  if (typeof of.propsVisible !== 'function') {
    return { valid: false, why: 'no of.propsVisible' };
  }

  // ------------------------------------------------------------------ masks
  of.propsVisible(true);
  const withProps = of.framehash(TX, TY);
  of.propsVisible(false);
  const noProps = of.framehash(TX, TY);
  of.propsVisible(true);
  // THE RESTORE IS A CONTROL, not housekeeping: if hiding and re-showing does
  // not return the identical frame then the toggle has a side effect and every
  // number below is measuring that side effect instead of the sun.
  const restored = of.framehash(TX, TY);

  const propMask = [];
  const groundMask = [];
  for (let i = 0; i < withProps.tiles.length; ++i) {
    const d = Math.abs(withProps.tiles[i] - noProps.tiles[i]);
    // A tile is PROP only if props dominate it, and GROUND only if props are
    // bit-exactly absent. Everything in between is a mixed tile and is thrown
    // away, because a half-prop tile would average the two lighting models
    // together and blunt exactly the difference this probe is looking for.
    if (d > 12) propMask.push(i);
    else if (d === 0) groundMask.push(i);
  }

  const meanOver = (tiles, idx) => {
    if (idx.length === 0) return 0;
    let s = 0;
    for (const i of idx) s += tiles[i];
    return s / idx.length;
  };

  // ------------------------------------------------------------------ sweep
  const rows = [];
  for (const t of sweep) {
    of.setTime(t);
    await of.settle(8);
    const f = of.framehash(TX, TY);
    rows.push({
      sunT: t,
      elevationDot: mustNum(of.stats().sky, 'elevationDot', 'stats.sky'),
      prop: +meanOver(f.tiles, propMask).toFixed(3),
      ground: +meanOver(f.tiles, groundMask).toFixed(3),
    });
  }

  // THE COMPARISON IS OF RESPONSE, NOT OF LEVEL, and that is the whole design.
  // A rock and a hillside have different albedo, so their absolute luma tells us
  // nothing about the light. What CAN be compared is how each one responds when
  // the sun moves: normalise each curve by its own brightest reading and the
  // albedo cancels. Two surfaces under one agreed sun trace the same curve.
  let pMax = 0, gMax = 0;
  for (const r of rows) { if (r.prop > pMax) pMax = r.prop; if (r.ground > gMax) gMax = r.ground; }
  const curve = rows.map((r) => ({
    sunT: r.sunT, elevationDot: r.elevationDot,
    prop: r.prop, ground: r.ground,
    propNorm: +(r.prop / Math.max(pMax, 1e-6)).toFixed(4),
    groundNorm: +(r.ground / Math.max(gMax, 1e-6)).toFixed(4),
    // Positive means the prop is DARKER than the ground relative to how each
    // one behaves at its own best. That is the shape a lighting mismatch takes.
    gap: +((r.ground / Math.max(gMax, 1e-6)) - (r.prop / Math.max(pMax, 1e-6))).toFixed(4),
  }));

  let worstGap = 0;
  for (const c of curve) if (Math.abs(c.gap) > Math.abs(worstGap)) worstGap = c.gap;
  // Dynamic range: how much each surface moves across the whole sweep. The
  // NEGATIVE CONTROL Admin asked for, and it is the one that catches the worst
  // case: if a surface barely responds at all it is ambient or IBL dominated
  // and is effectively not lit by the sun, which no ratio of levels would show.
  let pMin = Infinity, gMin = Infinity;
  for (const r of rows) { if (r.prop < pMin) pMin = r.prop; if (r.ground < gMin) gMin = r.ground; }
  const propRange = +(pMax - pMin).toFixed(3);
  const groundRange = +(gMax - gMin).toFixed(3);

  const fails = [];
  if (restored.hash !== withProps.hash) {
    fails.push('propsVisible(false) then (true) did not restore the frame: the '
      + 'toggle has a side effect and every reading here is measuring it');
  }
  if (propMask.length < 8) {
    fails.push(`only ${propMask.length} prop-dominated tiles: nothing to measure. `
      + 'Aim at a frame with props in it.');
  }
  if (groundMask.length < 40) {
    fails.push(`only ${groundMask.length} pure-ground tiles: no control band`);
  }
  if (propRange < 1.0) {
    fails.push(`props moved only ${propRange} counts across the whole sun sweep: `
      + 'they are effectively not lit by the sun at all');
  }
  if (groundRange < 1.0) {
    fails.push(`ground moved only ${groundRange} counts across the sweep`);
  }

  return {
    valid: fails.length === 0,
    fails,
    site: { lat: A.lat ?? 12, lon: A.lon ?? 150, yaw: A.yaw ?? 300, pitch: A.pitch ?? -10 },
    tiles: { total: withProps.tiles.length, prop: propMask.length, ground: groundMask.length },
    toggleRestoresFrame: restored.hash === withProps.hash,
    curve,
    // The headline pair. `worstGap` is the largest disagreement between the two
    // normalised response curves anywhere in the sweep; `range` says how much
    // each surface moved at all, so a small gap on a dead curve cannot be read
    // as agreement.
    worstGap,
    range: { prop: propRange, ground: groundRange },
  };
})()
