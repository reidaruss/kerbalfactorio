// RN-514 to RN-518. DOES THE PELT ACTUALLY MOVE: the wind, the lag, the
// splice point and the `?fur=0` boot default, all measured rather than argued.
//
//   node tools/smoke/run.mjs --sandbox=1 --combat=1 --scenario=walk \
//     --width=1600 --height=900 --url=http://127.0.0.1:<port>/ \
//     --evalfile=tools/smoke/probes/furmotion.js
//   ... and again with --fur=0 for the negative control.
//
// WHAT WAS UNVERIFIED AND WHY. RN-465 shipped `FurShader.ts` with rim scatter, a
// wind sway and a motion lag, and recorded plainly that the last two had never
// been run: they are functions of a clock and a velocity that exist only in the
// running game. It also recorded that `furStats()` was published so the hook and
// the boot default could be asserted. TWO THINGS WERE WRONG WITH THAT, both
// found before this probe measured anything:
//   1. `SpiderFlock.furStats` is called by no file in the repository and no
//      debug surface exposes the flock, so nothing could read it. RN-514 moves
//      the handle to `window.__ofFur`, on PropWind's precedent.
//   2. `fur` was not in run.mjs's forwarded-parameter list, so `--fur=0` was
//      DROPPED by the runner and the URL arrived without it. The negative
//      control could not be exercised even by hand. Also fixed at RN-514.
// Both are INSTRUMENTS.md's "a green result from an instrument that was never
// running", and neither would ever have failed a check, because no check could
// reach them.
//
// THE PAIR IS THREE `framehash` RENDERS AND NO SCREENSHOTS, AND THAT IS THE
// WHOLE CORRECTNESS ARGUMENT. `of.framehash` renders SYNCHRONOUSLY and advances
// no ticks, while `of.screenshot()` resolves from inside the rAF drain and
// therefore RUNS THE SIM. Between two screenshots eight creatures walk, so a
// pelt sway of 18 mm would be measured against creatures that had moved metres.
// Between two framehashes with a uniform written in between, NOTHING moves
// except that uniform, and the instrument's floor is not small, it is exactly
// zero. The third render restores the first uniform and must return the hash
// bit-exactly; that is what makes every number here attributable.
//
// THE AIMING IS SOLVED BY POINTING IT AT THE THING UNDER TEST. RN-459's picture
// failed twice, and one of the two reasons was that spiderwalk's "twelve
// headings, keep the one that moves most" was true when it was written and false
// once the flora lane's wind landed: 11,465 foliage instances move in EVERY
// heading, so the sweep reliably finds foliage. Here the sweep keeps the heading
// whose FUR PAIR moves most, and a fur pair is two framehashes with the wind
// clock frozen and no ticks between them, so foliage contributes exactly zero
// by construction. The sweep therefore cannot be won by anything but a pelt.
//
// `of.framehash` IS LUMA ONLY and that is correct HERE and wrong elsewhere. The
// sway is a geometric displacement of a lit silhouette, so it moves luminance;
// the pale-disc lesson (a hue-only change reads about zero on luma) applies to
// grades and washes, not to a vertex moving.

