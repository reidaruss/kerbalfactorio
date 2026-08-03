// lifeless.js: GP-287. NOTHING THAT BREATHES GOES ON A BODY WITH NO AIR.
//
//   node tools/smoke/run.mjs --sandbox=1 --combat=1 --settle=25 \
//        --evalfile=tools/smoke/probes/lifeless.js               # Forge
//   node tools/smoke/run.mjs --sandbox=1 --combat=1 --body=cinder --settle=25 \
//        --evalfile=tools/smoke/probes/lifeless.js               # Cinder
//
// The rule started as "a starter table may not put a plant in vacuum" and is
// now the same rule about creatures, which is not an analogy: a nest of
// Skitterers on an airless moon is a plant in vacuum with a different noun.
//
// WHAT WAS ACTUALLY WRONG WAS THAT NOBODY HAD ASKED. `seedNests` walked its
// ring with no body test of ANY kind, so Cinder had four nests for exactly the
// reason Forge does. Measured before the fix: 4 on Forge, 4 on Cinder.
//
// THE CLAIM IS TWO-SIDED AND THE PROBE IS RUN ON BOTH BODIES, which is the only
// shape that can distinguish the rule from either constant:
//
//   Forge   nests are seeded, and the refusal is EMPTY;
//   Cinder  nests are 0, the refusal is a SENTENCE naming vacuum, and the
//           plant half of the same invariant refuses too.
//
// A build that always seeded passes the Forge half alone. A build that never
// seeded passes the Cinder half alone. A build that seeded and said nothing
// passes neither, because the refusal is asserted as TEXT and not as a count:
// "no nests" and "no nests, and here is why" are different states, and the
// second is the one that can be fixed by whoever reads it.
//
// COMBAT IS ON, WHICH IS THE ANTECEDENT. DW-31 makes sandbox safe by default,
// so without `?combat=1` the loop never comes up, `nests` is 0 on BOTH bodies,
// and every assertion below would pass on Cinder for a reason that has nothing
// to do with the atmosphere. That is checked first and by name.
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

  await sleep(1.5);
  const g = of.goals();
  const e = of.enemies ? of.enemies() : null;
  if (e === null || e === undefined) {
    return { valid: false, why: 'no __of.enemies()', fails };
  }

  // THE ANTECEDENT, FIRST. Without combat the loop never runs and "0 nests"
  // means nothing about the air.
  check('combat is ON, so a nest COULD have been seeded here',
        e.enabled === true,
        `enabled ${e.enabled}, why "${e.why}". Without ?combat=1 the loop `
        + 'never comes up and 0 nests is DW-31, not vacuum.');
  if (e.enabled !== true) {
    return { valid: false, why: `combat off: ${e.why}`, fails, enemies: e };
  }

  const airless = g.airless;
  check('the client publishes whether this body has air',
        typeof airless === 'boolean', `airless is ${typeof airless}`);
  log.push(`body ${g.bodyId}, airless ${airless}, nests ${e.nests}, `
    + `seeded ${e.nestsSeeded}`);

  if (airless) {
    // ---- CINDER: lifeless, and it SAYS SO ---------------------------------
    check('an airless body seeds NO nests', e.nestsSeeded === 0,
          `nestsSeeded ${e.nestsSeeded}`);
    check('and holds none', e.nests === 0, `nests ${e.nests}`);
    // THE REFUSAL IS TEXT, NOT A COUNT. A world that seeded nothing and said
    // nothing is indistinguishable from one whose ring happened to be empty.
    check('and it says WHY, in the invariant\'s own words',
          typeof e.lifeRefusedWhy === 'string'
          && /no air|vacuum/i.test(e.lifeRefusedWhy),
          `lifeRefusedWhy "${e.lifeRefusedWhy}"`);
    check('and the sentence names it as a DECISION rather than a limitation',
          /decision/i.test(e.lifeRefusedWhy ?? ''),
          `"${e.lifeRefusedWhy}". Reid can overrule this and the sentence has `
          + 'to say so, or the next reader takes it for a constraint.');
    // THE OTHER HALF OF THE SAME INVARIANT. Plants and fauna share one rule, so
    // a build where only one of them refused would be two rules wearing one
    // name.
    check('the PLANT half of the same invariant also refuses here',
          g.woodPlaceable === false, `woodPlaceable ${g.woodPlaceable}`);
    // AND NOTHING IS ALIVE. A nest count of zero with creatures walking about
    // would mean the refusal came too late to matter.
    await sleep(2.0);
    const e2 = of.enemies();
    // `live` is the swarm's own field name; reading `alive` would be
    // `undefined === 0`, which is false, so it would have failed loudly rather
    // than passed vacuously. Named correctly anyway: an assertion that fails
    // for the wrong reason is worth no more than one that passes for one.
    check('no creatures are alive on it', mustNum(e2.swarm, 'live',
          'enemies.swarm') === 0, `live ${e2.swarm?.live}`);
    check('and none were ever dispatched', e2.wavesDispatched === 0,
          `waves ${e2.wavesDispatched}`);
  } else {
    // ---- FORGE: alive, and the refusal is silent --------------------------
    check('a body with air DOES seed nests', e.nestsSeeded > 0,
          `nestsSeeded ${e.nestsSeeded}`);
    check('and holds them', e.nests > 0, `nests ${e.nests}`);
    check('and the refusal is EMPTY, not a sentence about a world with air',
          e.lifeRefusedWhy === '', `lifeRefusedWhy "${e.lifeRefusedWhy}"`);
    check('the plant half also permits here', g.woodPlaceable === true,
          `woodPlaceable ${g.woodPlaceable}`);
  }

  return {
    valid: fails.length === 0,
    fails,
    log,
    body: g.bodyId,
    airless,
    nests: e.nests,
    nestsSeeded: e.nestsSeeded,
    lifeRefusedWhy: e.lifeRefusedWhy,
    woodPlaceable: g.woodPlaceable,
    combatEnabled: e.enabled,
    note: 'run on BOTH bodies with combat on: a build that always seeds passes '
      + 'Forge alone, one that never seeds passes Cinder alone, and one that '
      + 'refuses silently passes neither, because the refusal is asserted as '
      + 'text rather than as a count',
  };
})()
