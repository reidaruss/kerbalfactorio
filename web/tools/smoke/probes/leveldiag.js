// Why does a measured 2.3x collapse in terrain spread read to a human as
// nothing happening? Four candidate causes, measured rather than argued.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --scenario=walk \
//     --evalfile=tools/smoke/probes/leveldiag.js --out=docs/screenshots/x.png
//
//   1. THE KEY. Q through a real DOM KeyboardEvent, not through a tape. An
//      inert left mouse button survived twenty green probes because every one
//      of them drove an action abstraction that never touches the DOM.
//   2. THE AIM. The tool needs ground within 9 m of the eye along the aim ray.
//      At the pitch a player actually walks around at, is there any?
//   3. THE DRAWN SURFACE. Every existing assertion reads the oracle. A player
//      does not stand on the oracle, they look at the mesh. Sample both, about
//      the disc's OWN centre, against the disc's OWN target height.
//   4. THE FEEDBACK. Ring, counters, and whether a miss says anything.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const log = [];
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };

  await settle(1.0);
  if (of.world().player === null) return { valid: false, why: 'no character' };
  if (of.terraform() === null) return { valid: false, why: 'no terraforming tool' };
  await of.wipe();
  of.forgetTunnels();
  const t0 = of.world().tick;

  const lat = A.latDeg ?? 1.79040;
  const lon = A.lonDeg ?? 144.20960;
  const bodyR = of.world().bodyRadiusM;
  const fresh = async (secs) => {
    of.forgetTunnels();
    of.teleport(lat, lon, 2.0);
    await settle(secs);
  };
  await fresh(A.arriveSecs ?? 3.0);

  const unit = (p) => { const r = Math.hypot(p[0], p[1], p[2]); return [p[0] / r, p[1] / r, p[2] / r]; };

  // --- 1. THE KEY, through a real DOM event ---------------------------------
  // A tape sets the held-code set directly. A player presses a key, and the one
  // thing that turns that into a held code is Input's window keydown listener.
  const realKey = async (code, secs) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: 'q', bubbles: true }));
    await of.run(secs, 60);
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key: 'q', bubbles: true }));
    await of.run(0.4, 60);
  };
  of.look(0, A.workPitchDeg ?? -72);
  await settle(0.4);
  const keyBefore = of.terraform().action.levels;
  await realKey('KeyQ', A.holdSecs ?? 1.2);
  await settle(0.6);
  const keyAfter = of.terraform().action.levels;
  log.push(`real DOM KeyQ: levels ${keyBefore} -> ${keyAfter}`);

  // --- 2. THE AIM, at the pitches a player walks around at -------------------
  // of.level() returns null when the ray finds no ground, which is the miss the
  // player experiences. A fresh world per pitch, so each answer stands alone.
  const pitches = A.pitches ?? [0, -10, -20, -30, -45, -60, -72];
  const aim = [];
  for (const p of pitches) {
    await fresh(1.0);
    of.look(0, p);
    await settle(0.3);
    const r = of.level();
    aim.push({
      pitchDeg: p, foundGround: r !== null,
      dug: r === null ? 0 : r.dug, filled: r === null ? 0 : r.filled,
      ringVisible: of.terraform().ring.visible,
    });
  }
  const shallowest = aim.find((a) => a.foundGround);
  log.push(`aim: ground first found at pitch ${shallowest ? shallowest.pitchDeg : 'never'} deg; `
    + `nothing at ${aim.filter((a) => !a.foundGround).map((a) => a.pitchDeg).join(', ')}`);

  // --- 3. THE DRAWN SURFACE, about the disc's own centre --------------------
  const stat = (hs) => {
    if (hs.length === 0) return { n: 0 };
    const s = [...hs].sort((a, b) => a - b);
    const q = (f) => s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))];
    return { n: s.length, spread: +(s[s.length - 1] - s[0]).toFixed(3),
      p05: +q(0.05).toFixed(3), p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3) };
  };
  // THE PERCEPTUAL NUMBER: the biggest height difference between two DRAWN
  // vertices within one foundation module of each other. A player reads a floor
  // as flat or not by the step they have to take across it, not by the total
  // range over the whole disc, and DW-32 makes 4 m the span that matters.
  const worstStep = (verts, withinM) => {
    let worst = 0;
    for (let i = 0; i < verts.length; ++i) {
      for (let j = i + 1; j < verts.length; ++j) {
        const dx = verts[i].dx - verts[j].dx;
        const dy = verts[i].dy - verts[j].dy;
        const dz = verts[i].dz - verts[j].dz;
        if (dx * dx + dy * dy + dz * dz > withinM * withinM) continue;
        const dh = Math.abs(verts[i].hM - verts[j].hM);
        if (dh > worst) worst = dh;
      }
    }
    return +worst.toFixed(3);
  };
  const ring = (u, metres, n) => {
    const seed = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const cx = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let e1 = cx(u, seed); const L = Math.hypot(...e1); e1 = e1.map((v) => v / L);
    const e2 = cx(u, e1);
    const out = [];
    for (let i = 0; i < n; ++i) {
      const a = (2 * Math.PI * i) / n;
      out.push(unit([0, 1, 2].map((k) => u[k] * bodyR
        + (e1[k] * Math.cos(a) + e2[k] * Math.sin(a)) * metres)));
    }
    return out;
  };
  const span = A.spanM ?? 4.0;
  const measure = (centre, sampleR) => {
    const u = unit(centre);
    const dirs = [u];
    for (let t = 0.25; t <= 1.0001; t += 0.25) dirs.push(...ring(u, sampleR * t, 16));
    const oracle = dirs.map((d) => of.surface(d[0], d[1], d[2]).surfaceM);
    const verts = of.meshVerts(centre[0], centre[1], centre[2], sampleR);
    // Skirt vertices hang below their edge twin; the top of a 0.4 m bucket is
    // the surface, the rest is its apron.
    const top = new Map();
    for (const v of verts) {
      const k = `${Math.round(v.dx / 0.4)},${Math.round(v.dy / 0.4)},${Math.round(v.dz / 0.4)}`;
      const cur = top.get(k);
      if (cur === undefined || v.hM > cur.hM) top.set(k, v);
    }
    const surf = [...top.values()];
    // A pad cut into a hill HAS a bank at its rim, and every game in the genre
    // draws one. The question is whether the FLOOR is flat, so the interior and
    // the rim are reported apart: `inner` is the half of the disc a base would
    // stand on, `full` includes the cut bank.
    const inner = surf.filter((v) => v.dM <= sampleR * 0.6);
    return {
      oracle: stat(oracle), drawn: stat(surf.map((v) => v.hM)),
      drawnVerts: surf.length, innerVerts: inner.length,
      innerSpreadM: stat(inner.map((v) => v.hM)).spread ?? 0,
      drawnStepM: worstStep(surf, span),
      innerStepM: worstStep(inner, span),
      profile: surf.map((v) => [+v.dM.toFixed(2), +v.hM.toFixed(2)])
        .sort((a, b) => a[0] - b[0]),
    };
  };

  await fresh(2.0);
  of.look(0, A.workPitchDeg ?? -72);
  await settle(0.4);
  // Level ONCE and keep the disc /core actually used, so every sample below is
  // about the ground that moved rather than about a guess at where it was.
  const r0 = of.level();
  if (r0 === null) return { valid: false, why: 'the tool found no ground to level' };
  await settle(1.5);
  const centre = [r0.centre.x, r0.centre.y, r0.centre.z];
  const sampleR = (A.sampleFrac ?? 0.8) * r0.radiusM;
  const after = measure(centre, sampleR);

  // The same disc on untouched ground, for the before half. Fresh world, same
  // centre, so the two measurements describe the same patch of hillside.
  await fresh(2.0);
  const before = measure(centre, sampleR);

  log.push(`oracle spread over the pad ${before.oracle.spread} -> ${after.oracle.spread} m`);
  log.push(`DRAWN spread ${before.drawn.spread} -> ${after.drawn.spread} m `
    + `over ${after.drawnVerts} vertices`);
  log.push(`DRAWN worst step within ${span} m: ${before.drawnStepM} -> ${after.drawnStepM} m`);

  await settle(0.5);
  const tf = of.terraform();
  return {
    valid: of.world().tick - t0 > 400 && keyAfter > keyBefore,
    ticks: of.world().tick - t0,
    realKeyDrivesTool: keyAfter > keyBefore,
    aim,
    groundFoundAtWalkingPitch: aim.filter((a) => a.pitchDeg >= -30).every((a) => a.foundGround),
    disc: { targetHeightM: +r0.targetHeightM.toFixed(3), radiusM: r0.radiusM,
      dug: r0.dug, filled: r0.filled },
    before, after,
    spanM: span,
    ring: tf.ring,
    action: tf.action,
    log,
  };
})()
