// RN-741. THE ETCHED SQUIGGLES: is the artefact gone, and is the RELIEF STILL
// THERE afterwards.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/reliefgrad.js
//
// The second half is the whole point and is named failure mode 1 from
// TerrainArt.glsl. Band-limiting a gradient lowers it wherever the field is
// sharp, so this change makes the term smoother AND weaker at the same time.
// "The squiggles are gone" and "the relief is gone" produce the same happy
// screenshot, and only one of them is the fix. So this probe measures THREE
// states and not two:
//
//   A  grad=1, amp=shipped   the build
//   B  grad=0, amp=shipped   the pre-RN-741 derivation, the artefact
//   C  grad=1, amp=0         no relief at all
//
// The claim needs BOTH  A != B  (the change did something) and  A != C by a
// margin comparable to  B != C  (the relief survived it). A fix that scores
// A == C has deleted the term and would pass any check that only looked at the
// artefact.
//
// THE PAIR IS ON `of.framehash`, WHICH IS SYNCHRONOUS AND ADVANCES NO TICKS.
// `of.screenshot()` resolves from inside the rAF drain and therefore runs the
// sim; RN-731's first draft paid a full measurement for that lesson. This
// toggle is a RUNTIME uniform, so unlike `shadowlodk` it gets a real
// bit-exact settled-frame pair rather than a two-page-load bound.
//
// THE CAMERA IS STEEP AND CLOSE ON PURPOSE. This defect lives within about five
// metres of the eye, where the pixel footprint is smallest and a screen
// derivative is sharpest. A standing pitch of -10 puts most of the frame past
// the term's own 30 to 60 m fade and would measure mostly sky and distance.
//
// THE SUN IS GRAZING, for the reason RELIEF_DEFAULT was calibrated at grazing:
// asymmetric relief is invisible at noon, so noon is the one elevation at which
// this term cannot be judged either way.

(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const out = { checks: [], fails: [], rows: [] };
  const check = (name, ok, detail) => {
    out.checks.push({ name, ok: !!ok, detail });
    if (!ok) out.fails.push(`${name}: ${JSON.stringify(detail)}`);
  };

  const art = window.__ofTerrainArt;
  check('the relief-gradient handle is published', !!art
    && typeof art.setReliefGrad === 'function'
    && typeof art.reliefGradDefault === 'function',
  { has: !!art, set: art && typeof art.setReliefGrad });
  if (!art || typeof art.setReliefGrad !== 'function') return out;

  const def = art.reliefGradDefault();
  check('the SHIPPED BOOT DEFAULT is the band-limited gradient (RN-150)',
    def.present === false && def.value === 1, def);

  const relAmp = art.getRelief();
  check('the relief amplitude is live, so this measures a term that draws',
    relAmp > 0, { amp: relAmp });

  // ------------------------------------------------------------------ scene
  const site = A.site ?? { name: 'hills', lat: -31.165, lon: -86.27401, yaw: 300, pitch: -38 };
  of.teleport(site.lat, site.lon, site.alt ?? 2.0);
  of.look(site.yaw, site.pitch);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.25);
  let drain = 0;
  while (of.stats().props.scatterBacklog > 0 && drain++ < 900) await of.run(1 / 60);
  await of.run(1.0, 60);
  if (window.__ofWind) window.__ofWind.freeze(A.windT ?? 40);

  // Grazing sun on the rising side.
  const want = A.sunDot ?? 0.16;
  const samples = A.sunSamples ?? 480;
  let bestT = 0; let err = 9; let prevE = -2;
  for (let i = 0; i < samples; ++i) {
    const t = i / samples;
    of.setTime(t);
    const e = of.stats().sky.elevationDot;
    if (e > prevE) { const d = Math.abs(e - want); if (d < err) { err = d; bestT = t; } }
    prevE = e;
  }
  of.setTime(bestT);
  await of.settle(A.settle ?? 14);

  const TX = A.tilesX ?? 160; const TY = A.tilesY ?? 90;
  const tileDiff = (a, b) => {
    let moved = 0; let peak = 0; let sum = 0;
    for (let i = 0; i < a.tiles.length; ++i) {
      const d = b.tiles[i] - a.tiles[i];
      if (Math.abs(d) > peak) peak = Math.abs(d);
      if (Math.abs(d) > 0.5) moved++;
      sum += Math.abs(d);
    }
    return { moved, total: a.tiles.length, peak: +peak.toFixed(2),
      meanAbs: +(sum / a.tiles.length).toFixed(3) };
  };

  // --------------------------------------------------- the three states
  // No screenshot may appear between these, or the restore stops being a
  // control and every number below is unattributed.
  art.setReliefGrad(1); art.setRelief(relAmp);
  const hA = of.framehash(TX, TY);
  art.setReliefGrad(0); art.setRelief(relAmp);
  const hB = of.framehash(TX, TY);
  art.setReliefGrad(1); art.setRelief(0);
  const hC = of.framehash(TX, TY);
  art.setReliefGrad(1); art.setRelief(relAmp);
  const hBack = of.framehash(TX, TY);

  const AB = tileDiff(hA, hB);   // what the derivation change did
  const AC = tileDiff(hA, hC);   // how much relief the FIX still draws
  const BC = tileDiff(hB, hC);   // how much relief the OLD path drew
  const restore = tileDiff(hA, hBack);

  out.rows.push({ site: site.name, sunDot: +of.stats().sky.elevationDot.toFixed(4),
    pitch: site.pitch, AB, AC, BC, restore });

  check('the restore is bit-exact on framehash', restore.peak === 0, restore);
  check('the derivation change is not a no-op', AB.moved > 0, AB);

  // NAMED FAILURE MODE 1, and it is the check that matters. If the fix had gone
  // limp, AC would collapse toward zero while BC stayed large.
  const survived = AC.meanAbs / (BC.meanAbs || 1e-9);
  check('THE RELIEF SURVIVED: the fix still draws a comparable amount of it',
    survived > 0.5, { fixVsNoRelief: AC.meanAbs, oldVsNoRelief: BC.meanAbs,
      ratio: +survived.toFixed(3), bar: 0.5 });

  out.survivedRatio = +survived.toFixed(3);
  art.setReliefGrad(1); art.setRelief(relAmp);
  return out;
})()
