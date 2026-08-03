// RN-1001. The ripple pair AT THE POSE REID COMPLAINED ABOUT: standing height,
// walking pitch, ordinary daylight. One page, one uniform apart.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4281/ \
//     --width=1600 --height=900 \
//     --evalfile=tools/smoke/probes/ripplewalk.js \
//     --evalargs='{"lat":-35.6028,"lon":53.30131,"yaws":[300],"pitch":-20,"sunDot":0.64}'
//
// WHY THIS EXISTS ALONGSIDE reliefrot.js. reliefrot.js poses a DIAGNOSTIC: 2 m
// and -62 degrees at a grazing sun, chosen so the instrument can isolate the
// ripple. That pose answers "did the direction change". It does not answer
// Reid's question, which is verbatim "at walking distance the ground carries a
// strong pattern of dark etched lines". A frame taken looking at your own boots
// under a raking sun is a different frame from the one he objected to, and
// handing it over as the evidence answers a question he did not ask.
//
// So the pose here is chosen to CONTAIN THE COMPLAINT and nothing else is
// tuned: eye height 2 m, pitch near level, and a sun at an ordinary daytime
// elevation rather than at the elevation that makes a bump loudest. If the
// artefact does not read at this pose the honest report is that it does not
// read at this pose.
//
// NAMED FAILURE MODES, before measuring.
//
//  1. THE POSE DOES NOT CONTAIN THE CLAIM. A steep pitch covers metres and a
//     level one covers kilometres, and the relief term is faded out past 60 m,
//     so a pose can fail by being too close OR too far. Not asserted by
//     assumption: `frame` publishes the ground distance at the bottom row, the
//     centre row and the row where the relief term has faded to nothing, from
//     the camera's real vertical FOV.
//
//  2. THE LIGHT IS NOT ORDINARY. A grazing sun is the relief's own amplifier;
//     it is what the diagnostic pose uses and it is not what a player walks
//     around in. `?sundot=` cannot be used because it is solved ONCE AT BOOT
//     against the SPAWN (RN-844) and this probe teleports, so it would keep
//     the phase and lose the elevation. `of.setSunElev` solves against the
//     site at the moment of the call and returns its own miss; the miss is
//     published and a large one FAILS rather than being rounded away.
//
//  3. DEAD FETCH READ AS A DEAD TERM. A 1x1 placeholder for the relief map
//     makes a "pair" that is bit-identical by construction and reads as "the
//     term does nothing". reliefState() must report the real map.
//
//  4. THE PAIR IS NOT ANCHORED ON THE SHIPPED DEFAULT. A fixture that must
//     differ from the default never tests the default, and the default is what
//     a player meets first. The AFTER half is the boot state with NO
//     reliefswing in the URL, asserted through reliefSwingDefault(): `present`
//     false and `value` equal to the shipped constant.
//
//  5. RUN-TO-RUN NOISE READ AS THE TERM. This harness is not reliably
//     deterministic between runs. Inside one page it should be, and that is a
//     claim rather than an assumption: the AFTER state is captured TWICE, on
//     either side of the BEFORE capture, so the repeat of one state is the
//     floor the pair is measured against.
//
//  6. PROPS AS A DIRECTIONAL FEATURE. A grass card lying across sand is a
//     dark line on the ground, which is the exact thing being judged. The
//     attribution pair is taken with props off. A props-ON pair is available
//     through `props:true` and freezes the wind clock first, so its two halves
//     cannot differ by weather.
//
//  7. THE BUILD GHOST (RN-512). The armed build ghost is geometry in front of
//     the camera that washes the whole frame and is the same size at noon as
//     at dusk. `of.build(0)` disarms it. Not optional and not conditional.
(async (A) => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  if (!of) throw new Error('ripplewalk: no window.__of');
  if (!art || typeof art.setReliefSwing !== 'function') {
    throw new Error('ripplewalk: __ofTerrainArt.setReliefSwing is missing; RN-1000 is not in this build');
  }

  // Hide every DOM sibling of the canvas, the reliefrot.js walk.
  const cv = document.querySelector('canvas');
  const walk = (el) => {
    for (const c of el.children) {
      if (c === cv) continue;
      if (c.contains(cv)) { walk(c); continue; }
      c.style.display = 'none';
    }
  };
  walk(document.body);

  const lat = A.lat;
  const lon = A.lon;
  const alt = A.alt ?? 2.0;
  const pitch = A.pitch ?? -20;
  const yaws = A.yaws ?? [300];
  const sunDot = A.sunDot ?? 0.64;
  const swingOff = A.swingOff ?? 0;
  const wantProps = A.props === true;
  const repeat = A.repeat !== false;
  const settleN = A.settle ?? 20;
  const FADE_END_M = 60; // TerrainShader's relief fade is over 30..60 m.

  of.teleport(lat, lon, alt);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);

  // Failure mode 7, before anything is looked at.
  if (typeof of.build === 'function') of.build(0);
  // Failure mode 6.
  if (typeof of.propsVisible === 'function') of.propsVisible(!wantProps ? false : true);
  if (wantProps && window.__ofWind && typeof window.__ofWind.freeze === 'function') {
    window.__ofWind.freeze(A.windT ?? 12.0);
  }

  // Wait for a player before asking for a pitch: of.look writes the player's
  // view and there is nothing to write to before one exists.
  let aim = null;
  for (let i = 0; i < 120; i++) {
    aim = of.aim?.();
    if (aim && typeof aim.pitchDeg === 'number') break;
    await of.run(0.1);
  }
  if (aim === null) throw new Error('ripplewalk: no player after 12 s; of.look would write nothing');

  // Failure mode 3.
  const tex = art.reliefState();
  if (tex.w < 2) {
    throw new Error(`ripplewalk: uGroundRelief is the ${tex.w}x${tex.h} placeholder; of_ground_relief.png never loaded`);
  }
  // Failure mode 4.
  const swingDef = art.reliefSwingDefault();
  if (swingDef.present) {
    throw new Error(`ripplewalk: ?reliefswing= is in ${location.search}; the AFTER half must be the BOOT DEFAULT, not a flag`);
  }
  if (!(swingDef.value > 0) || swingDef.value !== swingDef.shipped) {
    throw new Error(`ripplewalk: boot swing is ${swingDef.value} against a shipped ${swingDef.shipped}; the default is dead or overridden (RN-150)`);
  }
  const swingOn = swingDef.value;
  // The relief amplitude itself must also be its shipped default, or the pair
  // is a comparison of two states of a term that is off.
  const reliefAmp = art.getRelief();
  if (!(reliefAmp > 0)) {
    throw new Error(`ripplewalk: relief amp is ${reliefAmp}; the term under test is off`);
  }

  // Failure mode 2. Set AFTER the last data-dependent wait (RN-13) and solved
  // against THIS site rather than the spawn (RN-844).
  const solve = of.setSunElev(sunDot);
  await of.settle(30);
  if (!(Math.abs(solve.err) <= (A.sunTol ?? 0.02))) {
    throw new Error(`ripplewalk: setSunElev(${sunDot}) missed by ${solve.err}; this site cannot reach that elevation, so the frame is not the light that was asked for`);
  }
  const sky = of.stats().sky;

  // Failure mode 1. The camera's vertical FOV is 60 degrees (CameraRig), so the
  // frame spans pitch +/- 30. Ground range for a depression angle d below the
  // horizon is eye / tan(d). Reported, not assumed.
  const HALF_FOV = 30;
  const groundAt = (depressionDeg) => {
    if (depressionDeg <= 0.05) return null; // above or on the horizon
    return +(alt / Math.tan((depressionDeg * Math.PI) / 180)).toFixed(2);
  };
  const fadeDepression = +((Math.atan(alt / FADE_END_M) * 180) / Math.PI).toFixed(2);
  const frame = {
    eyeHeightM: alt,
    pitchDeg: pitch,
    vFovDeg: HALF_FOV * 2,
    bottomRowM: groundAt(-pitch + HALF_FOV),
    centreRowM: groundAt(-pitch),
    topRowM: groundAt(-pitch - HALF_FOV),
    reliefFadesOutAtM: FADE_END_M,
    // Where the fade-out lands as a fraction up the frame: 0 is the bottom row,
    // 1 the top. Outside 0..1 means the term's whole support is off screen at
    // one end, which is failure mode 1 in its measurable form.
    fadeAtFrameFrac: +(((-pitch + HALF_FOV) - fadeDepression) / (2 * HALF_FOV)).toFixed(3),
  };

  const grab = async () => {
    await of.settle(settleN);
    const blob = await of.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    }
    return `data:image/png;base64,${btoa(s)}`;
  };
  const invariants = () => {
    const st = of.stats();
    return {
      calls: mustNum(st.draw, 'calls', 'stats.draw'),
      triangles: mustNum(st.draw, 'triangles', 'stats.draw'),
      programs: mustNum(st.draw, 'programs', 'stats.draw'),
      textures: mustNum(st.draw, 'textures', 'stats.draw'),
    };
  };

  const shots = {};
  const hashes = {};
  const rows = [];

  // SWEEP MODE. `rungs:[{label,swing,cell,noise}, ...]` captures one frame per
  // rung at each yaw instead of the two-state pair, because "is +/- 30 degrees
  // enough" is not a yes/no and cannot be answered by a control. `swings:[..]`
  // is the one-knob shorthand.
  //
  // THREE KNOBS AND NOT ONE, because they are not independent: the number of
  // directions on screen at once is decided by the swing (how far apart two
  // cells can point) TIMES the reciprocal of cell*noise (how many independent
  // patches fit in the frame). A sweep of the swing alone would report a
  // ceiling that belongs to the correlation length and read it as the swing's.
  //
  // The rung set MUST contain the shipped state, untreated, or the sweep has
  // no anchor and every rung is a comparison against nothing.
  const rungs = Array.isArray(A.rungs) && A.rungs.length > 0
    ? A.rungs
    : (Array.isArray(A.swings) && A.swings.length > 0
      ? A.swings.map((s) => ({ label: `s${s}`, swing: s }))
      : null);
  if (rungs !== null) {
    const cellDef = art.reliefCellDefault();
    if (cellDef.present || cellDef.noisePresent) {
      throw new Error(`ripplewalk: ?reliefcell/?reliefcellnoise is in ${location.search}; a sweep must start from the boot defaults`);
    }
    const cellOn = cellDef.value;
    const noiseOn = cellDef.noiseValue;
    const isShipped = (r) => (r.swing ?? swingOn) === swingOn
      && (r.cell ?? cellOn) === cellOn && (r.noise ?? noiseOn) === noiseOn;
    if (!rungs.some(isShipped)) {
      throw new Error(`ripplewalk: no rung reproduces the shipped state (swing ${swingOn}, cell ${cellOn}, noise ${noiseOn}); there would be nothing to compare against`);
    }
    for (const yaw of yaws) {
      of.look(yaw, pitch);
      await of.run(0.4);
      for (const r of rungs) {
        const s = r.swing ?? swingOn;
        const c = r.cell ?? cellOn;
        const n = r.noise ?? noiseOn;
        art.setReliefSwing(s); art.setReliefCell(c); art.setReliefCellNoise(n);
        if (art.getReliefSwing() !== s || art.getReliefCell() !== c || art.getReliefCellNoise() !== n) {
          throw new Error(`ripplewalk: rung ${r.label} did not take: swing ${art.getReliefSwing()} cell ${art.getReliefCell()} noise ${art.getReliefCellNoise()}`);
        }
        const key = `y${yaw}_${r.label}`;
        if (key in shots) throw new Error(`ripplewalk: duplicate rung label ${r.label}; one frame would overwrite another`);
        shots[key] = await grab();
        hashes[key] = of.framehash().hash;
      }
      art.setReliefSwing(swingOn); art.setReliefCell(cellOn); art.setReliefCellNoise(noiseOn);
    }
    // A sweep every rung of which produced the same frame is a sweep over a
    // dead uniform. The named trap: a metric flat in its own independent
    // variable is not measuring that variable.
    const hs = Object.values(hashes);
    if (new Set(hs).size === 1) {
      throw new Error(`ripplewalk: every rung produced frame hash ${hs[0]}; the sweep reached no pixel`);
    }
    const w = of.world();
    return {
      valid: w.chunks.converged === true, mode: 'sweep',
      site: { lat, lon, biome: w.biome ?? null },
      frame,
      sun: { askDot: sunDot, gotDot: solve.gotDot, err: solve.err,
        elevationDeg: +((Math.asin(Math.max(-1, Math.min(1, solve.gotDot))) * 180) / Math.PI).toFixed(2) },
      rungs,
      shipped: { swing: swingDef.shipped, cell: cellDef.shipped, noise: cellDef.noiseShipped },
      distinctHashes: new Set(hs).size,
      hashes, shots,
    };
  }

  for (const yaw of yaws) {
    of.look(yaw, pitch);
    await of.run(0.4);
    const tag = `y${yaw}`;
    // AFTER first, because it is the shipped state and leaving the page in it
    // between yaws means a mis-ordered loop shows up as a wrong picture rather
    // than as a silently correct one.
    art.setReliefSwing(swingOn);
    shots[`${tag}_after`] = await grab();
    hashes[`${tag}_after`] = of.framehash().hash;
    const invAfter = invariants();

    art.setReliefSwing(swingOff);
    if (art.getReliefSwing() !== swingOff) {
      throw new Error(`ripplewalk: setReliefSwing(${swingOff}) left ${art.getReliefSwing()}; the control did not take`);
    }
    shots[`${tag}_before`] = await grab();
    hashes[`${tag}_before`] = of.framehash().hash;
    const invBefore = invariants();

    art.setReliefSwing(swingOn);
    if (repeat) {
      shots[`${tag}_after2`] = await grab();
      hashes[`${tag}_after2`] = of.framehash().hash;
    }
    rows.push({
      yaw, invAfter, invBefore,
      sameHash: hashes[`${tag}_after`] === hashes[`${tag}_before`],
      repeatHashEqual: repeat ? hashes[`${tag}_after`] === hashes[`${tag}_after2`] : null,
    });
  }

  // A control that cannot go red is not a control. If every yaw produced the
  // same frame with the term on and off, the term reached no pixel and the
  // whole pair is vacuous; say so loudly instead of shipping two identical
  // pictures with confident labels.
  if (rows.every((r) => r.sameHash)) {
    throw new Error('ripplewalk: the frame hash is IDENTICAL with the swing on and off at every yaw; the term reached no pixel and this pair is vacuous');
  }

  const w = of.world();
  return {
    valid: w.chunks.converged === true,
    site: { lat, lon, biome: w.biome ?? null },
    frame,
    sun: {
      askDot: sunDot,
      gotDot: solve.gotDot,
      err: solve.err,
      elevationDeg: +((Math.asin(Math.max(-1, Math.min(1, solve.gotDot))) * 180) / Math.PI).toFixed(2),
      elevationDot: sky ? sky.elevationDot : null,
      t: solve.t,
    },
    swing: { on: swingOn, off: swingOff, shipped: swingDef.shipped, urlPresent: swingDef.present },
    reliefAmp,
    reliefServed: { w: tex.w, h: tex.h },
    props: wantProps,
    rows,
    hashes,
    shots,
  };
})(OF_ARGS)
