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
// THE SOCKETS GET THE SAME TREATMENT, AND FOR A SHARPER REASON. A collision
// proxy that goes missing costs you a wall you can walk through. A socket that
// goes missing costs you a machine port: `socket_item_in` and `socket_item_out`
// are about to be read at load as the real geometry of where a belt hands an
// item to a smelter and where the smelter hands it back, so a contract that
// declares a socket the file does not ship yields an undefined transform at the
// exact place two machines are supposed to meet, and a socket shipped but not
// declared is a port nobody wired up sitting on the asset looking functional.
// Both directions are asked here for the same reason both are asked of `col_*`:
// the surplus is the early symptom, and the absence is the outage.
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
let sockets = 0;

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
  const nodeNames = (gltf.nodes ?? []).map((n) => n.name ?? '');
  const shipped = nodeNames.filter((n) => n.startsWith('col_'));
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

  // THE SOCKET HALF. Same question, same two directions, different cost of
  // getting it wrong: these are the attachment points the machine IO code reads
  // at load to place ports, so a name that drifts here does not crash, it just
  // quietly puts a belt's hand-off somewhere the smelter is not.
  const rawSockets = spec.sockets ?? [];
  const declaredSockets = typeof rawSockets === 'string' ? [rawSockets] : rawSockets;
  const shippedSockets = nodeNames.filter((n) => n.startsWith('socket_'));
  sockets += shippedSockets.length;

  for (const want of declaredSockets) {
    if (!shippedSockets.includes(want)) {
      problems.push(`${name} (${spec.glb}): contract declares socket ${want}, `
        + `the file does not ship it. Anything that resolves that port gets no `
        + `transform. Shipped: ${shippedSockets.join(', ') || '(none)'}`);
    }
  }
  // The shipped side is de-duplicated by NAME before it is reported, which the
  // `col_` side above does not need to do. An atlas GLB holds many sub-objects
  // in one file (`rocket_parts` ships fourteen `socket_stack_bottom`, one per
  // part; `items_atlas` ships one `socket_rest` per item), so a single
  // undeclared socket name would otherwise print fifteen identical lines and
  // bury whatever came after it. The contract names a socket ONCE per asset, so
  // one line per distinct name is the right granularity; the count is carried
  // along so a name that repeats unexpectedly is still visible.
  const seen = new Map();
  for (const got of shippedSockets) seen.set(got, (seen.get(got) ?? 0) + 1);
  for (const [got, count] of seen) {
    if (!declaredSockets.includes(got)) {
      const times = count > 1 ? ` (${count} nodes)` : '';
      problems.push(`${name} (${spec.glb}): ships socket ${got}${times}, which `
        + `the contract does not declare. Add it to "sockets", or delete the `
        + `node. An undeclared port is one nothing is obliged to keep working.`);
    }
  }

  // NO _<digits> CHECK ON SOCKETS, AND THAT IS DELIBERATE RATHER THAN AN
  // OVERSIGHT. The trap above is a property of three.js splitting a MESH with
  // several materials into `Name_0`, `Name_1`, ... A socket is an empty node: no
  // mesh, no material, nothing to split, so the loader never generates those
  // suffixes for it and the client's readers never collapse them. A socket
  // legitimately named `socket_item_in_1` is therefore safe, and rejecting it
  // here would ban a naming scheme that costs nothing. Revisit only if a socket
  // ever stops being an empty node.
}

if (problems.length > 0) {
  console.error('check-proxies FAIL:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`check-proxies OK (${checked} assets, ${proxies} col_* proxies, `
  + `${sockets} socket_* sockets, declared sets match shipped sets both ways)`);