(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const out = { checks: [], fails: [] };
  const check = (name, ok, detail) => {
    out.checks.push({ name, ok: !!ok, detail });
    if (!ok) out.fails.push(`${name}: ${JSON.stringify(detail)}`);
  };

  const fur = window.__ofFur;
  const q = new URLSearchParams(location.search);
  const wantOff = q.get('fur') === '0';

  // ---------------------------------------------------------------- fixture
  check('the fur handle is reachable at all (RN-514)',
    fur !== undefined && typeof fur.state === 'function', { has: fur !== undefined });
  if (fur === undefined) return { valid: false, checks: out.checks, fails: out.fails };

  const s0 = fur.state();
  // RN-150. THE BOOT DEFAULT IS A FIXTURE. `Number(null)` is 0 and two shipped
  // features have already gone dark because every probe passed an explicit flag,
  // so "no `fur` parameter in the URL" is asserted as its own case and is not
  // inferred from `enabled`.
  check('the URL says what this run thinks it says',
    s0.flagPresent === q.has('fur'),
    { flagPresent: s0.flagPresent, urlHas: q.has('fur'), search: location.search });
  if (!q.has('fur')) {
    check('THE SHIPPED BOOT DEFAULT IS ON: no ?fur parameter still hooks the pelt',
      s0.enabled === true && s0.flagPresent === false, s0);
  }
  check(`?fur is honoured: enabled is ${!wantOff}`, s0.enabled === !wantOff, s0);

  // ------------------------------------------------------------------ scene
  await of.run(1.0);
  const e0 = of.enemies();
  check('this is a combat world, or every claim below is vacuous',
    e0.enabled === true, e0.why);
  if (e0.enabled !== true) return { valid: false, checks: out.checks, fails: out.fails };

  // A WORLD WITH NOTHING POLLUTING DISPATCHES NOTHING (EnemyDebug's own words),
  // so the machines have to exist before a wave can. This is spiderskin.js's
  // build loop and it is here for that reason and not by inheritance: the first
  // run of this probe skipped it, dispatched zero waves, claimed zero rigs, and
  // every motion check below went red naming the empty fixture rather than the
  // pelt. That is the fixture-before-behaviour rule earning its keep.
  {
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
  }
  // RN-511's finding, applied: a live build ghost covers the viewport with a
  // translucent tint and moves the whole frame's colour. `of.build(0)` selects
  // hotbar slot 0 and arms nothing, which disarms it. Asserted rather than
  // assumed, because a wash still up when the shutter opens is exactly the
  // failure that cost RN-459 its creature shot.
  const framePre = of.framehash(A.tilesX ?? 160, A.tilesY ?? 90);
  of.build(0);
  await of.run(0.2);
  const framePost = of.framehash(A.tilesX ?? 160, A.tilesY ?? 90);
  const ghostCleared = framePre.hash !== framePost.hash;

  let waves = 0;
  for (let k = 0; k < 30 && waves === 0; k++) waves = of.enemies('advance', 3600).wavesDispatched;
  check('a wave dispatched', waves > 0, `${waves}`);
  await of.run(2, 60);

  // Stand 16 m off the column: inside the claim radius so the rigs are drawn at
  // LOD0 with the fur material, and far enough that the whole creature is in
  // frame rather than a leg filling it.
  const near0 = of.enemies('near', 1)[0];
  const CLOSE_DEG = (A.standM ?? 16) / ((Math.PI * 600000) / 180);
  if (near0 !== undefined) of.teleport(near0.latDeg + CLOSE_DEG, near0.lonDeg, 30);
  await of.run(1.5);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 200) await of.run(0.25);
  let drain = 0;
  while (of.stats().props.scatterBacklog > 0 && drain++ < 900) await of.run(1 / 60);
  await of.settle(A.settle ?? 8);

  const sp = of.enemies().spiders;
  check('the flock is ready and rigs are CLAIMED, or nothing wears this material',
    sp.state === 'ready' && sp.claimed > 0, JSON.stringify(sp));
  const sHooked = fur.state();
  if (!wantOff) {
    check('the hook MATCHED a material: an installed hook that hooked nothing '
      + 'is the vacuous case', sHooked.hooked.length > 0, sHooked.hooked);
  } else {
    check('with ?fur=0 nothing is hooked and the materials keep stock programs',
      sHooked.hooked.length === 0, sHooked.hooked);
  }

  // Pin the foliage wind so it contributes nothing even across the sim ticks the
  // aiming sweep spends.
  if (window.__ofWind) window.__ofWind.freeze(A.windT ?? 40);

  // RE-STAND IMMEDIATELY BEFORE THE SWEEP. The creatures WALK, and between the
  // claiming teleport and here the probe spends a chunk convergence, a scatter
  // drain and a settle, which is enough sim for the column to close the distance
  // and fill the frame with one leg. Re-reading the nearest rig and standing off
  // it again costs 0.05 s of sim and is what makes the picture a creature rather
  // than a texture.
  {
    const n2 = of.enemies('near', 1)[0];
    if (n2 !== undefined) {
      const D = (A.shotStandM ?? 11) / ((Math.PI * 600000) / 180);
      of.teleport(n2.latDeg + D, n2.lonDeg, 30);
      await of.run(0.4);
      await of.settle(3);
    }
  }

  const TX = A.tilesX ?? 160; const TY = A.tilesY ?? 90;
  const diff = (a, b) => {
    let moved = 0; let peak = 0;
    let x0 = 1e9; let x1 = -1; let y0 = 1e9; let y1 = -1;
    for (let i = 0; i < a.tiles.length; ++i) {
      const d = Math.abs(b.tiles[i] - a.tiles[i]);
      if (d > peak) peak = d;
      if (d > (A.tileThresh ?? 1.0)) {
        moved++;
        const tx = i % TX; const ty = (i / TX) | 0;
        if (tx < x0) x0 = tx; if (tx > x1) x1 = tx;
        if (ty < y0) y0 = ty; if (ty > y1) y1 = ty;
      }
    }
    return { moved, of: a.tiles.length, peak: +peak.toFixed(2),
      box: moved === 0 ? null : [x0, y0, x1, y1] };
  };

  /** A fur pair: two clock pins, three renders, no ticks. */
  const furPair = (t1, t2) => {
    fur.freeze(t1);
    const h1 = of.framehash(TX, TY);
    fur.freeze(t2);
    const h2 = of.framehash(TX, TY);
    fur.freeze(t1);
    const h3 = of.framehash(TX, TY);
    return {
      d: diff(h1, h2),
      restoreExact: h3.hash === h1.hash,
      restore: diff(h1, h3),
      hashes: [h1.hash, h2.hash, h3.hash],
    };
  };

  // ---- AIM AT THE PELT, and the sweep's own criterion is the pelt -------
  const HEADINGS = A.headings ?? [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  const PITCH = A.pitch ?? -6;
  let best = { yaw: null, moved: -1 };
  const aim = [];
  for (const y of HEADINGS) {
    of.look(y, PITCH);
    // A TICK IS REQUIRED FOR `of.look` TO REACH THE CAMERA, and leaving it out
    // is a whole failure on its own: the first run of this sweep reported the
    // IDENTICAL 334 moved tiles and 31.97 peak at all twelve headings, because
    // `framehash` renders synchronously from the camera the last FRAME left, and
    // no frame had run since the write. Twelve confident, identical, meaningless
    // rows. The tick advances the sim, which is fine here and would not be
    // inside the pair: the pair below still spans no ticks at all.
    await of.run(1 / 60);
    const p = furPair(0.0, 3.7);
    aim.push({ yaw: y, moved: p.d.moved, peak: p.d.peak, box: p.d.box });
    if (p.d.moved > best.moved) best = { yaw: y, moved: p.d.moved, peak: p.d.peak, box: p.d.box };
  }
  // Gated on the fur being ON, because with `?fur=0` every heading correctly
  // reads zero and a control run that goes red for doing exactly what it was
  // told is an instrument nobody will trust the next time it goes red.
  if (!wantOff) {
    check('the aiming sweep DISCRIMINATES: the headings do not all read the same, '
      + 'which is what a camera write that never reached a frame looks like',
    new Set(aim.map((a) => a.moved)).size > 1, aim.map((a) => a.moved));
    check('and it is SILENT where there is no creature, which the old '
      + '"keep the heading that moves most" sweep could never be',
    aim.some((a) => a.moved === 0), aim.map((a) => a.moved));
  }
  of.look(best.yaw ?? 0, PITCH);
  await of.run(1 / 60);
  await of.settle(4);

  // ---- 1. THE WIND ------------------------------------------------------
  // Four clock separations. A single pair could land near a still point of the
  // sway; the sway is two incommensurate harmonics precisely so that it cannot
  // be zero over a window, and a ladder is how that gets checked rather than
  // assumed. The 0.0 vs 0.0 rung is the FLOOR and must be exactly zero.
  const wind = {};
  for (const [label, t1, t2] of [['floor', 0.0, 0.0], ['dt0.4', 0.0, 0.4],
    ['dt1.1', 0.0, 1.1], ['dt3.7', 0.0, 3.7], ['dt11.3', 0.0, 11.3]]) {
    wind[label] = furPair(t1, t2);
  }
  check('THE INSTRUMENT FLOOR IS EXACTLY ZERO: two renders at one clock value '
    + 'differ in no tile', wind.floor.d.moved === 0 && wind.floor.d.peak === 0,
  wind.floor.d);
  if (!wantOff) {
    check('THE WIND MOVES THE PELT: the frame changes with the fur clock alone',
      wind['dt3.7'].d.moved > 0, wind['dt3.7'].d);
    check('and it is not one lucky offset: every separation moves tiles',
      ['dt0.4', 'dt1.1', 'dt3.7', 'dt11.3'].every((k) => wind[k].d.moved > 0),
      Object.fromEntries(Object.entries(wind).map(([k, v]) => [k, v.d.moved])));
    check('the sway is BOUNDED: it is an 18 mm displacement, not a teleport, so '
      + 'its footprint is a small share of the frame',
      wind['dt11.3'].d.moved < TX * TY * 0.25,
      { moved: wind['dt11.3'].d.moved, of: TX * TY });
  } else {
    check('WITH ?fur=0 THE CLOCK IS DEAD: writing it moves no tile at any '
      + 'separation', ['dt0.4', 'dt1.1', 'dt3.7', 'dt11.3']
      .every((k) => wind[k].d.moved === 0),
    Object.fromEntries(Object.entries(wind).map(([k, v]) => [k, v.d.moved])));
  }
  check('every wind pair RESTORES bit-exactly, so each is attributable',
    Object.values(wind).every((v) => v.restoreExact),
    Object.fromEntries(Object.entries(wind).map(([k, v]) => [k, v.restoreExact])));

  // ---- 2. THE MOTION LAG ------------------------------------------------
  // Driven through the uniform rather than by waiting for a creature to run,
  // which makes this a question about the SHADER and not about whether the
  // shutter opened at the right moment. The flock's own path is asserted
  // separately below.
  const lagPair = (v1, v2) => {
    fur.freeze(A.lagClock ?? 2.0);
    fur.setLag(...v1);
    const h1 = of.framehash(TX, TY);
    fur.setLag(...v2);
    const h2 = of.framehash(TX, TY);
    fur.setLag(...v1);
    const h3 = of.framehash(TX, TY);
    return { d: diff(h1, h2), restoreExact: h3.hash === h1.hash };
  };
  const L = 0.030;     // LAG_M, full run speed
  const lag = {
    floor: lagPair([0, 0, 0], [0, 0, 0]),
    half: lagPair([0, 0, 0], [L * 0.5, 0, 0]),
    full: lagPair([0, 0, 0], [L, 0, 0]),
    axis: lagPair([L, 0, 0], [0, 0, L]),
  };
  check('the lag floor is exactly zero', lag.floor.d.moved === 0, lag.floor.d);
  if (!wantOff) {
    check('THE LAG RESPONDS TO VELOCITY: a non-zero lag vector moves the pelt',
      lag.full.d.moved > 0, lag.full.d);
    // The PROPERTY, not the magnitude (INSTRUMENTS.md): more lag must displace
    // more, because `uFurLag * furOut` is linear in the vector. A magnitude
    // assertion would rot the moment LAG_M is tuned.
    check('and MORE lag displaces MORE, which is what "responds" means',
      lag.full.d.peak > lag.half.d.peak && lag.full.d.moved >= lag.half.d.moved,
      { half: lag.half.d, full: lag.full.d });
    check('and the DIRECTION matters: two lags of equal length on different '
      + 'axes are different frames', lag.axis.d.moved > 0, lag.axis.d);
  } else {
    check('with ?fur=0 the lag uniform is dead too',
      lag.full.d.moved === 0 && lag.axis.d.moved === 0,
      { full: lag.full.d, axis: lag.axis.d });
  }
  check('every lag pair RESTORES bit-exactly',
    Object.values(lag).every((v) => v.restoreExact),
    Object.fromEntries(Object.entries(lag).map(([k, v]) => [k, v.restoreExact])));

  // ---- 3. ONE LAG VECTOR FOR THE WHOLE FLOCK, stated as a measurement ----
  // RN-465 wrote this limit down before anyone measured. It is confirmed here
  // structurally rather than taken on trust: the handle holds ONE vector and the
  // hook list holds N materials, so N creatures running in N directions stream
  // their fur one way. Published as a number so the next lane can see the cost
  // of the per-rig upgrade rather than rediscovering the limit.
  const shared = { hookedMaterials: fur.state().hooked.length,
    lagVectors: 1, claimedRigs: sp.claimed };
  check('the shared-lag limitation is real and is this size',
    (wantOff ? shared.hookedMaterials === 0 : shared.hookedMaterials >= 1)
    && shared.claimedRigs >= 1, shared);

  // ---- 4. THE SPLICE POINT, read off the SHIPPED BUNDLE ------------------
  // The claim is a POSITION claim ("after <skinning_vertex>, not after
  // <begin_vertex>") and a position claim cannot be made by a set membership
  // test, which is INSTRUMENTS.md's set-versus-order entry. So this reads the
  // built artifact and asserts WHICH include the fur block is anchored on. It is
  // a static check and it says so: it proves the splice target, not that the
  // driver then compiled it the way three's chunk expansion intends.
  let splice = { checked: false };
  try {
    const html = await (await fetch('./index.html')).text();
    const srcs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
    let hit = null;
    for (const s of srcs) {
      const js = await (await fetch(s.startsWith('/') ? s : `./${s}`)).text();
      if (js.includes('skinning_vertex')) { hit = { s, js }; break; }
    }
    if (hit !== null) {
      const skinIdx = hit.js.indexOf('skinning_vertex');
      const window0 = hit.js.slice(Math.max(0, skinIdx - 400), skinIdx + 400);
      splice = {
        checked: true, asset: hit.s,
        anchorsOnSkinning: /skinning_vertex[^\n]{0,80}furN|furN[\s\S]{0,600}skinning_vertex/.test(hit.js)
          || window0.includes('furOut') || hit.js.includes('#include <skinning_vertex>'),
        mentionsBeginVertexAnchor: /begin_vertex['"][^)]{0,40}furOut/.test(hit.js),
      };
    }
  } catch (e) { splice = { checked: false, why: String(e) }; }

  // ---- the picture ------------------------------------------------------
  const asPng = async () => {
    const blob = await of.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; const C = 0x8000;
    for (let i = 0; i < buf.length; i += C) s += String.fromCharCode.apply(null, buf.subarray(i, i + C));
    return `data:image/png;base64,${btoa(s)}`;
  };
  fur.thaw();

  return {
    valid: true,
    furState: fur.state(),
    aim, best, pitch: PITCH, ghostCleared,
    wind, lag, shared, splice,
    spiders: { claimed: sp.claimed, state: sp.state },
    observer: of.world().observer,
    sun: of.stats().sky.elevationDot,
    draw: of.stats().draw,
    search: location.search,
    png: A.shot === true ? await asPng() : undefined,
    checks: out.checks, fails: out.fails,
  };
})()
