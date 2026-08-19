// qolsandbox.js: GP-600. DOES THE COST-AND-LOCK UI TELL THE TRUTH ABOUT THE
// MODE IT IS RUNNING IN?
//
// GP-554 found the biggest QOL defect in the game by DRIVING it: three
// progression screens contradicting each other in one sandbox session. The
// build menu said "everything is free" and printed a red `Stone 0/40` on the
// same row; the craft column drew red shortfalls beside live Craft buttons;
// the research panel said `0 / 7 unlocked` in a mode where the tree gates
// nothing; and the checklist told the player to research a tech for a pad the
// build menu was already handing over.
//
// WHY THIS PROBE READS THE DOM AND NOT THE MODEL, and it is the whole reason it
// exists. Every one of those four numbers was CORRECT in the model. `have` was
// really 0, `need` was really 40, `unlocked` was really 0. The defect was
// entirely in what the screen CLAIMED those numbers meant. So a probe that
// asserts state cannot see this class at all, and the only instrument that can
// is one that reads the drawn class and the drawn sentence.
//
// TWO-SIDED BY CONSTRUCTION (INSTRUMENTS.md: "a second side removes one class
// of false pass"). Run it with --sandbox=1 and again WITHOUT, and the claims
// are opposite in the two modes:
//
//   node tools/smoke/run.mjs --sandbox=1 --evalfile=tools/smoke/probes/qolsandbox.js --evalargs='{"expect":"sandbox"}'
//   node tools/smoke/run.mjs --scenario=walk --evalfile=tools/smoke/probes/qolsandbox.js --evalargs='{"expect":"survival"}'
//
// BT-190: this probe never carried a real invocation; `extractCmd()`'s old
// first-match rule took the prose line above ("Run it with --sandbox=1 and
// again WITHOUT...") as the command, which held zero real flags (there is
// no `--flag=value` token in that sentence, unlike `playerhealth.js`'s near
// miss), so every prior sweep ran this at the runner's bare defaults, which
// is silently the SURVIVAL half of the pair with no `--evalargs` to match
// (`expect` defaults to `'sandbox'` in the probe's own code, so the two
// used to disagree about which half was under test). The two real
// invocations above match `expect` to the mode actually booted.
//
//   sandbox : NO cost chip anywhere may carry the refusal class `no`.
//   survival: at least one chip MUST carry `no` at spawn, or the probe is
//             asserting nothing. A fresh survival pack cannot afford a launch
//             pad, so `no` is REACHABLE, which is the reachable-refusing-case
//             half of the standard.
//
// The survival side is not decoration. Without it, deleting the `no` class from
// the stylesheet entirely would pass the sandbox side perfectly.
//
// --evalargs={"expect":"sandbox"|"survival"}
(async () => {
  const of = window.__of;
  if (!of) throw new Error('probe: no __of on the page');
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  [${detail}]`}`);
    if (!ok) fails.push(`${name} :: ${detail}`);
  };
  // GP-609, AMENDED BT-270 to BT-274. A FAILED CHECK USED TO THROW, on the
  // theory that a returned `fails: [...]`/`valid:false` exits 0 and run.mjs
  // prints `smoke: PASS` for a human driving it by hand, and only a throw
  // (which rejects page.evaluate) reached the runner's own exit code. That
  // reasoning never accounted for the SWEEP: `probeall.mjs`'s audit of
  // `run.mjs` found its try/catch drops the ENTIRE report on a
  // page.evaluate throw, not just the eval field, so a correctly-diagnosed
  // RED here read as NO_OUTPUT, indistinguishable from a hard crash --
  // qolbuild2.js's "press aimed at the SKY places nothing" finding (BT-260
  // to BT-264) was exactly this shape. `finish()` now RETURNS `{ fails,
  // valid: fails.length === 0, log }` (verdictOf()'s convention 1) instead,
  // which probeall.mjs reads as a real RED with the failing check names
  // intact. The standalone-run honesty is kept the same way qolbuild2.js
  // keeps it: every failure still gets its own `console.error` line, and
  // `run.mjs` fails a standalone run's own exit code on any page
  // console.error independent of what is in the returned report, so `node
  // run.mjs ...` by hand still prints `smoke: FAILURES` and exits non-zero.
  // `bail()` (an early, self-diagnosed abandon: "the probe already KNOWS it
  // has failed") gets the same fix for the same reason: it now records the
  // reason as a failure and returns through `finish()` rather than throwing
  // it away. `run.mjs` itself is addressed separately (BT-270 to BT-274's
  // own decision on its catch block), not silently assumed fixed by this
  // file alone.
  const bail = (why) => {
    fails.push(`ABANDONED :: ${why}`);
    log.push(`FAIL  ABANDONED  [${why}]`);
    return finish(out);
  };
  const finish = (out) => {
    for (const f of fails) console.error(`probe FAIL: ${f}`);
    return { ...out, valid: fails.length === 0, fails, log };
  };
  const txt = (el) => (el === null || el === undefined ? null
    : (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim());
  // A panel that is in the DOM but not laid out reads its own text back
  // perfectly (GP-557's harness lied exactly this way, reporting the pause menu
  // open at spawn off an <h3> that was never drawn). So NOTHING here concludes
  // anything from an element until this says it is on screen.
  const shown = (el) => el !== null && el !== undefined && el.offsetParent !== null;

  const expect = (OF_ARGS && OF_ARGS.expect) || 'sandbox';
  const sandbox = of.sandbox().sandbox;
  const out = { expect, sandbox, fails, log };

  await sleep(0.9);

  // FIXTURE ASSERTED BEFORE ANYTHING IS CONCLUDED FROM IT (INSTRUMENTS.md:
  // "a probe asserts its own fixture before it asserts the behaviour"). Running
  // the sandbox claims against a survival world would fail for the right reason
  // and the wrong cause, and the failure text would send the next reader into
  // the UI instead of into the command line.
  check('the world is in the mode this run was asked for',
        sandbox === (expect === 'sandbox'), `expect=${expect} sandbox=${sandbox}`);
  if (sandbox !== (expect === 'sandbox')) {
    return bail('wrong mode; nothing below this line was measured');
  }

  // ---- 1. THE BUILD MENU -------------------------------------------------
  of.input.act(['build'], 4);
  await sleep(0.7);
  const bm = document.querySelector('#of-build');
  out.buildMenuShown = shown(bm);
  check('the build menu is actually on screen', out.buildMenuShown);

  const tiles = [...(bm ? bm.querySelectorAll('.of-btile') : [])].map((t) => ({
    id: t.getAttribute('data-build'),
    cls: t.className,
    cost: txt(t.querySelector('.cost')),
    lock: txt(t.querySelector('.lock')),
    // Every ingredient chip with the class the SCREEN gave it.
    chips: [...t.querySelectorAll('.ing i')].map((i) => (
      { cls: i.className, text: txt(i) })),
  }));
  out.buildHint = txt(bm && bm.querySelector('.hint'));
  out.tileCount = tiles.length;
  out.buildTiles = tiles;
  const buildChips = tiles.flatMap((t) => t.chips);
  out.buildChipCount = buildChips.length;
  out.buildChipsNo = buildChips.filter((c) => c.cls.includes('no'));
  out.buildChipsFree = buildChips.filter((c) => c.cls.includes('free'));

  // The chip population must be NON-EMPTY or every claim below is vacuous:
  // "no chip is red" is trivially true of a menu that draws no chips at all,
  // and that is exactly the shape INSTRUMENTS.md calls the most expensive green.
  check('the build menu draws cost chips at all',
        out.buildChipCount > 0,
        `${out.buildChipCount} chips over ${out.tileCount} tiles`);

  // ---- 2. THE CRAFT COLUMN ----------------------------------------------
  of.input.act(['build'], 4);          // shut the build menu
  await sleep(0.4);
  of.input.act(['pack'], 4);
  await sleep(0.7);
  const pk = document.querySelector('#of-panel');
  out.packShown = shown(pk);
  check('the pack panel is actually on screen', out.packShown);
  const recipes = [...(pk ? pk.querySelectorAll('.of-recipe') : [])].map((r) => ({
    name: txt(r.querySelector('.nm')),
    cls: r.className,
    // The BUTTON's real disabled state, which is the claim the chips are
    // supposed to agree with.
    craftDisabled: (r.querySelector('button') || {}).disabled === true,
    chips: [...r.querySelectorAll('.ing i')].map((i) => (
      { cls: i.className, text: txt(i) })),
  }));
  out.craftHint = txt(pk && pk.querySelector('.craft .hint'));
  out.recipeCount = recipes.length;
  out.recipes = recipes;
  const craftChips = recipes.flatMap((r) => r.chips);
  out.craftChipCount = craftChips.length;
  out.craftChipsNo = craftChips.filter((c) => c.cls.includes('no'));
  out.craftChipsFree = craftChips.filter((c) => c.cls.includes('free'));
  check('the craft column draws cost chips at all',
        out.craftChipCount > 0,
        `${out.craftChipCount} chips over ${out.recipeCount} recipes`);

  // THE CONTRADICTION, STATED AS ITS OWN CHECK rather than inferred from the
  // two counts above. GP-554's finding in one line: a row whose button is LIVE
  // and whose ingredients are drawn as a REFUSAL. It is asserted in both modes,
  // because in survival it must also be zero (a survival row with a live button
  // has its ingredients, so no chip on it can be short).
  const contradictory = recipes.filter((r) => !r.craftDisabled
    && r.chips.some((c) => c.cls.includes('no')));
  out.contradictoryRows = contradictory.map((r) => r.name);
  check('no craft row draws a shortfall beside a LIVE Craft button',
        contradictory.length === 0,
        `${contradictory.length} of ${out.recipeCount} rows: `
        + `${out.contradictoryRows.join(', ')}`);

  // ---- 3. THE RESEARCH PANEL --------------------------------------------
  of.input.act(['pack'], 4);
  await sleep(0.4);
  of.input.act(['research'], 4);
  await sleep(0.8);
  const rp = document.querySelector('#of-research');
  out.researchShown = shown(rp);
  check('the research panel is actually on screen', out.researchShown);
  const prog = rp && rp.querySelector('.prog');
  out.researchHeader = txt(prog);
  out.researchGatedAttr = prog && prog.getAttribute('data-gated');
  out.researchAvail = txt(rp && rp.querySelector('.sbx'));
  out.researchHint = txt(rp && rp.querySelector('.hint'));
  const cards = [...(rp ? rp.querySelectorAll('.tech') : [])].map((c) => ({
    name: txt(c.querySelector('.nm')),
    state: c.getAttribute('data-state'),
    gives: txt(c.querySelector('.gives')),
    chips: [...c.querySelectorAll('.cost i')].map((i) => (
      { cls: i.className, text: txt(i) })),
  }));
  out.techCount = cards.length;
  out.techs = cards;
  const techChips = cards.flatMap((c) => c.chips);
  out.techChipCount = techChips.length;
  out.techChipsNo = techChips.filter((c) => c.cls.includes('no'));
  check('the research panel draws cost chips at all',
        out.techChipCount > 0,
        `${out.techChipCount} chips over ${out.techCount} techs`);

  // GP-601: no unlock line may be a hex id. Asserted in BOTH modes, because the
  // hex was never a sandbox bug: `entity 0x16` was drawn at every player.
  const hexGives = cards.filter((c) => /0x[0-9a-f]+/i.test(c.gives || ''));
  out.hexUnlockCards = hexGives.map((c) => `${c.name}: ${c.gives}`);
  check('no tech advertises its unlocks as a hex id',
        hexGives.length === 0,
        `${hexGives.length} of ${out.techCount} cards: `
        + `${out.hexUnlockCards.join(' | ')}`);

  // ---- 4. THE CHECKLIST HINT --------------------------------------------
  of.input.act(['research'], 4);
  await sleep(0.5);
  // The drawn hint is only ever the CURRENT row's, so the pad row's is read
  // from the same derivation the panel draws rather than from the panel, which
  // at spawn is showing row 0. `allHints` is that derivation (GP-165).
  const hints = of.goals().hints || [];
  const padHint = (hints.find((h) => h.id === 'pad') || {}).hint || '';
  out.padHint = padHint;
  out.goalPanelText = txt(document.querySelector('#of-goals'));
  check('the pad hint mentions the pad at all (the row still exists)',
        /hand/i.test(padHint), padHint);

  // ---- THE MODE-DEPENDENT CLAIMS ----------------------------------------
  if (sandbox) {
    check('SANDBOX: no build-menu chip is drawn as a refusal',
          out.buildChipsNo.length === 0,
          `${out.buildChipsNo.length} of ${out.buildChipCount} chips red: `
          + out.buildChipsNo.map((c) => c.text).join(', '));
    check('SANDBOX: no craft chip is drawn as a refusal',
          out.craftChipsNo.length === 0,
          `${out.craftChipsNo.length} of ${out.craftChipCount} chips red: `
          + out.craftChipsNo.map((c) => c.text).join(', '));
    check('SANDBOX: no research cost chip is drawn as a refusal',
          out.techChipsNo.length === 0,
          `${out.techChipsNo.length} of ${out.techChipCount} chips red`);
    // The positive half: the `free` class must actually be REACHED, or the
    // three checks above pass on a screen that simply stopped drawing chips.
    check('SANDBOX: the sandbox-is-paying class is actually drawn',
          out.buildChipsFree.length > 0 && out.craftChipsFree.length > 0,
          `build ${out.buildChipsFree.length}/${out.buildChipCount}, `
          + `craft ${out.craftChipsFree.length}/${out.craftChipCount}`);
    // The NUMBER survives. Reid tests the real game in sandbox; a chip that
    // stopped printing `0/40` would pass every class check above and would have
    // thrown away the thing he opened the menu for.
    check('SANDBOX: the survival price is still printed on the chips',
          out.buildChipsFree.every((c) => /\d+\/\d+/.test(c.text)),
          out.buildChipsFree.slice(0, 3).map((c) => c.text).join(' | '));
    check('SANDBOX: the build hint no longer claims everything is free '
          + 'while pricing it',
          (out.buildHint || '').includes('survival'), out.buildHint);
    check('SANDBOX: the research header does not claim 0 unlocked',
          !/unlocked/.test(out.researchHeader || ''), out.researchHeader);
    check('SANDBOX: the research panel says the tree gates nothing',
          /gates nothing/i.test(out.researchHint || ''), out.researchHint);
    check('SANDBOX: the pad hint does not order a research the mode waived',
          !/^research /i.test(padHint) && /sandbox/i.test(padHint), padHint);
  } else {
    // THE REACHABLE REFUSING CASE. A fresh survival pack affords nothing
    // expensive, so red MUST appear; if it does not, the sandbox side above is
    // asserting the absence of something that never appears anyway.
    check('SURVIVAL: a shortfall is still drawn as a refusal (red is reachable)',
          out.buildChipsNo.length > 0 || out.craftChipsNo.length > 0,
          `build ${out.buildChipsNo.length}/${out.buildChipCount}, `
          + `craft ${out.craftChipsNo.length}/${out.craftChipCount}`);
    check('SURVIVAL: the sandbox-is-paying class is never drawn',
          out.buildChipsFree.length === 0 && out.craftChipsFree.length === 0,
          `build ${out.buildChipsFree.length}, craft ${out.craftChipsFree.length}`);
    check('SURVIVAL: the research header still counts the tree',
          /\d+ \/ \d+/.test(out.researchHeader || ''), out.researchHeader);
    check('SURVIVAL: there is no sandbox availability row',
          out.researchAvail === null, out.researchAvail);
    check('SURVIVAL: the pad hint still names the research it needs',
          /^research Launch Facilities/i.test(padHint), padHint);
  }

  return finish(out);
})()
