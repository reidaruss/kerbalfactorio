// RN-2200's proof, and it is a UNIT-STYLE check rather than a probe on purpose.
//
// The defect being fixed is a GROUPING defect: `PropLibrary.register` put every
// non-zero LOD tier into one named slot, so the far geometry was whichever mesh
// `Object3D.traverse` reached last. It is dormant today because every prop atlas
// ships exactly `_LOD0` and `_LOD2`, which means a browser probe against the
// SHIPPED assets cannot see it either way, before or after. The only honest
// proof is to feed the grouping a file that ships three rungs and assert what
// comes out, which needs no GL context, no build and no server.
//
// The OLD behaviour is reproduced here verbatim (`legacyGroup`) and asserted to
// FAIL on the same input the new grouping passes, so this file is a two-way
// proof rather than a green tick: if somebody reinstates the else-branch, the
// negative arm goes red and says which one it was.
//
//     node --experimental-strip-types web/scripts/check-proplods.mjs
//
// `--experimental-strip-types` is what lets a .mjs import the .ts module the
// client actually ships. The alternative -- a second copy of the grouping rule
// written in JavaScript -- is the thing this project calls an opinion: it would
// pass forever while the shipped rule drifted out from under it.

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(
  join(here, '..', 'src', 'render', 'instancing', 'PropLods.ts')).href);
const { PROP_LODS, emptyLods, geomAtTier, groupTiers, meshAtTier, tierOfName } = mod;

/** THE DEFECT, exactly as `PropLibrary.register` carried it before RN-2200.
 *  Kept so the negative arm below is a reproduction and not a paraphrase. */
function legacyGroup(prims) {
  const byStem = new Map();
  for (const m of prims) {
    const hit = /^(.*)_LOD(\d)(?:_\d+)?$/.exec(m.name);
    if (hit === null) continue;
    const perMat = byStem.get(hit[1]) ?? new Map();
    byStem.set(hit[1], perMat);
    const slot = perMat.get(m.materialName) ?? { lod0: null, lod2: null };
    if (hit[2] === '0') slot.lod0 = m; else slot.lod2 = m;
    perMat.set(m.materialName, slot);
  }
  return byStem;
}

const fails = [];
function check(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); } catch (e) {
    fails.push(name);
    console.log(`  FAIL  ${name}\n        ${e.message.split('\n')[0]}`);
  }
}

// The shape a canopy atlas has AFTER this lane's far tier lands: a hand-authored
// LOD2 cone and a LOD3 impostor card, both on OF_Leaf, in the traversal order
// glTF gives them (LOD2 before LOD3, which is the order that hides the bug in
// the direction that looks harmless until you read the triangle count).
const CANOPY = [
  { name: 'Canopy_Pine_LOD0', materialName: 'OF_Leaf' },
  { name: 'Canopy_Pine_LOD2', materialName: 'OF_Leaf' },
  { name: 'Canopy_Pine_LOD3', materialName: 'OF_Leaf' },
];

console.log('check-proplods: the LOD ladder replacing the two-slot grouping');

check('the ladder has four rungs and an absent rung is -1', () => {
  assert.equal(PROP_LODS, 4);
  assert.deepEqual(emptyLods(), [-1, -1, -1, -1]);
});

check('tierOfName parses the tier, the glTF dedup suffix, and refuses the rest', () => {
  assert.deepEqual(tierOfName('Canopy_Pine_LOD2'), { stem: 'Canopy_Pine', tier: 2 });
  assert.deepEqual(tierOfName('Canopy_Pine_LOD3_1'), { stem: 'Canopy_Pine', tier: 3 });
  assert.equal(tierOfName('col_Forest_DeadTree'), null);
  assert.equal(tierOfName('Canopy_Pine'), null);
  // Past the ladder is ABSENT, never folded into the last rung. That fold is
  // the whole defect, in miniature.
  assert.equal(tierOfName('Canopy_Pine_LOD4'), null);
});

check('THE FIX: a _LOD3 does not clobber the _LOD2', () => {
  const rungs = groupTiers(CANOPY).get('Canopy_Pine').get('OF_Leaf');
  assert.equal(rungs.length, PROP_LODS);
  assert.equal(rungs[0].name, 'Canopy_Pine_LOD0');
  assert.equal(rungs[1], null, 'the canopy ships no LOD1 and must not invent one');
  assert.equal(rungs[2].name, 'Canopy_Pine_LOD2', 'the LOD2 cone survived the LOD3');
  assert.equal(rungs[3].name, 'Canopy_Pine_LOD3');
});

