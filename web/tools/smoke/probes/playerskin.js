// RN-648. Is the PLAYER actually wearing its surface maps in the running game?
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/playerskin.js
//
// WHY THIS PROBE EXISTS, and the answer is the finding rather than the fix.
// `surfaces.json` has mapped `Suit`, `SuitDark` and `Plate` to a family since
// DW-35, and `surface_preview.py` honours that mapping, so every Blender render
// of the player since then has shown maps THE CLIENT DID NOT APPLY:
// `PlayerRig.ts` never imported Surfaces at all. The four registered consumers
// were PropLibrary, MachineBatch, NodeBatch and SpiderFlock, which is every
// BATCHED path and no per-object one, and the player is the only rendered asset
// in the game that is neither batched nor merged.
//
// That class of defect is invisible to every gate this project owns: the .glb
// validates, the manifest validates, texgen's checks pass on the bytes, and the
// studio render looks correct. Only the running client can answer it, so this
// asserts against the client's own registry rather than against a picture.
//
// FAILURE MODES NAMED BEFORE MEASURING (INSTRUMENTS.md's rule):
//   - a label present but family 'flat'    -> the role fell through
//     familyForRole and is drawing untextured while every "is it bound" flag
//     downstream still reads true
//   - hasNormal true but repeat 1          -> bound but not TILED, so one
//     0.5 m tile is stretched over a whole body (RN-453's card trap)
//   - mapSize 1x1                          -> three's default white texture,
//     which satisfies every null check and carries no information
//   - materials registered twice           -> a shared material attached from
//     two of the three call sites; harmless to render, fatal to this report
//   - Skin or Glass carrying a map         -> a role that FLAT_ROLES
//     deliberately leaves bare, so a map on it is a regression not a bonus
(async () => {
  const of = window.__of;
  const surf = window.__ofSurfaces;
  if (!of || !surf) return { valid: false, why: 'no __of / __ofSurfaces' };
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  await surf.ready;

  // ---- the two new families are loaded at all ----------------------------
  const r0 = surf.report();
  check('the client role table agrees with surfaces.json',
        r0.tableAgreesWithManifest, JSON.stringify(r0.mismatches));
  check('no unknown roles', r0.unknownRoles.length === 0,
        JSON.stringify(r0.unknownRoles));
  const fam = Object.fromEntries(r0.families.map((f) => [f.name, f]));
  for (const [name, px, tile] of [['suitfab', 512, 0.5],
                                  ['suitplate', 384, 0.4]]) {
    const f = fam[name];
    if (!check(`${name} loaded`, f !== undefined,
               JSON.stringify(Object.keys(fam)))) continue;
    check(`${name} carries an albedo`, f.albedo === true, JSON.stringify(f));
    check(`${name} is ${px} px`, f.sizePx === px, `${f.sizePx}`);
    check(`${name} tiles at ${tile} m`, f.tileM === tile, `${f.tileM}`);
    // repeat is 1/tile: the number that decides whether this is a tiling
    // family or one stretched card.
    check(`${name} repeat is 1/${tile}`,
          Math.abs(f.repeat - 1 / tile) < 1e-6, `${f.repeat}`);
  }

  // ---- the player's own materials ----------------------------------------
  // Wait for the rigs: PlayerRig.load is async and the FP arms in particular
  // are created after first render. An assertion that runs too early reports
  // "the player has no materials", which is indistinguishable from the very
  // defect this probe exists to catch, so it is waited for explicitly.
  // `body:` and `fparms:` are two rigs, not one registered twice: they load two
  // .glb files whose role names are identical by design (ASSET-SPECS 4.2 gave
  // both rigs the same bone and material names on purpose). Asserting on the
  // FP arms specifically, because they are the ones in every frame.
  let mats = [];
  for (let i = 0; i < 60; i++) {
    mats = surf.report().materials.filter(
      (m) => m.label.startsWith('body:') || m.label.startsWith('fparms:'));
    if (mats.filter((m) => m.label.startsWith('fparms:')).length >= 6) break;
    await of.run(0.1);
  }
  check('the player registered its materials at all', mats.length > 0,
        `${mats.length}`);
  check('BOTH rigs registered',
        mats.some((m) => m.label.startsWith('body:'))
        && mats.some((m) => m.label.startsWith('fparms:')),
        JSON.stringify(mats.map((m) => m.label)));

  const byLabel = {};
  for (const m of mats) {
    if (byLabel[m.label] !== undefined) {
      fails.push(`material registered TWICE: ${m.label}`);
    }
    byLabel[m.label] = m;
  }

  // The three roles this pass re-pointed, and the family each must now wear.
  // Checked on the FP arms, which is where they fill the frame.
  for (const [role, family] of [['OF_Suit', 'suitfab'],
                                ['OF_SuitDark', 'suitfab'],
                                ['OF_Plate', 'suitplate']]) {
    const m = byLabel[`fparms:${role}`];
    if (!check(`${role} is registered`, m !== undefined,
               JSON.stringify(Object.keys(byLabel)))) continue;
    check(`${role} wears ${family}`, m.family === family, m.family);
    check(`${role} has all four map slots bound`,
          m.hasNormal && m.hasRough && m.hasMetal && m.hasAo,
          JSON.stringify(m));
    check(`${role} is TILED, not stretched`,
          m.repeat !== null && m.repeat > 1.9, `${m.repeat}`);
    check(`${role} wraps`, m.wrapRepeat === true);
    check(`${role} normal is in NoColorSpace`, m.dataColorSpace === true);
    check(`${role} aoMap reads uv channel 0`, m.aoChannel === 0,
          `${m.aoChannel}`);
  }

  // The deliberately-bare roles stay bare. FLAT_ROLES is a set of recorded
  // decisions and a map appearing on one is a regression, not an improvement.
  for (const role of ['OF_Skin', 'OF_Glass']) {
    const m = byLabel[`fparms:${role}`];
    if (m === undefined) continue;            // not on this rig, fine
    check(`${role} stays FLAT`,
          m.family === 'flat' && !m.hasNormal && !m.hasRough,
          JSON.stringify(m));
  }

  return {
    valid: true,
    pass: fails.length === 0,
    fails,
    playerMaterials: mats.length,
    families: mats.map((m) => `${m.label}=${m.family}`).sort(),
    vramMB: r0.vramMB,
  };
})()
