// RN-2571. WHICH HALF OF THE SHADE LAW MOVES THE `box` RATCHET, AND WHICH HALF
// MOVES THE `crowns` BAND. They are not the same half, and the whole staging
// decision for R4 stage 2 turns on that.
//
// THE PROBLEM THIS ANSWERS. The RN-2550 guard holds two constraints at once:
// a RATCHET on `box` (the wood may never read lighter than the best ever
// shipped) and a BAND on `crowns` rho (the crown's own coverage-corrected
// reflectance must sit inside the canopy optics). N8's control proved they
// PULL AGAINST EACH OTHER: `?crownshadefloor=0.30` lifts `forestairnoon`'s rho
// from 0.0992 to 0.1940, out of a dark-end violation and into the band, and
// simultaneously drives both `box` ratchets above their ceilings (rendering.md
// 2.35.7). The knob is one number and it lands on two surfaces.
//
// AND IT IS ONE NUMBER ON TWO SURFACES BY DESIGN. `CanopySelfShadow.ts`
// applies the same `(amp, K, floor)` triple to BOTH halves of the canopy:
// the FAR TREELINE PAINT (`uTreelineTone` inside `TerrainTreeline.glsl.ts`'s
// albedo block) and the NEAR CROWN CARDS (`updateCanopyCardShade` scaling the
// shared batch material's colour). That file's own header argues at length
// that one law in one place on both sides is what keeps 2.18.4's handover
// identity closed, and it is right about the SEAM. It says nothing about which
// half a MEASUREMENT is reading, and the two guard rectangles read different
// halves in different proportions:
//
//   `box`     a wide band rect `artframe.js`'s own RN-2495 comment calls
//             "nearly blind to the cards" ON THE SHIPPED FRAME.
//   `crowns`  a small rect placed on crowns, coverage-corrected, so `rho`
//             is the CARD half and nothing else (it is taken off
//             `?terrainpaint=1`, which renders the terrain exactly black).
//
// "NEARLY BLIND TO THE CARDS" IS A STATEMENT ABOUT THE SHIPPED FRAME, NOT
// ABOUT THE DERIVATIVE, and that distinction is the reason this script exists
// rather than an inference. It was measured by DELETING the canopy from a
// frame whose cards are already almost black (N7: the card's whole diffuse
// contribution to its own pixel is 0.01 counts of blue), so of course removing
// them changed little. Under a raise the cards stop being almost black, and
// nothing measured so far says how much of the ratchet move they then carry.
//
// THE ISOLATORS ALREADY EXIST and are RN-2275's own standing-rule-7 pair:
//   `?crownshadefar=0`   the FAR PAINT keeps NO shade; the CARDS keep theirs.
//   `?crownshadecard=0`  the CARDS keep NO shade; the FAR PAINT keeps its.
// Both zero the same `amp`, so neither can disagree with `?crownshade=0` about
// what "off" means.
//
// READ THE ARM NAMES CAREFULLY, BECAUSE THE OBVIOUS READING IS WRONG AND THIS
// SCRIPT'S FIRST DRAFT GOT IT WRONG. These flags are AMP switches, not
// raise-SCOPE switches: `?crownshadefar=0` does NOT mean "only the cards see
// `--extra`", it means "the far paint has no self-shadow AT ALL" (its `S`
// becomes exactly 1). So each arm below removes one half's shade entirely
// while the other half runs at the `--extra` setting, and what it measures is
// HOW MUCH OF EACH GUARD QUANTITY THAT HALF'S SHADE IS HOLDING DOWN. That is
// the attribution question worth answering; "what if only one half were
// raised" is a DIFFERENT experiment and no flag in this project performs it.
//
// FOUR WOOD ARMS AGAINST ONE CLEARING, PER POSE:
//   base          the shipped shade, both halves
//   both          `--extra` on both halves        (N8's control, reproduced)
//   farShadeOff   `--extra` + `?crownshadefar=0`  the PAINT's shade removed
//   cardShadeOff  `--extra` + `?crownshadecard=0` the CARDS' shade removed
//
// THE CLEARING IS MEASURED ONCE AND REUSED, and that is not a shortcut: every
// flag here is a CANOPY setting and `?canopy=0` has already deleted the
// canopy, so a canopy setting on that arm is a no-op by construction. It is
// asserted rather than assumed -- `--cleararms=1` re-measures the clearing
// under every variant and prints the spread, which must be zero.
//
// ALL ARMS CARRY `?prophaze=0&terrainhaze=0`: the additive aerial term is
// common-mode and N7 measured it at 82.8 per cent of the `crowns` rectangle.
//
//   node tools/smoke/rn2571halves.mjs --url=http://127.0.0.1:5570/ \
//     --shots=forestairnoon --extra=crownshadefloor=0.30
//
// EVERY FLAG NEEDS AN `=`; the parser splits on the first one.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');
const OFF = ['--prophaze=0', '--terrainhaze=0'];

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5570/';
const shots = (argv.get('--shots') ?? 'forestairnoon').split(',');
const clearArms = argv.get('--cleararms') === '1';
const extra = (argv.get('--extra') ?? '').split(',').filter(Boolean)
  .map((s) => `--${s}`);
