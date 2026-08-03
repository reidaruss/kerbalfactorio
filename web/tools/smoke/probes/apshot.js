// apshot.js: GP-282. THE AUTOPILOT PANEL, MID-BURN, FOR A HUMAN TO LOOK AT.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/apshot.js \
//        --out=docs/screenshots/GP_autopilot_burn.png
//
// `apexec.js` asserts. This one COMPOSES: it arms a hold-orbit and stops the
// probe while the engine is lit, so the frame `run.mjs` captures is the feature
// rather than whatever state a long assertion run happened to end in. Kept
// separate rather than folded in, because a probe that also has to end
// photogenically starts choosing its last action for the camera, and DW-7 says
// the picture and the numbers are different instruments.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const FM = () => of.flight('report');
  const F = () => of.flight('report').flight;
  const P = () => of.map('report').planner;
  await sleep(0.8);
  of.build(0);
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of [0x0100, 0x0101, 0x0103]) {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) continue;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.12);
  }
  of.vab('leave');
  await sleep(0.4);
  of.flight('rollout');
  await sleep(0.8);
  for (let i = 0; i < 16 && FM().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.flight('board');
  await sleep(0.6);
  of.pause(true);
  await sleep(0.35);
  document.querySelector('#of-pause button[data-cheat="orbit"]')?.click();
  await sleep(1.5);
  of.pause(false);
  await sleep(1.2);
  of.input.act(['stage'], 4);
  await sleep(0.6);
  of.input.act(['throttleCut'], 4);
  await sleep(0.6);
  const mapCode = (of.input.bindings().map || [])[0];
  window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  await sleep(1.2);
  document.querySelector('#of-map [data-plan="orbit"]')?.click();
  await sleep(0.8);
  for (let k = 0; k < 8; ++k) {
    document.querySelector('#of-map [data-plan-act="alt+"]')?.click();
    await sleep(0.12);
  }
  await sleep(1.0);
  document.querySelector('#of-map [data-plan-act="arm"]')?.click();
  await sleep(0.8);
  // STOP WHILE THE ENGINE IS LIT. The countdown, the burn bar, the throttle and
  // the two cost figures are all only on screen in this phase.
  // A WALL-CLOCK DEADLINE AND NOT A POLL COUNT. `holdOrbit` puts its first
  // burn a full slew allowance in the future and GP-275 pins warp at 1x for
  // that phase, so a 1200-poll budget expired 20 seconds into a 60 second
  // slew and photographed POINTING instead of BURNING.
  const t0 = Date.now();
  while (Date.now() - t0 < 200000) {
    const r = P().run;
    if (r.burningNow && Number(r.burnProgress01) > 0.25) break;
    if (!r.armed) break;
    await sleep(1 / 60);
  }
  const r = P().run;
  // ALSO THE NEGATIVE-CONTROL INSTRUMENT FOR GP-278. `navballThrottle` is the
  // DRAWN gauge; `throttle` is the executor's own command. They must agree
  // while the autopilot burns, and before GP-278 the gauge read the player's
  // untouched mirror instead, i.e. 0 with the engine at full. Reverting that
  // one line and re-running this probe is the whole control.
  const nb = of.flight('navball');
  return {
    valid: r.burningNow === true && nb.throttle > 0.5,
    burningNow: r.burningNow,
    navballThrottle: nb.throttle,
    phaseWord: r.phaseWord,
    progress01: r.burnProgress01,
    throttle: r.throttleNow,
    programDvMS: r.programDvMS,
    quotedAtArmMS: r.quotedAtArmMS,
    orbit: `${F().apoapsisM.toFixed(0)} / ${F().periapsisM.toFixed(0)} m`,
    band: document.querySelector('#of-map .pverdict')?.textContent ?? '',
  };
})()
