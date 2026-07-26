// W7: a belt that turns a corner is drawn as a curve.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/beltcurve.js \
//        --out=docs/screenshots/W7_belt_curve.png
//
// belt_curve_l.glb and belt_curve_r.glb have been built and validated since
// Tier 0 and nothing ever drew one, so a line that turned was two straight tiles
// meeting at a right angle with a notch in the deck.
//
// HOW THE L IS LAID, through the player's own keys. The build ghost's CELL comes
// from where the aim ray meets the ground and its FLOW direction comes from R,
// and the two are independent. So sweeping the pitch from steep to shallow lays
// tiles at successively farther cells along one axis, and pressing R before the
// last one turns that tile's flow ninety degrees without moving it: the tile
// behind feeds it, and it sends the line off sideways. That is a corner, laid by
// a player who could do exactly the same thing.
//
// BOTH HANDS ARE TESTED. One quarter turn and three quarter turns are opposite
// corners, and a sign error in the tangent frame would draw them as each other,
// which a single-corner test would pass.
(async () => {
  const of = window.__of;
  const log = [];
  // `of.run` and NOT a neutral input tape: playTape REPLACES whatever is
  // playing, so a settle that lays down an empty tape wipes the key press it
  // was meant to be waiting for. The first version of this probe placed
  // nothing at all for exactly that reason.
  const settle = (secs) => of.run(secs, 60);
  const fac = () => of.game().factory;
  const view = () => of.game().view;

  await settle(1.0);
  await of.wipe();
  const t0 = of.world();
  if (of.game() === null) return { valid: false, why: 'no gameplay layer' };

  const yaw = of.world().observer.yawDeg;
  of.build(2);                              // the belt, i.e. the 2 key

  // Turn the ghost with R, `n` quarter turns from wherever it is now.
  const turnTo = async (want) => {
    for (let i = 0; i < 4 && of.build().rotation !== want; ++i) {
      of.input.tape([{ hold: 3, keys: ['KeyR'] }, { hold: 4, keys: [] }]);
      await settle(0.12);
    }
    return of.build().rotation;
  };

  // Place ONE tile at the first cell the sweep finds that is not taken. Returns
  // the plan record, so the caller can name what it laid.
  const placeAt = async (pitch, rotation, wantCell) => {
    await turnTo(rotation);
    of.look(yaw, pitch);
    await settle(0.06);
    const g = of.build().ghost;
    if (g === null || !g.ok) return null;
    if (wantCell !== null && wantCell !== undefined
        && !same(g.cell.split(',').map(Number), wantCell)) return null;
    const before = fac().buildings;
    of.input.tape([{ hold: 3, keys: ['KeyG'] }, { hold: 4, keys: [] }]);
    await settle(0.16);
    if (fac().buildings <= before) return null;
    return fac().list[fac().list.length - 1];
  };

  // Two legs. Each is two straight tiles laid by walking the pitch out from the
  // feet, then ONE tile whose flow is turned before it goes down.
  //
  // The corner tile's cell is CHECKED, not hoped for. The ground under the sweep
  // is not flat, so the hit point wanders a metre sideways as the pitch opens
  // out; a tile that lands off the axis is simply not behind anything and would
  // not be a corner at all. The sweep therefore keeps going until the ghost is
  // standing exactly one step ahead of the previous tile.
  const cellOf = (c) => c.split(',').map(Number);
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const laid = [];
  const legs = [];
  const pitches = [];
  for (let p = -66; p <= -15; p += 0.6) pitches.push(p);
  let at = 0;
  for (const rot of [1, 3]) {
    const leg = [];
    let want = null;
    while (at < pitches.length && leg.length < 3) {
      const turn = leg.length < 2 ? 0 : rot;
      const made = await placeAt(pitches[at++], turn, want);
      if (made === null) continue;
      leg.push({ ...made, rot: turn });
      laid.push(made);
      if (leg.length === 2) {
        // The step this leg advances by, measured rather than assumed.
        const a = cellOf(leg[0].cell), b = cellOf(leg[1].cell);
        want = [b[0] * 2 - a[0], b[1] * 2 - a[1], b[2] * 2 - a[2]];
      }
    }
    legs.push(leg);
    log.push(`leg with a ${rot === 1 ? 'first' : 'third'} quarter turn: `
      + leg.map((b) => `${b.cell}/r${b.rot}`).join(' -> '));
  }
  of.build(0);
  await settle(0.6);

  const f = fac();
  const v = view();
  const turns = v.curveTiles.map((c) => c.turn).sort().join('');
  log.push(`${f.runs.length} runs, ${v.curves} curve tiles (${turns || 'none'})`);

  // Frame the shot on the corner: stand back and look down the line.
  of.look(yaw, -34);
  await settle(0.6);

  return {
    valid: laid.length >= 4 && (of.world().tick - t0.tick) > 200
      && f.buildings === laid.length,
    // --- THE ACCEPTANCE -----------------------------------------------------
    // Exactly one corner per leg, and the two legs turn opposite ways: a sign
    // error would give 'll' or 'rr' and a missing detection would give ''.
    cornersAreCurved: v.curves === 2 && turns === 'lr',
    // And the straights are still straight: a rule that curved everything would
    // pass the line above.
    straightsStayStraight: v.curves < f.buildings,
    curves: v.curveTiles,
    turns,
    buildings: f.buildings,
    runs: f.runs,
    runCount: f.runs.length,
    legs: legs.map((l) => l.map((b) => ({ cell: b.cell, rot: b.rot }))),
    view: v,
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw.calls },
    log,
  };
})()
