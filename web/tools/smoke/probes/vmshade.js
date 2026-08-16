// vmshade.js (RN-1990). THE SUN-TO-SHADE WALK: does the held tool lose the sun
// where the world loses it?
//
// This is the evidence a ratio table cannot give. The four canonical shots are
// four still frames, and a term that were only a constant offset would sit at
// the same ratio in all four; what proves pass 4 is READING the world is that
// the model changes when the occlusion at the player's OWN position changes,
// with the pose, the sun and the frame otherwise fixed.
//
// HOW THE SHADE IS FOUND, and this had to be measured rather than assumed.
// Cascade 0's map over a forest site is MOSTLY EMPTY: a 24 x 24 read of the
// map's own colour attachment (`MeshDepthMaterial` fills it with 1 - fragCoordZ)
// came back non-zero on 105 of 576 texels, all of them at z within 0.004 of the
// eye's own plane. So the TERRAIN does not cast into cascade 0 and the trees do:
// "the ground looks dark" and "the player stands in a cast shadow" are different
// facts, and only the second is one this term can see. A straight 12 m walk
// picked at random found ZERO shaded stations, which is exactly the trap this
// probe exists to avoid -- a null that reads like a broken term.
//
// So the probe does not guess. PHASE 1 teleports over a grid and reads, at each
// station, THE SAME TEXEL the arms sample; that costs no screenshot. PHASE 2
// takes the full model/world measurement at the lit and shaded stations phase 1
// found, in the same page load, and reports the two populations. The split is
// made by the shadow map itself, never by looking at the picture.
//
// The step is a teleport rather than a held key because a key press walks a
// variable distance per frame and this probe needs the SAME stations on every
// run; the walker's own ground clamp still runs, so each station is a real
// standing pose and not a point in the air.
(async () => {
  const of = window.__of;
  const VL = window.__ofVmLight ?? null;
  const VM = window.__ofViewModel ?? null;
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  if (VL === null || VM === null) return { valid: false, why: 'no __ofVmLight/__ofViewModel' };
  if (typeof VL.mapAt !== 'function') return { valid: false, why: 'no __ofVmLight.mapAt' };
  const r2 = (x) => (Number.isFinite(x) ? Number(x.toFixed(2)) : null);
  const r5 = (x) => (Number.isFinite(x) ? Number(x.toFixed(5)) : null);

  const lat0 = A.lat ?? -19.85;
  const lon0 = A.lon ?? -72.7853;
  /** ~0.955 m on Forge (R = 600 km, 1 deg = 10472 m). */
  const D = A.d ?? 9.1e-5;
  const N = A.n ?? 9;
  const yaw = A.yaw ?? 300;
  const pitch = A.pitch ?? -20;

  // THE AIM IS DRIVEN TO CONVERGENCE, NOT NUDGED ONCE, and that is a defect
  // this probe hit and had to fix before any number off it meant anything.
  // `of.look` takes a DELTA, `of.teleport` re-derives the tangent frame at the
  // new site, and one correction therefore lands short; the first version of
  // this walk alternated between yaw 300 and yaw ~277 on odd and even stations,
  // which moved the cascade's own centre by 7 m and made the eye's shadow texel
  // flip between two unrelated cells every step. The two populations it then
  // reported were the two YAWS, not sun and shade.
  const place = async (la, lo) => {
    of.teleport(la, lo, 2);
    await of.run(0.6, 12);
    for (let k = 0; k < 6; ++k) {
      const o = of.world().observer;
      let dy = yaw - o.yawDeg;
      while (dy > 180) dy -= 360;
      while (dy < -180) dy += 360;
      const dp = pitch - o.pitchDeg;
      if (Math.abs(dy) < 0.05 && Math.abs(dp) < 0.05) break;
      of.look(dy, dp);
      await of.run(0.05, 1);
    }
    await of.settle(A.settle ?? 8);
    const o = of.world().observer;
    let dy = yaw - o.yawDeg;
    while (dy > 180) dy -= 360;
    while (dy < -180) dy += 360;
    return Math.abs(dy) < 0.5 && Math.abs(pitch - o.pitchDeg) < 0.5;
  };

  await place(lat0, lon0);
  if (A.dot !== undefined) { of.setSunElev(A.dot); await of.settle(20); }
  VL.peek();
  await of.settle(6);

  const grab = async () => {
    const bmp = await createImageBitmap(await of.screenshot());
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    return cx.getImageData(0, 0, bmp.width, bmp.height).data;
  };
  const Y = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  /**
   * ONE MASK, THREE FRAMES, and the mask is why this reads a signal where the
   * first version read noise. Measuring the model twice, each time against its
   * own freshly-taken control, puts the wind clock into BOTH halves of the
   * subtraction: the first draft's lit stations, where the term provably
   * changes nothing, scattered over 12 counts because the canopy moved between
   * grabs and the two arms disagreed about which pixels were model.
   *
   * So the control is taken ONCE, the mask is fixed from it, and the shadow
   * term is then toggled between two frames that are otherwise the same frame.
   * The drop is a per-pixel difference over identical pixels, and the lit
   * stations become the negative control they were always meant to be.
   */
  const station = async () => {
    VM.hide(true); await of.settle(3);
    if (VM.hidden() !== true) return { err: 'the control frame did not take' };
    const c = await grab();
    VM.hide(false); await of.settle(3);
    VL.shadow(false); await of.settle(4);
    const off = await grab();
    VL.shadow(true); await of.settle(4);
    const on = await grab();
    let n = 0; let onS = 0; let offS = 0;
    let wn = 0; let wr = 0; let wg = 0; let wb = 0;
    for (let i = 0; i < c.length; i += 4) {
      if (Math.abs(off[i] - c[i]) > 6 || Math.abs(off[i + 1] - c[i + 1]) > 6
        || Math.abs(off[i + 2] - c[i + 2]) > 6) {
        n++;
        onS += Y(on[i], on[i + 1], on[i + 2]);
        offS += Y(off[i], off[i + 1], off[i + 2]);
      } else { wn++; wr += c[i]; wg += c[i + 1]; wb += c[i + 2]; }
    }
    if (n === 0) return { err: 'the view model covers no pixel of this frame' };
    return { px: n, modelOn: r2(onS / n), modelOff: r2(offS / n),
      world: wn === 0 ? null : r2(Y(wr / wn, wg / wn, wb / wn)) };
  };
  /** Is a caster in the texel the arms sample, and is it nearer the light? */
  const occl = () => {
    const c = VL.state().eyeCoord;
    const cell = VL.mapAt(c[0], c[1]);
    // Reversed depth: a LARGER z is nearer the light, and the colour attachment
    // holds 1 - z, so a caster in front of the arms reads BELOW 1 - eyeZ.
    const z = 1 - cell.oneMinusZ;
    return { uv: [c[0], c[1]], eyeZ: c[2], cellZ: r2(z * 1000) / 1000,
      written: cell.rgba[3] > 0, nearer: cell.rgba[3] > 0 && z > c[2] };
  };

  // PHASE 1. Where is the shade? No screenshots, so this is cheap.
  const scan = [];
  for (let j = 0; j < N; ++j) {
    for (let i = 0; i < N; ++i) {
      const la = lat0 + (j - (N - 1) / 2) * D;
      const lo = lon0 + (i - (N - 1) / 2) * D;
      await place(la, lo);
      scan.push({ i, j, lat: r5(la), lon: r5(lo), ...occl() });
    }
  }
  const shaded = scan.filter((s) => s.nearer === true);
  const litAll = scan.filter((s) => s.written === false);
  if (shaded.length === 0 || litAll.length === 0) {
    return { valid: false, scanned: scan.length, shaded: shaded.length,
      lit: litAll.length, scan,
      why: 'the grid found no matched pair of a shaded and a lit station, so '
        + 'nothing here can be told apart. Move the grid or lower the sun.' };
  }
  // PHASE 2. AT EACH CHOSEN STATION, A MATCHED PAIR ONE VARIABLE APART: the
  // SAME frame with pass 4's shadow term on and off (`__ofVmLight.shadow`).
  // Comparing a shaded station against a lit one would compare two different
  // pieces of forest as well as two occlusion states; comparing a station
  // against ITSELF isolates the term, and the shaded stations must move while
  // the lit ones must not.
  const take = A.take ?? 4;
  const pick = (a) => a.filter((_, k) => k % Math.max(1, Math.ceil(a.length / take)) === 0)
    .slice(0, take);
  const rows = [];
  const L = pick(litAll); const S = pick(shaded);
  for (let k = 0; k < Math.max(L.length, S.length); ++k) {
    for (const [tag, st] of [['lit', L[k]], ['shade', S[k]]]) {
      if (st === undefined) continue;
      const aimed = await place(st.lat, st.lon);
      const o = occl();
      const m = await station();
      if (m.err !== undefined) { VL.shadow(true); return { valid: false, why: m.err }; }
      rows.push({ tag, i: st.i, j: st.j, aimed, ...o, px: m.px,
        modelOn: m.modelOn, modelOff: m.modelOff, world: m.world,
        drop: r2(m.modelOff - m.modelOn),
        dropPct: r2(100 * (m.modelOff - m.modelOn) / m.modelOff),
        ratioOn: m.world ? r2(m.modelOn / m.world) : null,
        ratioOff: m.world ? r2(m.modelOff / m.world) : null });
    }
  }
  VL.shadow(true);
  const mean = (a, k) => (a.length === 0 ? null
    : r2(a.reduce((s, r) => s + r[k], 0) / a.length));
  // SPLIT BY THE LIVE READ, NOT BY THE SCAN'S TAG. Phase 1 and phase 2 visit a
  // station a minute apart and the wind clock has moved the canopy in between,
  // so a cell that held a leaf during the scan may not hold one now. The tag is
  // kept in every row for audit, but the population a claim is made about is
  // the one the map reported AT THE INSTANT THE PAIR WAS TAKEN.
  const lit = rows.filter((r) => r.nearer === false);
  const sh = rows.filter((r) => r.nearer === true);
  return {
    // THE CLAIM: the term takes MORE light off the model where the map says a
    // caster stands over the player than where it says none does. Stated as a
    // difference rather than as "zero on the lit stations", because zero is not
    // what the lit stations owe: the model spans 0.3 to 0.7 m and its pixels
    // sample a spread of texels around the eye's, so a station whose own cell
    // is clear can still have a leaf over the tip of the haft. The measured lit
    // baseline is about 1.3 counts and the shaded stations are 5 to 10.
    valid: mean(sh, 'drop') - mean(lit, 'drop') > 2.5,
    scanned: scan.length, shadedStations: shaded.length, litStations: litAll.length,
    lit: { n: lit.length, drop: mean(lit, 'drop'), on: mean(lit, 'modelOn'),
      off: mean(lit, 'modelOff'), world: mean(lit, 'world'),
      ratioOn: mean(lit, 'ratioOn'), ratioOff: mean(lit, 'ratioOff') },
    shade: { n: sh.length, drop: mean(sh, 'drop'), on: mean(sh, 'modelOn'),
      off: mean(sh, 'modelOff'), world: mean(sh, 'world'),
      ratioOn: mean(sh, 'ratioOn'), ratioOff: mean(sh, 'ratioOff') },
    rows,
  };
})()
