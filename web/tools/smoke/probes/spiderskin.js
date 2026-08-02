// RN-459 / RN-461: IS THE FUR MAP ON THE CREATURE IN THE GAME, and can this probe
// tell if it were not?
//
//   node tools/smoke/run.mjs --sandbox=1 --combat=1 --scenario=walk \
//     --sundot=0.30 --url=http://127.0.0.1:<port>/ \
//     --evalfile=tools/smoke/probes/spiderskin.js \
//     --out=docs/screenshots/RN459_ingame_dusk.png
//
// THE NAMED FAILURE MODE, BEFORE MEASURING, and it is the reason this probe
// exists rather than a screenshot. `SpiderFlock.load` merges every _LOD0
// primitive into ONE geometry, and until RN-457 it DELETED the `uv` attribute
// while doing it. A chitin map bound to that material would then sample uv
// 0,0 on every vertex and draw one flat texel over the whole creature. Every
// surface a lane normally checks reads correct in that state: the family
// loads, the material has a map, `hasMap` is true, VRAM is spent, and the
// creature is untextured. That is the flora lane's grey-white silent drop
// wearing a different colour, and no assertion of the form "a map is bound"
// can see it.
//
// So the fixture is asserted in terms of the quantity under test:
//   1. the UVs REACHED the merged geometry (`uv.byConsumer.spider`), and
//      nothing anywhere was synthesised or short (both are "an asset shipped
//      without usable UVs" and both are counted rather than tolerated), and
//   2. the map is 384 px, not a 1x1 placeholder (RN-78's groundshot lie), and
//   3. the repeat is 1/0.30 m, which is the ONLY thing that distinguishes a
//      tiling body albedo from a card stretched once over a whole creature.
//
// THE TWO-SIDED CLAIM. `setMaps` unbinds every map in place inside one settled
// frame, so the same rig, the same pose, the same sun and the same streamed
// chunks are held equal and the maps are the only thing that moved. A frame
// hash that does NOT move when every map is unbound means nothing was ever
// sampling them, which is exactly the failure above, so this is red and green
// in one run on one build. The restore is then asserted BIT-EXACT, because
// apply() rebinds the same texture objects and rewrites material.color from
// the captured baseColor, so anything else is a leak.
(async () => {
  const of = window.__of;
  const surf = window.__ofSurfaces;
  if (!of || !surf) return { valid: false, why: 'no __of / __ofSurfaces' };
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  await surf.ready;

  // ---- family fixture, before any creature exists ------------------------
  const r0 = surf.report();
  check('the client role table agrees with surfaces.json',
        r0.tableAgreesWithManifest, JSON.stringify(r0.mismatches));
  check('no unknown roles', r0.unknownRoles.length === 0,
        JSON.stringify(r0.unknownRoles));
  const fam = Object.fromEntries(r0.families.map((f) => [f.name, f]));
  const ch = fam.fur;
  check('the fur family loaded', ch !== undefined,
        JSON.stringify(Object.keys(fam)));
  if (ch !== undefined) {
    check('fur carries an albedo AND a tiling repeat',
          ch.albedo === true && ch.tileM === 0.3, JSON.stringify(ch));
    check('fur is 384 px', ch.sizePx === 384, `${ch.sizePx}`);
    check('fur declares NO alpha test (it is opaque)',
          ch.alphaTest === null, `${ch.alphaTest}`);
    check('fur publishes an albedo mean',
          typeof ch.albedoMean === 'number' && ch.albedoMean > 0.1,
          `${ch.albedoMean}`);   // RN-461: family renamed chitin -> fur
  }

  // ---- the scene: spiderwalk's own recipe, and stand BESIDE the column ---
  await of.run(1.0);
  of.audio('unlock');
  await of.run(0.2);
  const e0 = of.enemies();
  if (!check('combat world', e0.enabled === true, e0.why)) {
    return { valid: false, fails, why: e0.why };
  }
  const yaw0 = of.world().observer.yawDeg;
  for (let i = 0; i < 8; i++) {
    of.build(3);
    await of.run(0.08);
    of.look(yaw0 + i * 21, -24);
    await of.run(0.18);
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await of.run(0.32);
  }
  await of.run(1.2);
  let waves = 0;
  for (let k = 0; k < 30 && waves === 0; k++) {
    waves = of.enemies('advance', 3600).wavesDispatched;
  }
  if (!check('a wave dispatched', waves > 0, `${waves}`)) {
    return { valid: false, fails, enemies: of.enemies() };
  }
  await of.run(2, 60);
  // 55 m off is inside CLAIM_M (80) and far outside reach, so the column keeps
  // MARCHING and the rigs claim its near edge as walkers rather than as the
  // things currently eating the player (spiderwalk's own lesson).
  const OFF_DEG = 55 / ((Math.PI * 600000) / 180);
  const near0 = of.enemies('near', 1)[0];
  if (near0 !== undefined) of.teleport(near0.latDeg + OFF_DEG, near0.lonDeg, 30);
  await of.run(1.5);
  await of.settle(6);

  const sp = of.enemies().spiders;
  check('the flock loaded', sp.state === 'ready',
        JSON.stringify({ state: sp.state, error: sp.error }));
  check('near creatures are CLAIMED', sp.claimed > 0, JSON.stringify(sp));

  // ---- did the UVs survive the merge ------------------------------------
  const r1 = surf.report();
  check('the merged creature carries UVs',
        (r1.uv.byConsumer.spider ?? 0) > 0, JSON.stringify(r1.uv));
  check('no UVs synthesised anywhere', r1.uv.synthesised === 0,
        `${r1.uv.synthesised}`);
  check('no short UV set anywhere', r1.uv.countMismatch === 0,
        `${r1.uv.countMismatch}`);

  const mats = r1.materials.filter((m) => m.label.startsWith('spider:'));
  check('a spider material registered', mats.length > 0,
        JSON.stringify(r1.materials.map((m) => m.label)));
  for (const m of mats) {
    check(`${m.label} is on fur`, m.family === 'fur', m.family);
    check(`${m.label} has all four maps`,
          m.hasNormal && m.hasRough && m.hasMetal && m.hasAo && m.hasMap,
          JSON.stringify(m));
    check(`${m.label} albedo is 384 px, not a placeholder`,
          m.mapSize === 384, `${m.mapSize}`);
    check(`${m.label} repeats every 0.30 m`,
          Math.abs((m.repeat ?? 0) - 1 / 0.3) < 1e-3, `${m.repeat}`);
    check(`${m.label} normal and orm are DATA, not sRGB`, m.dataColorSpace);
    check(`${m.label} alphaTest stays 0 (opaque body)`, m.alphaTest === 0,
          `${m.alphaTest}`);
    check(`${m.label} carries the client's merged constants`,
          Math.abs(m.roughness - 0.95) < 1e-6 && Math.abs(m.metalness - 0.02) < 1e-6,
          JSON.stringify({ r: m.roughness, mt: m.metalness }));
  }

  // ---- AIM AT A CREATURE, because --out captures whatever the camera was
  // last left looking at and the first run of this probe photographed an
  // empty hillside with a build ghost up. The heading is found the way
  // spiderwalk.js finds it, which is convention-free: sweep twelve headings,
  // keep the one whose frame MOVES most over 0.4 s. By construction that is
  // the walkers, so it needs no bearing arithmetic and cannot disagree with
  // the client's yaw sign.
  const nearNow = of.enemies('near', 1)[0];
  if (nearNow !== undefined) {
    const CLOSE_DEG = 16 / ((Math.PI * 600000) / 180);
    of.teleport(nearNow.latDeg + CLOSE_DEG, nearNow.lonDeg, 30);
    await of.run(1.0);
    let best = { yaw: 0, moved: -1 };
    for (let a = 0; a < 12; a++) {
      of.look(a * 30, -6);
      await of.run(0.05);
      const q0 = of.framehash(24, 14);
      await of.run(0.4);
      const q1 = of.framehash(24, 14);
      let moved = 0;
      for (let i = 0; i < q0.tiles.length; i++) {
        if (Math.abs(q0.tiles[i] - q1.tiles[i]) > 2.5) moved++;
      }
      if (moved > best.moved) best = { yaw: a * 30, moved };
    }
    of.look(best.yaw, -6);
    await of.run(0.4);
    await of.settle(4);
    check('the aiming sweep found a heading with motion in it', best.moved > 0,
          JSON.stringify(best));
  }

  // ---- the two-sided claim: unbind, and the frame MUST move -------------
  //
  // `of.framehash()` returns an OBJECT, not a scalar, and the first version of
  // this probe compared the objects with `!==`. That is always true, so the
  // "unbinding changes the frame" check passed VACUOUSLY and the bit-exact
  // check failed with `[object Object] vs [object Object]`. It is the exact
  // class this file's header is about, committed by the probe written to catch
  // it, and it is why the comparison below is on `.hash` and on a COUNT of
  // moved tiles rather than on whatever the call happens to return.
  const tileDelta = (a, b) => {
    let n = 0;
    let peak = 0;
    for (let i = 0; i < a.tiles.length; i++) {
      const d = Math.abs(a.tiles[i] - b.tiles[i]);
      if (d > 1.0) n++;
      if (d > peak) peak = d;
    }
    return { moved: n, of: a.tiles.length, peak: Math.round(peak * 100) / 100 };
  };
  const hOn = of.framehash();
  surf.setMaps({ normal: false, orm: false, albedo: false });
  const hOff = of.framehash();
  const dOff = tileDelta(hOn, hOff);
  check('unbinding every map CHANGES the frame hash',
        hOn.hash !== hOff.hash, `${hOn.hash} vs ${hOff.hash}`);
  check('and it moves tiles, not just a hash', dOff.moved > 0,
        JSON.stringify(dOff));
  const rOff = surf.report();
  const mOff = rOff.materials.filter((m) => m.label.startsWith('spider:'));
  check('and the report can SEE it unbound',
        mOff.length > 0 && mOff.every((m) => !m.hasMap && !m.hasNormal),
        JSON.stringify(mOff.map((m) => ({ map: m.hasMap, n: m.hasNormal }))));
  surf.setMaps({ normal: true, orm: true, albedo: true });
  const hBack = of.framehash();
  const dBack = tileDelta(hOn, hBack);
  check('and the restore is BIT-EXACT', hBack.hash === hOn.hash
        && dBack.moved === 0, JSON.stringify({ hash: hBack.hash, dBack }));

  return {
    valid: true, fails, pass: fails.length === 0,
    fur: ch ?? null,
    uv: r1.uv,
    vramMB: r1.vramMB,
    spiderMaterials: mats,
    hashes: { on: hOn.hash, off: hOff.hash, restored: hBack.hash },
    tilesMovedByUnbinding: dOff, tilesMovedByRestore: dBack,
    spiders: { claimed: sp.claimed, state: sp.state },
    sun: of.stats().sky.elevationDot,
  };
})()
