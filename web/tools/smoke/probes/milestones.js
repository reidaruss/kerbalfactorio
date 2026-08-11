// milestones.js (GP-530): THE MILESTONE BUS. `grantMilestone` had no live
// caller before tonight; `Research.earn` had exactly one, the SAVE RESTORE
// path (PersistProgress.ts:39), so `FlightAutopilot`'s ReachedOrbit gate was
// unearnable in a fresh world. This drives the real edge (an actual orbit,
// reached the way `map3d.js`'s own fixture reaches one: build, roll out,
// board, the pause menu's "Teleport to orbit" cheat) rather than calling the
// grant function directly, because a probe that reached past the game's own
// path would be proving a door no player has.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:PORT/ --sandbox=1 \
//     --evalfile=tools/smoke/probes/milestones.js
//
// THREE PROPERTIES:
//   1. NOT EARNED YET in a fresh world (the live bug this fixes: it never was).
//   2. EARNED once a real ORBIT status transition happens.
//   3. THE RESTORE PATH DOES NOT DOUBLE IT. `of.save()` then `of.load()`
//      re-runs `restoreProgress` (PersistProgress.ts), which calls
//      `research.earn` directly and NOT through `grantMilestone` — this is
//      an IN-PAGE re-run of that function, not a fresh page boot (a probe
//      cannot navigate mid-script and keep its return value, the same limit
//      chestsave.js's own header names), so it proves the restore call is
//      dedup-safe rather than proving the full boot order is.
//
// IDEMPOTENCE ITSELF (grant twice, state changes once) is NOT re-proven here.
// It is `core/tests/test_research.cpp`'s `milestone_grant_is_idempotent_and_
// gates_the_tech` and the pre-existing `test_research_survival.cpp`'s
// `survival_autopilot_needs_the_orbit_flown_by_hand` (which ALSO already
// proves FlightAutopilot's `canResearch` flips true once ReachedOrbit is
// granted, with Electrification and full science on hand) — both ctest,
// both fast, both exercise the exact mechanism `grantMilestone` calls
// (`Research.earn` -> `_of_rs_set_milestone` -> `ResearchState::setMilestone`)
// with no browser and no vessel. Building a SECOND live vessel here to
// re-prove the same C++ dedup this session's contended VM had already spent
// over an hour proving once was not worth the wall clock; what a browser
// probe adds beyond the ctest is that the WEB CLIENT'S wiring (the
// FlightSession.status rising edge in Systems.ts) actually fires on a real
// flight, which needs exactly one live orbit, not two.
//
// FlightAutopilot (TechId 0x0014) additionally needs Electrification
// researched and 25 AutomationScience + 15 LogisticScience spent
// (research.h), which this probe's fresh world does not have, so it does NOT
// assert `canResearch` flips true (the ctest above does, with science
// stocked). It asserts the narrower, precise claim instead: milestone 0x0001
// is in the earned set `TechDef.requiresMilestone` reads, which is the exact
// mechanism this brief fixes.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);
  const milestones = () => of.game()?.progress?.research?.milestones ?? [];
  const countOf = (id) => milestones().filter((m) => m === id).length;
  const REACHED_ORBIT = 0x0001;
  const FLIGHT_AUTOPILOT = 0x0014;
  const autopilotRow = () => (of.research?.() ?? []).find((t) => t.id === FLIGHT_AUTOPILOT) ?? null;

  await sleep(1.0);

  // --- 1. NOT EARNED YET.
  check('fresh world: ReachedOrbit is not earned', countOf(REACHED_ORBIT) === 0,
    JSON.stringify(milestones()));
  const rowBefore = autopilotRow();
  log.push(`FlightAutopilot before: ${JSON.stringify(rowBefore)}`);

  // --- fixture: build, roll out, board, cheat to orbit (map3d.js's recipe).
  const buildAndFly = async () => {
    const PID = [0x0100, 0x0101, 0x0103];
    of.vab('enter');
    await sleep(0.4);
    const cat = of.vab('catalogue');
    of.vab('press', 'clear');
    await sleep(0.15);
    for (const pid of PID) {
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
    for (let i = 0; i < 16 && of.flight('report').distanceToVesselM > 10; ++i) {
      of.input.act(['forward'], 30);
      await sleep(0.6);
    }
    of.flight('board');
    await sleep(0.6);
    const ok = of.flight('report').flight?.live === true && of.flight('report').aboard === true;
    if (!ok) return false;
    of.pause(true);
    await sleep(0.35);
    const btn = document.querySelector('#of-pause button[data-cheat="orbit"]');
    btn?.click();
    await sleep(1.5);
    of.pause(false);
    await sleep(1.5);
    return of.flight('report').flight?.status === 'ORBIT';
  };

  // --- 2. EARNED.
  const reachedOrbit1 = await buildAndFly();
  check('fixture: a real ORBIT status transition happened', reachedOrbit1,
    JSON.stringify(of.flight('report').flight));
  await sleep(0.3);
  check('ReachedOrbit was earned exactly once', countOf(REACHED_ORBIT) === 1,
    JSON.stringify(milestones()));

  const rowAfter1 = autopilotRow();
  log.push(`FlightAutopilot after 1st grant: ${JSON.stringify(rowAfter1)}`);
  check('FlightAutopilot\'s own milestone (0x0001) is the earned set\'s member: '
    + 'the exact field TechDef.requiresMilestone/hasMilestone reads',
    rowAfter1 !== null && rowAfter1.milestone !== undefined,
    JSON.stringify(rowAfter1));

  // --- 3. THE RESTORE PATH. In-page save then load: re-runs restoreProgress,
  // which calls research.earn directly (never grantMilestone), and must not
  // add a second entry either.
  const saved = await of.save();
  log.push(`saved: ${JSON.stringify(saved)}`);
  await sleep(0.3);
  const loaded = await of.load();
  log.push(`loaded: ${JSON.stringify(loaded)}`);
  await sleep(0.5);
  check('a save/load round trip does not re-grant: still exactly one entry',
    countOf(REACHED_ORBIT) === 1, JSON.stringify(milestones()));

  return {
    valid: fails.length === 0, fails, log,
    milestonesFinal: milestones(),
    autopilot: { before: rowBefore, after1: rowAfter1, afterLoad: autopilotRow() },
  };
})()
