// goalmoot.js: GP-286. THE CHECKLIST DOES NOT SET A TASK THE WORLD REFUSED.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/goalmoot.js            # Forge
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 --body=cinder \
//        --evalfile=tools/smoke/probes/goalmoot.js            # Cinder
//
// `Harvest a tree` has been the first line a player reads on Cinder, which is
// airless and on which `StarterContent`'s own invariant REFUSES to place a
// tree. So the card was impossible, the checklist parked on it, and every row
// behind it was unreachable for ever. GP-165's defect one level up: not a
// wrong KEY for a real task, a wrong TASK.
//
// THE CLAIM IS TWO-SIDED AND THE PROBE IS RUN TWICE, which is the only shape
// that means anything here. A build that marked EVERY card moot would pass a
// Cinder-only run; a build that marked NONE would pass a Forge-only one. The
// same probe file, the same assertions, driven on both bodies, can be satisfied
// only by a rule that actually reads the world:
//
//   on Forge   the wood card is LIVE, has a hint, and is not moot;
//   on Cinder  it is MOOT, its reason is drawn where the hint would be, the
//              list has stepped PAST it rather than parking, and it is not
//              counted as something the player did.
//
// WHICH BODY IT IS RUNNING ON IS READ FROM THE WORLD, never from the flag the
// runner was given. A probe that trusted its own argument would report on the
// world it MEANT to boot, and this project has measured a stale server serving
// the wrong build often enough to know the difference matters.
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

  await sleep(1.2);
  const g = of.goals ? of.goals() : null;
  if (g === null || g === undefined) {
    return { valid: false, why: 'no __of.goals()', fails };
  }
  const rows = g.rows;
  check('the checklist publishes rows', Array.isArray(rows) && rows.length > 0,
        `rows is ${JSON.stringify(rows)?.slice(0, 80)}`);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { valid: false, why: 'no objective rows', fails, g };
  }

  // WHICH WORLD, off the world. `airless` is the client's own published answer
  // and is the same predicate the tree placement and the card share.
  const w = of.world();
  const airless = g.airless;
  check('the client publishes whether this body has air',
        typeof airless === 'boolean', `airless is ${typeof airless}`);
  log.push(`body ${g.bodyId}, airless ${airless}, seed ${w.seed}`);

  const wood = rows.find((r) => /Harvest a tree/.test(r.text));
  check('the wood card is in the list on BOTH bodies', wood !== undefined,
        `texts [${rows.map((r) => r.text).join(' | ')}]`);
  if (wood === undefined) return { valid: false, why: 'no wood card', fails, g };

  if (airless) {
    // ---- CINDER ----------------------------------------------------------
    check('on an airless body the wood card is MOOT', wood.moot === true,
          `moot ${wood.moot}`);
    check('and it says WHY, where the hint would be',
          typeof wood.hint === 'string' && /no air|nothing grows/i.test(wood.hint),
          `hint "${wood.hint}"`);
    // THE CARD IS NOT CREDITED. A tick would tell the player they harvested a
    // tree on a world with no trees, which is worse than the bug it replaced.
    check('and it is NOT drawn as done', wood.done !== true, `done ${wood.done}`);
    check('the list counts it as skipped by the WORLD, not by the player',
          g.mootCount >= 1, `mootCount ${g.mootCount}`);
    // THE LIST MOVED ON, which is the whole repair: before this the checklist
    // parked on an impossible row and hid every row behind it.
    check('the checklist did not park on it',
          g.doneCount >= 1 || rows.some((r) => r.current && !r.moot),
          `doneCount ${g.doneCount}, current `
          + `"${rows.find((r) => r.current)?.text ?? '(none)'}"`);
    const cur = rows.find((r) => r.current);
    check('the row the player is pointed at is one this world can satisfy',
          cur === undefined || cur.moot !== true,
          `current "${cur?.text}" moot ${cur?.moot}`);
    // AND THE WORLD AGREES WITH THE CARD. The card's reason is only honest if
    // there really is no wood to be had.
    check('there is genuinely no wood on this body', g.woodPlaceable === false,
          `woodPlaceable ${g.woodPlaceable}`);
  } else {
    // ---- FORGE -----------------------------------------------------------
    check('on a body with air the wood card is LIVE', wood.moot !== true,
          `moot ${wood.moot}`);
    check('and it carries a real hint rather than a reason',
          typeof wood.hint === 'string' && wood.hint.length > 0
          && !/no air|nothing grows/i.test(wood.hint),
          `hint "${wood.hint}"`);
    check('nothing on Forge is moot', g.mootCount === 0,
          `mootCount ${g.mootCount}`);
    check('and the wood card is where the player is pointed',
          wood.current === true || wood.done === true,
          `current ${wood.current} done ${wood.done}`);
    check('there IS wood to be had here', g.woodPlaceable === true,
          `woodPlaceable ${g.woodPlaceable}`);
  }

  return {
    valid: fails.length === 0,
    fails,
    log,
    body: g.bodyId,
    airless,
    mootCount: g.mootCount,
    doneCount: g.doneCount,
    woodPlaceable: g.woodPlaceable,
    woodRow: wood,
    currentRow: rows.find((r) => r.current) ?? null,
    rows: rows.map((r) => ({ text: r.text, moot: r.moot === true,
                             done: r.done, current: r.current })),
    note: 'run on BOTH bodies: a build that marked every card moot passes the '
      + 'Cinder half alone and a build that marked none passes the Forge half '
      + 'alone, so only a rule that reads the world passes both',
  };
})()
