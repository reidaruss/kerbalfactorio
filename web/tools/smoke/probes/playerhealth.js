// playerhealth.js: THE PLAYER CAN BE HURT, CAN DIE, AND GETS BACK UP (GP-79).
//
// Run it TWICE, and the pair is the point:
//
//   run.mjs --sandbox=1              -> hostile false, nothing can hurt you
//   run.mjs --sandbox=1 --combat=1   -> hostile true, everything below lands
//
// DW-31 says sandbox is for playtesting without grind, and the same probe
// passing in both modes with OPPOSITE outcomes is what proves the mode is a
// rule rather than a coincidence. The safe run is not a skipped test: it asserts
// that `hurtEvents` RISES while `totalTaken` stays at zero, which is a different
// picture from a damage path that was never wired (both at zero) and is exactly
// the two-named-shapes argument DW-26 makes and `Structures.affordInCore`
// already uses for cost.
//
// THE BAR IS MEASURED AT THE PIXEL, not against the client's own arithmetic:
// `barPct` is read back off the element's own width, so the assertion is the
// PAINTED bar against the sim. That is GP-63's discipline, and it is the only
// version of "the HUD shows your health" that can fail.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.hurt !== 'function') return { valid: false, why: 'no of.hurt' };
  const sleep = (n) => of.run(n);
  const log = [];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  };
  const V = () => of.game().vitals;
  const hostile = of.game().mode.hostile;

  // The DRAWN bar, read off the element. Returns null when the widget is not
  // on screen at all, which is a different answer from 0%.
  const barPct = () => {
    const el = document.querySelector('#of-hpbar > i');
    if (el === null) return null;
    const w = el.getBoundingClientRect().width;
    const parent = el.parentElement.getBoundingClientRect().width;
    return parent > 0 ? (w / parent) * 100 : null;
  };
  const label = () => {
    const el = document.querySelector('#of-health .hl');
    return el === null ? null : el.textContent;
  };

  await sleep(1.0);

  // --- 0. the bar exists and reads FULL before anything happens -------------
  const v0 = V();
  check('the player starts at full health', v0.hp === v0.maxHp,
        `${v0.hp} of ${v0.maxHp}`);
  check('the health bar is on screen', barPct() !== null, `${barPct()}`);
  check('and it is drawn full', Math.abs((barPct() ?? -1) - 100) < 0.6,
        `${barPct()}%`);
  check('the mode agrees with the URL', typeof hostile === 'boolean');
  log.push(`hostile=${hostile}, label "${label()}", bar ${barPct()}%`);

  // --- 1. one bite ----------------------------------------------------------
  // 42 is roughly six seconds of a Skitterer's 7 dps, which is what this will
  // is fed by since GP-91 (one row per creature in reach). Driven through
  // of.hurt here, which is the
  // same PlayerHealth.hurt an enemy in reach will reach through `step`.
  of.hurt({ amount: 42, cause: 'probe' });
  await sleep(0.2);
  const v1 = V();
  log.push(`after one bite: ${v1.hp}/${v1.maxHp}, taken ${v1.totalTaken}, `
    + `events ${v1.hurtEvents}, bar ${barPct()}%, label "${label()}"`);
  check('the hit was COUNTED whatever the mode did with it', v1.hurtEvents === 1,
        `${v1.hurtEvents}`);
  if (hostile) {
    check('health went down by exactly what was dealt',
          Math.abs((v0.hp - v1.hp) - 42) < 1e-9, `${v0.hp} -> ${v1.hp}`);
    check('the DRAWN bar matches the sim',
          Math.abs((barPct() ?? -1) - v1.fraction * 100) < 0.6,
          `drawn ${barPct()}%, sim ${(v1.fraction * 100).toFixed(2)}%`);
    check('and the label reads the number', label() === `${Math.ceil(v1.hp)} / ${v1.maxHp}`,
          `"${label()}"`);
  } else {
    // THE NEGATIVE CONTROL. The event is on the ledger and the damage is not.
    check('sandbox took NO damage', v1.totalTaken === 0, `${v1.totalTaken}`);
    check('and health did not move', v1.hp === v0.hp, `${v0.hp} -> ${v1.hp}`);
    check('and the bar SAYS so rather than vanishing', label() === 'SAFE',
          `"${label()}"`);
    check('and it is still drawn full', Math.abs((barPct() ?? -1) - 100) < 0.6,
          `${barPct()}%`);
  }

  // --- 2. regeneration waits, then works ------------------------------------
  // The delay is the assertion, not the healing: a bar that crept back up while
  // something was still chewing on the player would be worse than no regen.
  let regenDelayOk = true;
  let regenWorks = true;
  if (hostile) {
    const before = V().hp;
    await sleep(2.5);
    const mid = V().hp;
    regenDelayOk = mid === before;
    check('health does NOT come back inside the regen delay', regenDelayOk,
          `${before} -> ${mid} after 2.5 s of a ${V().regen.delaySecs} s delay`);
    await sleep(6.0);
    const late = V().hp;
    regenWorks = late > mid;
    check('and it does come back after it', regenWorks, `${mid} -> ${late}`);
    log.push(`regen: ${before} -> ${mid} (2.5 s) -> ${late} (8.5 s)`);
  }

  // --- 3. death and respawn -------------------------------------------------
  // Only meaningful where the player can die. In the safe run the SAME calls are
  // made and the assertion is that NOTHING happens, which is the control.
  const packBefore = of.game().carried.map((c) => `${c.name}:${c.count}`).sort().join(' ');
  const posBefore = [of.world().observer.latDeg, of.world().observer.lonDeg];
  // Walk away from the landing site first, or a respawn that did nothing would
  // be indistinguishable from one that put the player back where they already
  // were. This is the same reason clickonce.js teleports between measurements.
  of.teleport(posBefore[0] + 0.02, posBefore[1] + 0.02, 0);
  await sleep(0.4);
  const posAway = [of.world().observer.latDeg, of.world().observer.lonDeg];
  const movedAway = Math.hypot(posAway[0] - posBefore[0], posAway[1] - posBefore[1]);
  check('the probe really moved before testing the respawn', movedAway > 1e-4,
        `${movedAway} deg`);

  const bannersBefore = of.game().fx.banners;
  of.hurt({ amount: 9999, cause: 'probe killing blow' });
  await sleep(0.3);
  const vDead = V();
  log.push(`after the killing blow: dead=${vDead.dead}, deaths=${vDead.deaths}, `
    + `respawnIn=${vDead.respawnIn}, label "${label()}"`);
  if (hostile) {
    check('a killing blow kills', vDead.dead === true && vDead.hp === 0,
          `dead ${vDead.dead}, hp ${vDead.hp}`);
    check('and it is counted', vDead.deaths === 1, `${vDead.deaths}`);
    check('and the screen SAYS so', of.game().fx.banners > bannersBefore,
          `${bannersBefore} -> ${of.game().fx.banners}`);
    check('and the bar counts the blackout down',
          (label() ?? '').startsWith('DOWN'), `"${label()}"`);
    // Nothing the player presses may build or dig while they are down.
    const digBefore = of.game().nodes ? 0 : 0;
    const buildsBefore = of.game().factory.buildings;
    of.input.tape([{ hold: 6, actions: ['use'] }, { hold: 4, keys: [] }]);
    await sleep(0.3);
    check('a dead player cannot build', of.game().factory.buildings === buildsBefore,
          `${buildsBefore} -> ${of.game().factory.buildings}`);
    void digBefore;

    // Stand up through the SAME call the five second timer makes.
    of.hurt({ respawn: true });
    await sleep(0.4);
    const vUp = V();
    const posAfter = [of.world().observer.latDeg, of.world().observer.lonDeg];
    const backHome = Math.hypot(posAfter[0] - posBefore[0], posAfter[1] - posBefore[1]);
    log.push(`respawned at ${posAfter} against a landing site of ${posBefore}, `
      + `${backHome} deg away`);
    check('respawn restores full health',
          vUp.dead === false && vUp.hp === vUp.maxHp, `${vUp.hp}/${vUp.maxHp}`);
    check('respawn puts the player back at the landing site', backHome < 1e-3,
          `${backHome} deg from where they started, was ${movedAway}`);
    check('THE PACK IS INTACT: dying costs time, not items',
          of.game().carried.map((c) => `${c.name}:${c.count}`).sort().join(' ')
          === packBefore, `"${packBefore}"`);
    check('and the death is still on the ledger', vUp.deaths === 1, `${vUp.deaths}`);
  } else {
    check('NOTHING can kill a sandbox player', vDead.dead === false,
          `dead ${vDead.dead}`);
    check('and no death was recorded', vDead.deaths === 0, `${vDead.deaths}`);
    check('and the bar still reads SAFE', label() === 'SAFE', `"${label()}"`);
  }

  return {
    valid: fails.length === 0,
    hostile,
    mode: of.game().mode,
    vitals: V(),
    barPct: barPct(),
    label: label(),
    regenDelayOk, regenWorks,
    fails, log,
  };
})()