check('THE NEGATIVE CONTROL: the old grouping loses the LOD2 on the same input', () => {
  const slot = legacyGroup(CANOPY).get('Canopy_Pine').get('OF_Leaf');
  assert.equal(slot.lod0.name, 'Canopy_Pine_LOD0');
  // This is the bug, asserted rather than described: the far slot is the LOD3
  // impostor card and the LOD2 cone is nowhere, so every canopy tree between
  // 45 m and the far ring would draw four triangles.
  assert.equal(slot.lod2.name, 'Canopy_Pine_LOD3');
  assert.notEqual(slot.lod2.name, 'Canopy_Pine_LOD2');
});

check('traversal order cannot change the answer', () => {
  const forward = groupTiers(CANOPY).get('Canopy_Pine').get('OF_Leaf');
  const reversed = groupTiers([...CANOPY].reverse()).get('Canopy_Pine').get('OF_Leaf');
  assert.deepEqual(reversed.map((m) => m && m.name), forward.map((m) => m && m.name));
  // ...and it CAN change the old one, which is what "last writer wins" means.
  assert.equal(legacyGroup(CANOPY).get('Canopy_Pine').get('OF_Leaf').lod2.name,
    'Canopy_Pine_LOD3');
  assert.equal(legacyGroup([...CANOPY].reverse()).get('Canopy_Pine').get('OF_Leaf').lod2.name,
    'Canopy_Pine_LOD2');
});

check('today\'s shipped atlas (LOD0 + LOD2 only) groups exactly as before', () => {
  const today = [
    { name: 'Plains_Shrub_LOD0', materialName: 'OF_Leaf' },
    { name: 'Plains_Shrub_LOD2', materialName: 'OF_Leaf' },
  ];
  const rungs = groupTiers(today).get('Plains_Shrub').get('OF_Leaf');
  const slot = legacyGroup(today).get('Plains_Shrub').get('OF_Leaf');
  assert.equal(rungs[0], slot.lod0);
  assert.equal(meshAtTier(rungs, 2), slot.lod2);
  assert.equal(meshAtTier(rungs, 3), slot.lod2, 'no LOD3 falls back to the LOD2');
  assert.equal(meshAtTier(rungs, 1), slot.lod0, 'no LOD1 falls back to the LOD0');
});

check('geomAtTier walks DOWN to the finest rung shipped, and -1 only when empty', () => {
  const part = { material: 'OF_Leaf', lods: [7, -1, 9, -1] };
  assert.equal(geomAtTier(part, 0), 7);
  assert.equal(geomAtTier(part, 1), 7);
  assert.equal(geomAtTier(part, 2), 9);
  assert.equal(geomAtTier(part, 3), 9);
  // Out of range clamps rather than reading undefined.
  assert.equal(geomAtTier(part, 99), 9);
  assert.equal(geomAtTier({ material: 'OF_Leaf', lods: emptyLods() }, 3), -1);
});

check('two primitives on one rung keep glTF\'s own last-writer meaning', () => {
  // `Foo_LOD0` and `Foo_LOD0_1` are the same node exported twice, which is what
  // the `_\d+` suffix means. Collapsing them is correct; collapsing two
  // DIFFERENT tiers is not, and that distinction is the fix.
  const rungs = groupTiers([
    { name: 'Forest_Fern_LOD0', materialName: 'OF_Leaf' },
    { name: 'Forest_Fern_LOD0_1', materialName: 'OF_Leaf' },
  ]).get('Forest_Fern').get('OF_Leaf');
  assert.equal(rungs[0].name, 'Forest_Fern_LOD0_1');
});

check('materials do not share a ladder', () => {
  const perMat = groupTiers([
    { name: 'Canopy_Fir_LOD0', materialName: 'OF_Bark' },
    { name: 'Canopy_Fir_LOD0_1', materialName: 'OF_Leaf' },
    { name: 'Canopy_Fir_LOD3', materialName: 'OF_Leaf' },
  ]).get('Canopy_Fir');
  assert.equal(perMat.get('OF_Bark')[3], null, 'bark has no impostor rung');
  assert.equal(perMat.get('OF_Leaf')[3].name, 'Canopy_Fir_LOD3');
});

if (fails.length > 0) {
  console.error(`\ncheck-proplods: ${fails.length} FAILED: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('check-proplods: PASS');