if (extra.length === 0) {
  console.error('rn2571halves: --extra= is required; with no setting to split,'
    + ' every variant is the shipped frame and the table says nothing.');
  process.exit(2);
}
const shotBy = (s) => (s.startsWith('forestair') || s.startsWith('flyover')
  || s === 'limb' ? 'surface' : 'walk');

const VARIANTS = {
  base: [],
  both: [...extra],
  farShadeOff: [...extra, '--crownshadefar=0'],
  cardShadeOff: [...extra, '--crownshadecard=0'],
};

function once(shot, flags) {
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`, ...flags];
  if (shotBy(shot) === 'walk') args.push('--sandbox=1');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}

for (const shot of shots) {
  const clear = {};
  clear.base = once(shot, ['--canopy=0', ...OFF]);
  if (clearArms) {
    for (const [k, v] of Object.entries(VARIANTS)) {
      if (k !== 'base') clear[k] = once(shot, ['--canopy=0', ...OFF, ...v]);
    }
  }
  const cb = clear.base;
  if (!cb.valid || !(cb.extra ?? {}).crowns) {
    console.error(`${shot}: the clearing arm failed (${cb.why ?? 'no rect'})`);
    continue;
  }
  const boxClear = cb.box.lin.Y;
  const crClear = cb.extra.crowns.lin.Y;
  if (clearArms) {
    console.log(`\n${shot}: THE CLEARING UNDER EVERY VARIANT (must not move --`
      + ' a canopy flag on a ?canopy=0 arm is a no-op by construction):');
    for (const [k, v] of Object.entries(clear)) {
      console.log(`  ${k.padEnd(10)} box ${v.box.lin.Y.toFixed(6)}`
        + `   crowns ${v.extra.crowns.lin.Y.toFixed(6)}`);
    }
  }

  const rows = [];
  for (const [name, flags] of Object.entries(VARIANTS)) {
    const wood = once(shot, [...OFF, ...flags]);
    const cards = once(shot, ['--terrainpaint=1', ...OFF, ...flags]);
    if (!wood.valid || !cards.valid || !(cards.extra ?? {}).crowns) {
      console.error(`${shot}/${name}: arm failed`
        + ` (${wood.why ?? ''} ${cards.why ?? ''})`);
      continue;
    }
    const f = 1 - cards.extra.crowns.blackFrac;
    rows.push({
      name,
      boxSurf: wood.box.lin.Y / boxClear,
      crSurf: wood.extra.crowns.lin.Y / crClear,
      f,
      rho: cards.extra.crowns.lin.Y / (f * crClear),
      cardShade: ((cards.treeline ?? {}).self ?? {}).cardShade ?? null,
    });
  }
  const b = rows.find((r) => r.name === 'base');
  console.log(`\n--- RN-2571 ${shot}: ${extra.join(' ')} SPLIT BETWEEN THE TWO`
    + ' HALVES OF THE SHADE LAW ---');
  console.log('variant       boxSurf   d(box)  |   crSurf       f      rho'
    + '   d(rho)  cardShade');
  for (const r of rows) {
    const db = b ? r.boxSurf - b.boxSurf : 0;
    const dr = b ? r.rho - b.rho : 0;
    console.log(`${r.name.padEnd(12)} ${r.boxSurf.toFixed(4).padStart(8)}`
      + ` ${(db >= 0 ? '+' : '') + db.toFixed(4)}  | ${r.crSurf.toFixed(4).padStart(8)}`
      + ` ${r.f.toFixed(4).padStart(7)} ${r.rho.toFixed(4).padStart(7)}`
      + `  ${(dr >= 0 ? '+' : '') + dr.toFixed(4)}`
      + `   ${r.cardShade === null ? '--' : r.cardShade.toFixed(4)}`);
  }
  const both = rows.find((r) => r.name === 'both');
  const fso = rows.find((r) => r.name === 'farShadeOff');
  const cso = rows.find((r) => r.name === 'cardShadeOff');
  if (both && fso && cso) {
    const far = fso.boxSurf - both.boxSurf;
    const cardB = cso.boxSurf - both.boxSurf;
    console.log('\nATTRIBUTION, against the `both` arm rather than against base,'
      + ' so each row\nremoves exactly one half\'s shade and changes nothing else:');
    console.log(`  the FAR PAINT's shade is holding boxSurf down by ${far.toFixed(4)}`);
    console.log(`  the CARDS' shade is holding boxSurf down by  ${cardB.toFixed(4)}`
      + `   (${(far / cardB).toFixed(1)}x less)`);
    console.log(`  the CARDS' shade is holding crowns rho down by`
      + ` ${(cso.rho - both.rho).toFixed(4)}, and the far paint's by`
      + ` ${(fso.rho - both.rho).toFixed(4)}`);
    console.log('  -- which is `box` being dominated by the PAINT and `rho` by the'
      + ' CARDS, i.e.\n     artframe.js\'s "nearly blind to the cards" holding under a'
      + ' RAISE and not\n     only on the shipped frame.');
  }
}
