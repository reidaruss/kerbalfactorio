// WG-68: the decor-rock threshold's TRANSCRIBED factor, checked against the
// shipped bytes.
//
// RockTuning.DECOR_ROCK_MAX_H is derived from three factors, and one of them
// (the stone boulder's authored Full height) is a transcription from
// boulder_common.py. A constant transcribed from an asset is the catalogued
// hidden-assumption failure (INSTRUMENTS.md, the 8 m machine), so this script
// re-measures it from the exported .glb's own accessor bounds and fails when
// the asset and the constant drift. Run it beside the probe suite:
//
//   node tools/smoke/rockdims.mjs
//
// It reads the constants OUT OF RockTuning.ts rather than repeating them here,
// because a copy of a transcription is two transcriptions.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..', '..');

const tuning = readFileSync(
  resolve(webRoot, 'src', 'game', 'RockTuning.ts'), 'utf8');
const num = (name) => {
  const m = new RegExp(`${name} = ([0-9.]+)`).exec(tuning);
  if (m === null) throw new Error(`rockdims: ${name} not found in RockTuning.ts`);
  return Number(m[1]);
};
const FULL_H = num('NODE_STONE_FULL_H');
const LOW_Z = num('NODE_LOW_Z_SCALE');
const SCALE_MIN = num('ROCK_SCALE_MIN');
// The threshold itself must BE the derivation in source, not a fourth literal:
// a literal beside a formula is two authorities one edit apart.
const derived = /DECOR_ROCK_MAX_H =\s*\n?\s*NODE_STONE_FULL_H \* NODE_LOW_Z_SCALE \* ROCK_SCALE_MIN/
  .test(tuning);
const THRESH = FULL_H * LOW_Z * SCALE_MIN;

const glbPath = resolve(webRoot, '..', 'assets', 'models', 'dist', 'nodes',
  'boulder_stone.glb');
const buf = readFileSync(glbPath);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glb');
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

/** Height of a named mesh from its POSITION accessor bounds. Blender exports
 *  y-up, so the authored z height is glTF max[1] - min[1]. */
function heightOf(prefix) {
  let hi = -Infinity, lo = Infinity, found = false;
  for (const mesh of gltf.meshes ?? []) {
    if (!mesh.name.startsWith(prefix)) continue;
    for (const prim of mesh.primitives) {
      const acc = gltf.accessors[prim.attributes.POSITION];
      if (!acc?.max || !acc?.min) continue;
      hi = Math.max(hi, acc.max[1]); lo = Math.min(lo, acc.min[1]);
      found = true;
    }
  }
  if (!found) throw new Error(`rockdims: no mesh named ${prefix}* in the glb`);
  return hi - lo;
}

const fullH = heightOf('BoulderStone_Full');
const lowH = heightOf('BoulderStone_Low');
const fails = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) fails.push(name);
};

check('the transcribed Full height matches the shipped bytes',
  Math.abs(fullH - FULL_H) < 0.02, `glb ${fullH.toFixed(4)} vs ${FULL_H}`);
check('the Low stub is at or under the derived factor of the Full height',
  lowH <= FULL_H * LOW_Z + 0.02,
  `glb ${lowH.toFixed(4)} vs ${(FULL_H * LOW_Z).toFixed(3)}`);
check('the threshold in source is the derivation, not a fourth literal',
  derived, 'DECOR_ROCK_MAX_H = NODE_STONE_FULL_H * NODE_LOW_Z_SCALE * ROCK_SCALE_MIN');
check('the derived threshold re-derived off the glb agrees',
  Math.abs(THRESH - fullH * LOW_Z * SCALE_MIN) < 0.02,
  `${THRESH.toFixed(4)} vs ${(fullH * LOW_Z * SCALE_MIN).toFixed(4)}`);

if (fails.length) { console.error(`rockdims: ${fails.length} FAIL`); process.exit(1); }
console.log('rockdims: PASS');
