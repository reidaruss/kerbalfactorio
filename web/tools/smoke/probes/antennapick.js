// antennapick.js: THE DISH IS SELECTABLE NOW (GP-805).
//
//   npm --prefix web run build
//   npx --prefix web vite preview --outDir dist --host --port 4331 --strictPort
//   node web/tools/smoke/run.mjs --url=http://<lan>:4331/ --scenario=walk \
//     --sandbox=1 --width=640 --height=360 \
//     --evalfile=web/tools/smoke/probes/antennapick.js
//
// THE BACKLOG ITEM: "the antenna dish is unselectable to the pick"
// (ADMIN.md, ASSET-SPECS.md §4.27, `Antennas.ts`'s own header). DIAGNOSED
// FIRST, WITH THE ANSWER ALREADY WRITTEN DOWN BY THE ASSET LANE THAT FOUND
// IT: `col_Plinth`, `col_Mast`, `col_Cabinet` and `col_Anchor1..4` all ship,
// all read solid, and the walker's own `solidBuild` predicate meets the mast
// exactly where it should -- so this was never a missing collider, a pick
// mask or a `col_` naming defect. `Antennas.pick` never consults collision at
// all: it is a hand-rolled sphere test copied verbatim from
// `ResearchStations.pick` (sized for a 2.44 m bench) onto a 6.00 m mast
// without resizing, and 43 per cent of the asset -- everything from z 2.555
// up, which is the whole head and dish -- sat outside it no matter the aim.
// Fixed in `Antennas.ts` by recentring/enlarging the SAME sphere test,
// measured against the shipped LOD0 mesh (5,672 verts) rather than guessed:
// centred 2.7 m up with a 3.0 m radius, the worst vertex is 3.4337 m out
// against a 3.50 m budget. No socket or `col_*` byte moved.
//
// THIS PROBE DRIVES THE REAL CROSSHAIR PATH, NOT `Antennas.pick` DIRECTLY:
// `GameplayAim.pickAim` -> `g.aimedAntenna`, surfaced as `of.game().aimed.
// antenna`, which is the same field a player's own press resolves through
// (`researchstation.js`/`antenna.js`'s own `aimed.station`/`aimed.machine`
// idiom). Aiming is done by CONVERTING a real 3-D target point into the
// yaw/pitch `of.look` takes, through the antenna's own local east/north/up
// basis (`stationwalk.js`'s construction, reused rather than re-derived) --
// not by picking through the API with a synthesised ray, which would prove
// only that the test function agrees with itself.
//
// THE DISCRIMINATING QUANTITY IS THE DISH, SAMPLED, NOT ASSUMED: five points
// spanning the reflector's own vertical band (trunnion 5.0255 to rim 6.00,
// ASSET-SPECS §4.27) must EACH resolve to this antenna's own id, because one
// lucky hit would prove only that a single ray happened to clear the old
// 2.555 m ceiling by a wide margin. The base is re-checked as a NEGATIVE-
// CONTROL SIBLING in the other direction: it worked before this fix (57 per
// cent of the mesh already did) and must still work, or the recentring
// regressed the one part that was never broken. A genuine miss (60 m to the
// side) must read null, or the "pass" above would be free.
//
// SANDBOX, ON PURPOSE: `GameMode.ts`'s `freeBuild` lifts the cost and
// `researchGated` lifts the tech lock, so the antenna goes down with two
// presses and nothing here spends an ingot. The claim under test is the
// PICK, not the economy; `antenna.js` already carries the full survival
// earn-research-build chain end to end and this file does not repeat it.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['buildMenu', 'antennas', 'game', 'look', 'world', 'run', 'input']) {
    if (typeof of[k] !== 'function' && typeof of[k] !== 'object') {
      return { valid: false, why: `no __of.${k}` };
    }
  }
  const sleep = (n, hz = 30) => of.run(n, hz);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const step = (what) => console.log(`[probe] ${what}`);
  const G = () => of.game();
  const tileClick = async (sel) => {
    const t = document.querySelector(sel);
    t?.dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
    await sleep(0.11);
    (document.querySelector(sel) ?? t)?.click();
    await sleep(0.4);
    return t !== null;
  };

  await of.run(1.0);
  check('this run is SANDBOX (freeBuild + researchGated lifted)',
    G().mode.sandbox === true, JSON.stringify(G().mode));

  // ======================================================================
  // 1. PLACE ONE ANTENNA, DIRECTLY AHEAD, LEVEL.
  // ======================================================================
  const yaw0 = of.world().observer.yawDeg;
  of.look(yaw0, 0);
  await sleep(0.1);
  const ANTENNA_ID = 'scanningantenna';
  const a0 = of.antennas();
  check('the world starts with no antenna', a0.count === 0, a0.count);
  of.input.act(['build'], 4);
  await sleep(0.45);
  const sel = `#of-build .of-btile[data-build="${ANTENNA_ID}"]`;
  check('the antenna has a build-menu tile in sandbox (no research needed)',
    document.querySelector(sel) !== null);
  await tileClick(sel);
  check('clicking the tile put an antenna in hand', G().hotbar.kind === 'antenna',
    JSON.stringify(G().hotbar));
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.5);
  const a1 = of.antennas();
  check('THE ANTENNA WENT DOWN', a1.count === 1, JSON.stringify(a1));
  const at = a1.list[0];
  check('and it is solid', at?.solid === true, JSON.stringify(at));
  if (fails.length > 0) return { valid: true, pass: false, fails, log };

  // ======================================================================
  // 2. THE GEOMETRY, READ RATHER THAN TRANSCRIBED. `pos` comes off the live
  //    instance; `up` is re-derived as `normalize(pos)`, which IS what
  //    `Antennas.place` used to orient it (`stand = normalize(pos)`), so
  //    this is the same fact the game itself computed rather than a second
  //    copy of it. East/north follow `stationwalk.js`'s own construction.
  // ======================================================================
  const pos = at.pos;
  const rP = Math.hypot(pos[0], pos[1], pos[2]);
  const up = [pos[0] / rP, pos[1] / rP, pos[2] / rP];
  const east = (() => {
    const e = [up[2], 0, -up[0]];
    const l = Math.hypot(e[0], e[1], e[2]);
    return l < 1e-9 ? [1, 0, 0] : [e[0] / l, e[1] / l, e[2] / l];
  })();
  const north = [
    up[1] * east[2] - up[2] * east[1],
    up[2] * east[0] - up[0] * east[2],
    up[0] * east[1] - up[1] * east[0],
  ];
  const EYE_M = 1.62; // of.world()'s own published eye height (Debug.ts header).
  const feet = () => of.world().player.feet.slice();
  const eyeAt = (f) => [f[0] + up[0] * EYE_M, f[1] + up[1] * EYE_M, f[2] + up[2] * EYE_M];
  /** A point on the antenna's own axis, `h` up from the pivot, `w` sideways. */
  const local = (h, w = 0) => [
    pos[0] + up[0] * h + east[0] * w,
    pos[1] + up[1] * h + east[1] * w,
    pos[2] + up[2] * h + east[2] * w,
  ];
  const aimAt = (target) => {
    const eye = eyeAt(feet());
    const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
    const distM = Math.hypot(dx, dy, dz);
    const dn = [dx / distM, dy / distM, dz / distM];
    const he = dn[0] * east[0] + dn[1] * east[1] + dn[2] * east[2];
    const hn = dn[0] * north[0] + dn[1] * north[1] + dn[2] * north[2];
    const vu = dn[0] * up[0] + dn[1] * up[1] + dn[2] * up[2];
    const yawDeg = (Math.atan2(he, hn) * 180) / Math.PI;
    const pitchDeg = (Math.atan2(vu, Math.hypot(he, hn)) * 180) / Math.PI;
    of.look(yawDeg, pitchDeg);
    return { distM, yawDeg, pitchDeg };
  };

  // ======================================================================
  // 3. THE REGRESSION SIBLING: THE TOWER, WHICH ALREADY WORKED. Low on the
  //    mast (h = 1.0), well inside even the OLD 1.90 m sphere.
  // ======================================================================
  step('aiming at the tower base (must already work; regression check)');
  const towerAim = aimAt(local(1.0));
  await sleep(0.15);
  const towerHit = G().aimed.antenna;
  const P0 = { ...towerAim, aimedAntenna: towerHit };
  log.push({ P0 });
  check('the tower base is still selectable (no regression)', towerHit === at.id,
    JSON.stringify(P0));

  // ======================================================================
  // 4. THE DISH, SAMPLED ACROSS ITS OWN HEIGHT BAND (ASSET-SPECS §4.27:
  //    trunnion 5.0255, rim top 6.00), EACH POINT ASSERTED BY NAME.
  // ======================================================================
  const dishHeights = [5.05, 5.30, 5.60, 5.85, 6.00];
  const dishResults = [];
  for (const h of dishHeights) {
    step(`aiming at the dish, h=${h}`);
    const a = aimAt(local(h));
    await sleep(0.15);
    const hit = G().aimed.antenna;
    dishResults.push({ h, ...a, aimedAntenna: hit });
    check(`the dish resolves to this antenna at h=${h}`, hit === at.id,
      JSON.stringify({ h, ...a, aimedAntenna: hit }));
  }
  log.push({ dishResults });
  check('EVERY sampled dish point resolved, not just one lucky hit',
    dishResults.every((r) => r.aimedAntenna === at.id),
    JSON.stringify(dishResults.map((r) => r.aimedAntenna)));

  // ======================================================================
  // 5. THE NEGATIVE CONTROL: WALK AWAY, THEN AIM. Without this, "the dish
  //    resolves" would be equally true of a pick that hits everything.
  //
  //    TWO EARLIER DRAFTS BOTH FAILED FOR THE SAME REASON, WORTH KEEPING:
  //    the eye is only 2.2 m from the antenna's own base, and `pick`'s near
  //    clip is `t < -ANTENNA_RADIUS_M`, i.e. up to 3.0 m BEHIND the ray
  //    origin still counts. A miss on the TARGET POINT is not a miss on the
  //    RAY (aiming 60 m sideways still grazed the sphere on its way out,
  //    `distM: 59.9`), and neither is a miss on the COMPASS HEADING (looking
  //    180 degrees away still put the antenna's own centre within that same
  //    3.0 m near-clip BEHIND the eye, `aimedAntenna: 1` at `yawDeg: 180`).
  //    The one thing that is unambiguous at any aim is DISTANCE: walk clear
  //    of `reach` entirely and the ray cannot reach the sphere no matter
  //    which way it points.
  // ======================================================================
  step('walking 60 m away, then aiming in an arbitrary direction (must miss)');
  const f0 = feet();
  const farAway = [f0[0] + north[0] * 60, f0[1] + north[1] * 60, f0[2] + north[2] * 60];
  of.standAt(farAway[0], farAway[1], farAway[2]);
  await sleep(0.15);
  of.look(yaw0, 0);
  await sleep(0.15);
  const missHit = G().aimed.antenna;
  const P6 = {
    farAwayM: Math.hypot(
      feet()[0] - pos[0], feet()[1] - pos[1], feet()[2] - pos[2]),
    aimedAntenna: missHit,
  };
  log.push({ P6 });
  check('NEGATIVE CONTROL: 60 m away reads no antenna at all', missHit === null,
    JSON.stringify(P6));

  return {
    valid: true,
    pass: fails.length === 0,
    fails,
    log,
    antenna: at,
    mode: G().mode,
  };
})()
