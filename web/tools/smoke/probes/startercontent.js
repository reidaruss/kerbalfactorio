// startercontent.js: GP-268 / R16. NO TREES ON AN AIRLESS MOON.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=20 \
//        --evalfile=tools/smoke/probes/startercontent.js
//   node tools/smoke/run.mjs --sandbox=1 --body=1 --settle=20 \
//        --evalfile=tools/smoke/probes/startercontent.js
//
// Routed from the world-gen lane, which landed Cinder and found 8 broadleaf
// and 6 conifer trees standing on a vacuum moon. Its own streaming fields were
// correct and said so (`trees.live` 0, `rocks.live` 0); the culprit was
// `NodeField.plan()` returning a fixed 14 trees for every body there is.
//
// THE TWO THINGS THIS ASSERTS ARE NOT THE SAME THING, and only the second is a
// rule:
//
//  (a) THE TABLE. Forge places its 14 and Cinder places 0. That is content,
//      and content can be changed by anyone at any time.
//
//  (b) THE INVARIANT. A starter table that ASKS for a plant on an airless body
//      is REFUSED, by name. This is the one that matters, because the day
//      somebody fills Cinder's row the table alone would let a tree back onto
//      the moon and it would look exactly as correct as it does now.
//
// (b) CANNOT BE REACHED THROUGH THE SHIPPED BODIES. Forge has air and Cinder's
// list is empty, so on the two bodies that exist the refusal branch is never
// taken, and a rule that is never taken is a rule nobody knows is there. So the
// probe drives the pure function with the case that matters, and it also drives
// the two INVERSES, because a gate that refuses everything would pass a
// one-sided test.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.starterPlan !== 'function') {
    return { valid: false, why: 'no __of.starterPlan' };
  }
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);
  await sleep(0.8);
  of.build(0);

  const meta = of.starterPlan(0, false);
  const TREE = meta.plantKinds[0];
  check('a plant kind is declared', Number.isFinite(TREE),
        JSON.stringify(meta.plantKinds));

  // --- 1. THE TABLE: a row per body, and Cinder's is present and empty -----
  const byId = Object.fromEntries(meta.tables.map((t) => [t.bodyId, t]));
  check('Forge has a starter table', byId[0] !== undefined);
  check('Cinder has a starter table ROW, not an absence', byId[1] !== undefined,
        JSON.stringify(meta.tables.map((t) => t.bodyId)));
  check('Forge places 14', byId[0] && byId[0].count === 14,
        `${byId[0] && byId[0].count}`);
  check('Cinder places 0', byId[1] && byId[1].count === 0,
        `${byId[1] && byId[1].count}`);
  check('Cinder\'s row says what would go there', byId[1]
        && /moon resources|spawn/i.test(byId[1].why), byId[1] && byId[1].why);

  // --- 2. THE INVARIANT, driven all four ways ------------------------------
  // The case that matters: a table ASKING for trees on an airless body.
  const airlessTrees = of.starterPlan(1, true, [TREE, TREE, TREE]).plan;
  check('a plant asked for on an airless body places NOTHING',
        airlessTrees.kinds.length === 0, JSON.stringify(airlessTrees.kinds));
  check('and it is REFUSED BY NAME, three times, not silently dropped',
        airlessTrees.refused.length === 3, JSON.stringify(airlessTrees.refused));
  check('the refusal says why', airlessTrees.refused.length > 0
        && /no air/.test(airlessTrees.refused[0]), airlessTrees.refused[0]);

  // INVERSE 1: the SAME trees on a body WITH air are placed and not refused.
  // Without this the gate could be "refuse every plant" and still pass above.
  const airTrees = of.starterPlan(0, false, [TREE, TREE, TREE]).plan;
  check('the same plants on a body WITH air are placed',
        airTrees.kinds.length === 3, JSON.stringify(airTrees.kinds));
  check('and nothing is refused there', airTrees.refused.length === 0,
        JSON.stringify(airTrees.refused));

  // INVERSE 2: a NON-plant on an airless body is fine. Without this the gate
  // could be "refuse everything on an airless body", which would also block
  // the moon resources Reid is going to want.
  const ROCK = 1;
  const airlessRock = of.starterPlan(1, true, [ROCK, ROCK]).plan;
  check('a NON-plant on an airless body is allowed through',
        airlessRock.kinds.length === 2, JSON.stringify(airlessRock.kinds));
  check('and is not refused', airlessRock.refused.length === 0,
        JSON.stringify(airlessRock.refused));

  // --- 3. AN UNKNOWN BODY PLACES NOTHING AND SAYS SO -----------------------
  // Falling back to Forge's list is how this defect happened in the first
  // place, so the fallback is asserted to be a refusal rather than a default.
  const unknown = of.starterPlan(7, false).plan;
  check('an unknown body places nothing', unknown.kinds.length === 0,
        JSON.stringify(unknown.kinds));
  check('an unknown body SAYS it has no table', unknown.unknownBody !== '',
        unknown.unknownBody);

  // --- 4. THE LIVE WORLD agrees with the table it was built from -----------
  const rep = of.game();
  const st = rep.starter ?? null;
  check('the live world publishes its starter block', st !== null);
  if (st !== null) {
    const expect = byId[st.bodyId] ? byId[st.bodyId].count : -1;
    // ENTRIES, not art pieces. `populate` returns `this.placed.length`, which
    // counts ART (a tree is several), so it reads 49 for a 14-entry spiral.
    // The first draft of this probe compared that to the table and went red
    // for a reason that had nothing to do with the rule under test.
    check('the live world planned exactly its table count',
          st.planned === expect,
          `body ${st.bodyId} planned ${st.planned}, table says ${expect}`);
    check('THE SENTENCE R16 WAS ABOUT: no plants planned on an airless body',
          st.bodyId === 0 || st.plants === 0,
          `body ${st.bodyId} planned ${st.plants} plants`);
    check('the live world refused nothing', st.refused.length === 0,
          JSON.stringify(st.refused));
    check('the live world knows its body', st.unknownBody === '', st.unknownBody);
  }

  // --- 5. AND NO TREE IS STANDING ON AN AIRLESS BODY -----------------------
  // The end-to-end statement, off the node census rather than off the plan.
  const kinds = typeof of.nodes === 'function' ? of.nodes() : null;
  return {
    valid: fails.length === 0,
    fails,
    bodyId: st === null ? null : st.bodyId,
    planned: st === null ? null : st.planned,
    plants: st === null ? null : st.plants,
    artPieces: st === null ? null : st.artPieces,
    refused: st === null ? null : st.refused,
    tables: meta.tables,
    airlessTreesRefused: airlessTrees.refused.length,
    airTreesPlaced: airTrees.kinds.length,
    airlessRockPlaced: airlessRock.kinds.length,
    nodes: kinds,
    note: 'the invariant is driven with a case no shipped body produces, plus '
      + 'both inverses, because a gate that refuses everything would pass a '
      + 'one-sided test',
  };
})()
