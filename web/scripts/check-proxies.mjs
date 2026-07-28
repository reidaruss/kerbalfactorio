// DOES EVERY .glb SHIP THE COLLISION PROXIES ITS CONTRACT DECLARES, AND ONLY
// THOSE? Nothing in this project asked that until 2026-07-27, and the launch
// pad is what it cost: `contracts.json` declared four proxies, the file had always
// shipped five (`col_LaunchMount` was undeclared), and the eight stair treads
// in the north-east notch had no proxy at all. A driven walk up them gained
// 0.000 m and wedged against a 2.00 m wall (`probes/padstair.js`).
//
// WHY THIS IS NOT PART OF tools/blender/validate_glb.py, WHICH ALREADY LOOKS AT
// `collision`. That checker asks one half of the question: it lists the
// declared names and reports the MISSING ones. An EXTRA proxy in the file is
// invisible to it, and an extra proxy is not a harmless surplus: it is the
// contract having stopped describing the asset, which is exactly the state in
// which nobody notices that something else is absent. So this asks both
// directions, and it is deliberately a separate, dependency-free node script so
// it runs in `npm run check` next to check-limits.mjs without Blender, without
// python and without a build step.
//
// IT READS THE SHIPPED BYTES, not the Blender build scripts. A checker
// generated from the builder would only ever prove the builder agrees with
// itself (validate_glb.py's own argument, and it is the right one).
//
// THE THIRD RULE IS A TRAP THIS FILE EXISTS TO STOP BEING SPRUNG. three.js
// names the split primitives of a multi-material mesh `Name_0`, `Name_1`, ...
// and the client's proxy readers (`StructureBody.proxiesOf`,
// `LaunchPadModule.padProxies`) therefore collapse anything matching `_<digits>`
// at the end of a name onto ONE proxy, so that a two-material collision box
// stays one box. The consequence is that a proxy genuinely named `col_Step_1`
// silently deletes `col_Step_2` and everything after it. That failure looks
// exactly like the bug above and is quieter, so the naming is checked here
// rather than left to be discovered.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const contractsPath = join(repoRoot, 'tools', 'blender', 'contracts.json');

/** The JSON chunk of a GLB, or throw naming the file. */
function glbJson(path) {
  const b = readFileSync(path);
  if (b.length < 20 || b.readUInt32LE(0) !== 0x46546c67) {
    throw new Error(`${path}: not a GLB (bad magic)`);
  }
  const chunkLen = b.readUInt32LE(12);
  const chunkType = b.readUInt32LE(16);
  if (chunkType !== 0x4e4f534a) throw new Error(`${path}: first chunk is not JSON`);
  return JSON.parse(b.subarray(20, 20 + chunkLen).toString('utf8'));
}

const contracts = JSON.parse(readFileSync(contractsPath, 'utf8'));
const assets = contracts.assets ?? {};
const problems = [];
let checked = 0;
let proxies = 0;

for (const [name, spec] of Object.entries(assets)) {
  if (spec === null || typeof spec !== 'object' || spec.glb === undefined) continue;
  const path = join(repoRoot, spec.glb);
  if (!existsSync(path)) {
    problems.push(`${name}: contract points at ${spec.glb}, which does not exist. `
      + `Run the Blender build (tools/blender/build_*.py).`);
    continue;
  }
  checked++;
  const gltf = glbJson(path);
  const shipped = (gltf.nodes ?? [])
    .map((n) => n.name ?? '')
    .filter((n) => n.startsWith('col_'));
  proxies += shipped.length;

  // A contract may declare one name or a list; a biome atlas declares the props
  // that are genuinely solid and nothing for the ankle-height ones.
  const raw = spec.collision ?? [];
  const declared = typeof raw === 'string' ? [raw] : raw;

  for (const want of declared) {
    if (!shipped.includes(want)) {
      problems.push(`${name} (${spec.glb}): contract declares ${want}, `
        + `the file does not ship it. Shipped: ${shipped.join(', ') || '(none)'}`);
    }
  }
  for (const got of shipped) {
    if (!declared.includes(got)) {
      problems.push(`${name} (${spec.glb}): ships ${got}, which the contract `
        + `does not declare. Add it to "collision", or delete the proxy.`);
    }
  }
  for (const got of shipped) {
    if (/_\d+$/.test(got)) {
      problems.push(`${name} (${spec.glb}): ${got} ends in _<digits>, which the `
        + `client's proxy readers collapse onto ${got.replace(/_\d+$/, '')} `
        + `(three.js names split primitives that way). Rename it, or every `
        + `sibling but the first is silently dropped on load.`);
    }
  }
}

if (problems.length > 0) {
  console.error('check-proxies FAIL:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`check-proxies OK (${checked} assets, ${proxies} col_* proxies, `
  + `declared set matches shipped set both ways)`);
