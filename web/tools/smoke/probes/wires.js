// H-6 (lane D's D-3): THE POWER WIRES ARE DRAWN, AND THEY ARE DRAWN WHERE THE
// POLES ARE.
//
//   cd web && npx vite build --outDir dist-w6
//   npx vite preview --outDir dist-w6 --port 4186
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4186/ --sandbox=1 \
//     --evalfile=web/tools/smoke/probes/wires.js --out=docs/screenshots/W11_wires.png
//
// THE CLAIM: the number of wires on screen is /core's own spanning tree, and
// each one runs between the two poles /core named, at the crossarm height the
// asset publishes, in the frame the camera is actually in.
//
// WHY THAT IS FOUR SEPARATE ASSERTIONS AND NOT ONE COUNT. A renderer that drew
// a fixed number of wires, or drew them at the world origin, or drew them one
// floating-origin rebase late, would all report a plausible instance count. So
// the count is checked against /core, the count is checked against what the
// instance buffer actually holds, and then every endpoint is recovered FROM THE
// MATRIX and measured against the pole position resolved through the CURRENT
// origin. A wire in the wrong frame fails the last one by kilometres.
//
// THE NEGATIVE CONTROLS, in order:
//   1. ZERO POLES: nothing drawn, and the object is not even visible, so the
//      draw-call cost of this feature on a world that has never built a grid
//      is exactly zero.
//   2. ONE POLE: a pole standing, a machine batch drawing, and STILL no wire.
//      A spanning tree over one node has no edges. This is also the draw-call
//      baseline, which is why it is taken here and not before any building
//      exists: the batch is already drawing, so the delta measured next is the
//      wires and nothing else.
//   3. THE COUNT FOLLOWS /core UP AND DOWN. 3 poles then 5 poles then a
//      demolition, with the drawn count re-checked against /core each time. A
//      build that always drew a fixed number cannot pass all three.
//   4. THE POLES COME BACK OUT and the draw call goes with them: calls return
//      to the one-pole baseline exactly. An A/B/A, so a coincidence has to
//      happen twice.
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
  const press = async (code, frames = 6) => {
    of.input.act([code], frames);
    await sleep(0.3);
  };
  const click = (el) => {
    if (!el || el.disabled) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window }));
    return true;
  };

  const view = () => of.game().view.wires;
  const grid = () => of.game().progress.power;
  const listed = () => of.game().factory.list ?? [];
  const poles = () => listed().filter((b) => b.kind === 'pole');
  const org = () => of.world().origin;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  await sleep(1.0);

  // ======================================================================
  // 0. SETUP PROOF (DW-20) AND NEGATIVE CONTROL 1: NO POLES, NO WIRES.
  // ======================================================================
  check('this run is sandbox', of.game().mode.sandbox === true,
    JSON.stringify(of.game().mode));
  const v0 = view();
  check('the wire view exists at all', !!v0, JSON.stringify(of.game().view));
  if (!v0) return { valid: false, fails, why: 'no view.wires in the report' };
  check('the attachment height was READ OFF power_pole.glb',
    v0.attachFromAsset === true, JSON.stringify(v0));
  check('and it is the crossarm, not the ground',
    v0.attachM > 3.0 && v0.attachM < 4.0, v0.attachM);
  check('NEGATIVE CONTROL 1: zero poles draws exactly zero wires',
    v0.instances === 0 && v0.segments.length === 0, JSON.stringify(v0.segments));
  check('and the wire object is not even visible', v0.visible === false, v0.visible);
  check('/core agrees there are no poles yet', grid().poles === 0, grid().poles);
  log.push(`attach ${v0.attachM} m from the asset, thickness ${v0.thickM} m`);

  // ======================================================================
  // 1. CRAFT AND ARM POLES. The player's own path: the Tab panel's button,
  //    the pack tile, the hotbar slot, the left button.
  // ======================================================================
  const yaw = of.world().observer.yawDeg;
  await press('Tab');
  await sleep(0.4);
  const rows = () => [...document.querySelectorAll('#of-panel .of-recipe')];
  const rowNamed = (t) => rows().find((e) =>
    (e.querySelector('.nm')?.textContent ?? '').includes(t));
  let crafted = 0;
  for (let i = 0; i < 8; ++i) {
    if (click(rowNamed('Power pole')?.querySelector('button'))) crafted++;
    await sleep(0.08);
  }
  check('eight poles are craftable in sandbox', crafted === 8, crafted);
  await press('Tab');
  await sleep(0.3);

  of.hotbar(4);
  await sleep(0.15);
  await press('Tab');
  await sleep(0.35);
  const armed = click(document.querySelector('#of-panel .of-slot[data-item="63"]'));
  await sleep(0.2);
  await press('Tab');
  await sleep(0.3);
  check('the pole went on hotbar slot 4', armed);

  // THE REFERENCE LOOK. Every draw-call reading is taken from this exact
  // camera, because the number counts terrain chunks and props too: comparing a
  // reading taken while facing the ground with one taken while facing the hills
  // would measure the horizon, not the wires.
  const REF_YAW = yaw;
  const REF_PITCH = -18;
  const home = async () => { of.look(REF_YAW, REF_PITCH); await sleep(0.3); };

  // A SMALL POLE SUPPLIES 2.5 m, so the cluster has to be tight or /core
  // partitions it into several networks and the spanning tree is several trees.
  // Pitch is the range control: the eye is 1.62 m up, so a look of -50 puts the
  // aim on the ground about 1.4 m out and -20 about 4.5 m out.
  const putPole = async (dyaw, pitch) => {
    const before = poles().length;
    of.hotbar(4);
    await sleep(0.12);
    of.look(yaw + dyaw, pitch);
    await sleep(0.25);
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 10, keys: [] }]);
    await sleep(0.4);
    return poles().length > before;
  };
  // Bearings and ranges that land in DIFFERENT 1 m cells and stay inside one
  // supply area. Tried in order until the target count is reached, because a
  // cell that is already taken refuses the placement rather than stacking.
  const SPOTS = [
    [0, -46], [30, -40], [-30, -40], [0, -30], [55, -34],
    [-55, -34], [22, -25], [-22, -25], [0, -22], [45, -28], [-45, -28],
  ];
  let spot = 0;
  const growTo = async (n) => {
    while (poles().length < n && spot < SPOTS.length) {
      await putPole(SPOTS[spot][0], SPOTS[spot][1]);
      spot++;
    }
    await sleep(0.6);
    return poles().length;
  };

  // ======================================================================
  // 2. NEGATIVE CONTROL 2, AND THE DRAW-CALL BASELINE: ONE POLE, NO WIRE.
  // ======================================================================
  const n1 = await growTo(1);
  check('one pole is on the ground', n1 === 1, n1);
  await home();
  const v1 = view();
  check('NEGATIVE CONTROL 2: one pole is a tree with no edges',
    v1.coreSegments === 0 && v1.instances === 0, JSON.stringify(v1.segments));
  check('and /core says the same', grid().wires === 0, grid().wires);
  check('the wire object is still invisible', v1.visible === false, v1.visible);

  // A QUIESCENT SCENE IS PART OF THE MEASUREMENT. Five settled readings that
  // disagree mean terrain or props are still moving, and a draw-call delta
  // taken across that is noise, so it is asserted rather than averaged away.
  const callSamples = async (k = 5) => {
    const out = [];
    for (let i = 0; i < k; ++i) { await of.settle(3); out.push(of.stats().draw.calls); }
    return out;
  };
  const stable = (s) => (s.every((v) => v === s[0]) ? s[0] : null);
  const baseSamples = await callSamples();
  const callsBefore = stable(baseSamples);
  check('the scene is quiescent before the wires exist',
    callsBefore !== null, JSON.stringify(baseSamples));

  // ======================================================================
  // 3. THREE POLES, TWO SEGMENTS, ONE EXTRA DRAW CALL.
  // ======================================================================
  const n3 = await growTo(3);
  check('three poles are on the ground', n3 === 3, n3);
  await home();
  const g3 = grid();
  const v3 = view();
  // (b) THE SPANNING TREE, stated so it holds for any partition: every network
  //     costs one pole's worth of edges. With one network that is poles - 1.
  check('(b) /core exports poles - networks segments',
    g3.wires === g3.poles - g3.networks,
    `${g3.wires} vs ${g3.poles} - ${g3.networks}`);
  check('the three poles formed ONE network', g3.networks === 1, g3.networks);
  check('(b) so three poles is exactly two segments', g3.wires === 2, g3.wires);
  // (c) WHAT IS DRAWN, not what was intended: `instances` is the InstancedMesh
  //     count and `segments` is read back out of the instance matrix buffer.
  check('(c) the drawn instance count equals /core segment count',
    v3.instances === g3.wires, `${v3.instances} vs ${g3.wires}`);
  check('(c) and the instance buffer really holds that many',
    v3.segments.length === g3.wires, v3.segments.length);
  check('the wire object is visible now', v3.visible === true, v3.visible);
  check('every wire end resolved to a placed pole', v3.unmatchedEnds === 0,
    v3.unmatchedEnds);

  const afterSamples = await callSamples();
  const callsAfter = stable(afterSamples);
  check('the scene is quiescent with the wires up',
    callsAfter !== null, JSON.stringify(afterSamples));
  // (e) ONE draw call, and it is the whole budget for this feature.
  check('(e) the wires cost EXACTLY one extra draw call',
    callsAfter !== null && callsBefore !== null && callsAfter - callsBefore === 1,
    `${callsBefore} -> ${callsAfter}`);
  log.push(`draw calls ${callsBefore} (1 pole, 0 wires) -> ${callsAfter} `
    + `(3 poles, ${g3.wires} wires)`);

  // ======================================================================
  // 4. (d) EVERY ENDPOINT, AGAINST THE POLE /core NAMED, IN THIS FRAME.
  //
  //    `a` and `b` come out of the instance MATRIX (its +Z column is the
  //    segment and its translation the midpoint). `base` is the pole position
  //    resolved through the origin as it stands RIGHT NOW. So the two checks
  //    below are: the wire rises from the pole by exactly the asset's crossarm
  //    height, and it does so from a point this probe can independently find in
  //    the plan. A wire at the world origin misses by the whole eye radius; a
  //    wire drawn before the last rebase misses by the rebase distance.
  // ======================================================================
  const o = org();
  const poleEngine = poles().map((p) => [p.pos[0] - o.x, p.pos[1] - o.y, p.pos[2] - o.z]);
  const TOL = 0.01;
  let worstLift = 0;
  let worstBase = 0;
  let worstLen = 0;
  const touched = new Set();
  for (const s of v3.segments) {
    check('a drawn segment knows both its poles', s.base !== null && s.matched === true);
    if (s.base === null) continue;
    // The lift: from the pole's own position to the drawn end, exactly the
    // crossarm height the asset published and nothing else.
    worstLift = Math.max(worstLift,
      Math.abs(dist(s.a, s.base[0]) - v3.attachM),
      Math.abs(dist(s.b, s.base[1]) - v3.attachM));
    // The base: the point the view says it lifted from is a pole this probe
    // found in the plan, resolved through the live origin by the probe itself.
    for (const end of s.base) {
      let near = Infinity;
      for (const p of poleEngine) near = Math.min(near, dist(end, p));
      worstBase = Math.max(worstBase, near);
      const idx = poleEngine.findIndex((p) => dist(end, p) < 0.01);
      if (idx >= 0) touched.add(idx);
    }
    // The two lifts are parallel, so the drawn segment is as long as the run
    // between the pole bases. A wire that hinged at one end would fail here.
    worstLen = Math.max(worstLen,
      Math.abs(dist(s.a, s.b) - dist(s.base[0], s.base[1])));
  }
  check('(d) every drawn end sits exactly the crossarm height above its pole',
    worstLift < TOL, `worst ${worstLift.toFixed(5)} m`);
  check('(d) and that pole is one this probe found in the plan',
    worstBase < TOL, `worst ${worstBase.toFixed(5)} m`);
  check('(d) the drawn segment spans the same distance the poles do',
    worstLen < TOL, `worst ${worstLen.toFixed(5)} m`);
  // A SPANNING TREE TOUCHES EVERY NODE. Two segments over three poles that both
  // ran between the same two would pass every count above and be wrong.
  check('(d) every pole is on the tree', touched.size === n3,
    `${touched.size} of ${n3}`);
  log.push(`endpoints: lift err ${worstLift.toExponential(2)} m, base err `
    + `${worstBase.toExponential(2)} m, length err ${worstLen.toExponential(2)} m`);
  log.push('segments: ' + JSON.stringify(v3.segments.map((s) => ({
    a: s.a.map((q) => Math.round(q * 1000) / 1000),
    b: s.b.map((q) => Math.round(q * 1000) / 1000), net: s.network }))));

  // ======================================================================
  // 5. NEGATIVE CONTROL 3: THE COUNT FOLLOWS /core UP, THEN DOWN.
  // ======================================================================
  const n5 = await growTo(5);
  await home();
  const g5 = grid();
  const v5 = view();
  check('five poles went down', n5 === 5, n5);
  check('five poles is four segments', g5.wires === g5.poles - g5.networks,
    `${g5.wires} vs ${g5.poles} - ${g5.networks}`);
  check('and four wires are drawn', v5.instances === g5.wires,
    `${v5.instances} vs ${g5.wires}`);
  check('the segment list grew with them', v5.segments.length === g5.wires,
    v5.segments.length);

  // DEMOLITION, through the same path the X key takes.
  const victim = poles()[poles().length - 1];
  of.demolish({ id: victim.id });
  await sleep(0.8);
  await home();
  const g4 = grid();
  const v4 = view();
  check('a pole came back out', g4.poles === 4, g4.poles);
  check('/core re-derived the tree', g4.wires === g4.poles - g4.networks,
    `${g4.wires} vs ${g4.poles} - ${g4.networks}`);
  check('NEGATIVE CONTROL 3: the drawn count FOLLOWED it down',
    v4.instances === g4.wires, `${v4.instances} vs ${g4.wires}`);
  log.push(`count follows /core: 1 pole -> ${v1.instances}, 3 -> ${v3.instances}, `
    + `5 -> ${v5.instances}, 4 after a demolition -> ${v4.instances}`);

  // THE EDGE LIST IS NOT PULLED PER FRAME. `pulls` counts crossings of the WASM
  // boundary; a naive implementation would be at hundreds by now.
  const pullsAtPeak = view().pulls;
  await sleep(2.0);
  check('the edge list is NOT re-pulled on a steady frame',
    view().pulls === pullsAtPeak, `${pullsAtPeak} -> ${view().pulls}`);
  log.push(`WASM pulls after ${of.world().frames} frames: ${pullsAtPeak}`);

  // ======================================================================
  // 6. THE SCREENSHOT FRAME, then NEGATIVE CONTROL 4: take the poles back out
  //    and the draw call goes with them.
  // ======================================================================
  of.look(REF_YAW, -12);
  await sleep(0.6);
  await of.settle(6);
  const shot = { ...view() };
  check('the capture frame still has wires up',
    shot.instances === grid().wires && shot.instances > 0,
    `${shot.instances} vs ${grid().wires}`);
  const frameMs = of.stats().frameMs;

  // A/B/A. Everything electrical comes out; the wire object hides itself and
  // the draw call it cost has to disappear with it.
  for (const p of [...poles()]) { of.demolish({ id: p.id }); await sleep(0.25); }
  await sleep(0.8);
  // ONE pole back, so the A/B/A compares like with like: the baseline was taken
  // with a pole standing and the machine batch already drawing.
  await growTo(1);
  await home();
  const vEnd = view();
  const endSamples = await callSamples();
  const callsEnd = stable(endSamples);
  check('back to one pole', poles().length === 1, poles().length);
  check('NEGATIVE CONTROL 4: no segments, nothing drawn, nothing visible',
    vEnd.instances === 0 && vEnd.segments.length === 0 && vEnd.visible === false,
    JSON.stringify(vEnd.segments));
  check('and the extra draw call went away with them',
    callsEnd !== null && callsEnd === callsBefore, `${callsBefore} -> ${callsEnd}`);
  check('nothing was ever refused by the pool', vEnd.refused === 0, vEnd.refused);
  log.push(`A/B/A draw calls: ${callsBefore} / ${callsAfter} / ${callsEnd}`);

  // ======================================================================
  // 7. THE CAPTURE FRAME, which the runner takes AFTER this probe returns.
  //
  //    A wire lives at 3.95 m and the eye at 1.62 m, so from where a pole is
  //    placed the crossarms are overhead and out of shot: the first capture of
  //    this feature was four masts cut off at the top of the frame with the
  //    wires above it. So the grid is rebuilt, the hands go back in (no ghost,
  //    no build prompt), the player walks BACKWARDS along the same bearing and
  //    the pitch is then SEARCHED rather than guessed, by minimising the
  //    angular miss between the aim ray and the middle of the wire span.
  // ======================================================================
  await growTo(5);
  of.hotbar(1);
  await sleep(0.2);
  of.goals(false);
  of.look(REF_YAW, 0);
  await sleep(0.3);
  of.input.tape([{ hold: 85, actions: ['back'] }, { hold: 6, keys: [] }]);
  await sleep(2.2);
  const target = (() => {
    const ps = poles();
    const c = [0, 0, 0];
    for (const p of ps) for (let k = 0; k < 3; ++k) c[k] += p.pos[k] / ps.length;
    const r = Math.hypot(c[0], c[1], c[2]) || 1;
    // The centroid, lifted to the crossarm along its own radial.
    return c.map((q, k) => q + (c[k] / r) * view().attachM);
  })();
  const missTo = () => {
    const a = of.aim();
    const v = [target[0] - a.origin[0], target[1] - a.origin[1],
      target[2] - a.origin[2]];
    const t = v[0] * a.dir[0] + v[1] * a.dir[1] + v[2] * a.dir[2];
    if (t <= 0) return Infinity;
    return Math.hypot(v[0] - a.dir[0] * t, v[1] - a.dir[1] * t,
      v[2] - a.dir[2] * t);
  };
  let bestPitch = 0;
  let bestMiss = Infinity;
  for (let p = -20; p <= 40; p += 2) {
    of.look(REF_YAW, p);
    const m = missTo();
    if (m < bestMiss) { bestMiss = m; bestPitch = p; }
  }
  of.look(REF_YAW, bestPitch);
  await sleep(0.8);
  await of.settle(6);
  const standoffM = (() => {
    const a = of.aim();
    return Math.hypot(target[0] - a.origin[0], target[1] - a.origin[1],
      target[2] - a.origin[2]);
  })();
  check('the capture is framed ON the wire span', bestMiss < 1.0,
    `miss ${bestMiss.toFixed(2)} m at pitch ${bestPitch}`);
  check('and taken from far enough back to see the crossarms, and near enough'
    + ' that a 5 cm cable is more than a pixel',
    standoffM > 5 && standoffM < 14, standoffM);
  log.push(`capture: pitch ${bestPitch} deg, standoff ${standoffM.toFixed(1)} m, `
    + `miss ${bestMiss.toFixed(2)} m`);
  const finalView = view();
  const finalGrid = grid();
  check('the capture frame is rebuilt and wired',
    finalView.instances === finalGrid.wires && finalView.instances > 0,
    `${finalView.instances} vs ${finalGrid.wires}`);

  return {
    valid: fails.length === 0,
    fails,
    log,
    poles: { one: n1, three: n3, five: n5, afterDemolition: g4.poles,
      final: poles().length },
    coreSegments: { one: v1.coreSegments, three: g3.wires, five: g5.wires,
      afterDemolition: g4.wires, final: finalGrid.wires },
    drawnSegments: { zero: v0.instances, one: v1.instances, three: v3.instances,
      five: v5.instances, afterDemolition: v4.instances,
      afterTeardown: vEnd.instances, final: finalView.instances },
    endpointErrorM: { lift: worstLift, base: worstBase, length: worstLen },
    poleTreeCoverage: `${touched.size}/${n3}`,
    drawCalls: { before: callsBefore, after: callsAfter, afterTeardown: callsEnd,
      delta: callsAfter === null || callsBefore === null ? null
        : callsAfter - callsBefore,
      samples: { base: baseSamples, wired: afterSamples, teardown: endSamples } },
    frameMs,
    wasmPulls: view().pulls,
    capture: { pitchDeg: bestPitch, standoffM, missM: bestMiss },
    attach: { m: finalView.attachM, fromAsset: finalView.attachFromAsset,
      thickM: finalView.thickM },
    pool: { instances: finalView.instances, capacity: finalView.capacity,
      grows: finalView.grows, refused: finalView.refused },
    ticks: of.world().tick,
  };
})()
