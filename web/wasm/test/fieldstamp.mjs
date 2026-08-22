// PS-53 / PS-55. THE FIELD-GENERATION STAMP, BOTH DIRECTIONS, HEADLESS.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning \
//        --import ./tools/ts-run.mjs wasm/test/fieldstamp.mjs
//   (from `web/`; or `npm run check:fieldstamp`, which is the invocation
//    `npm run check` uses)
//
// WHY HERE AND NOT IN A BROWSER PROBE. Every persistence gate before this one
// (`twobody.mjs`, `probes/bodyfields.js`, `namedvessel.mjs`) needs a built
// client, a served port, a driven world and minutes of wall clock, because the
// claims they make are about a running world. The claim here is about a
// decision over a `SaveSlot` plus a hash of a pure function of the body, and
// `dockrcs.mjs` already set the precedent for that: node, no browser, no GPU,
// no settle time, so a failure names the seam instead of naming the boot.
//
// THE ARM THAT MAKES THIS A REPRODUCTION AND NOT A SIMULATION. WG-275 shipped
// `of_body_set_swell_scale`, a boot-time arm on the exact term it added, so the
// PRE-SWELL PLANET IS AVAILABLE IN THE SHIPPED BINARY. The mismatch fixture
// below is therefore the real event: the stamp of the planet Reid's saves were
// authored against, against the stamp of the planet that exists now, both read
// out of `web/wasm/dist/of-core.wasm` through the same `of_base_height` the
// world is built from. Nothing here invents a number to differ.
//
// Exit 1 on any failed check, the rule every runner in this directory uses.

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', '..');
const src = (p) => pathToFileURL(join(webRoot, 'src', p)).href;

const createCore = (await import(pathToFileURL(join(here, '..', 'dist', 'of-core.mjs')).href)).default;
const { FIELD_EPOCH, FIELD_SAMPLES, clearedBodyHalf, fieldGenVerdict,
  fieldStampFor, fieldStampFrom } = await import(src('game/FieldStamp.ts'));
const { WORLD_KEYS, adoptWorldFor, keptWorlds } = await import(src('game/SaveWorlds.ts'));

let fails = 0;
let checks = 0;
function ok(cond, name, detail = '') {
  ++checks;
  if (cond) { console.log(`  ok   ${name}${detail ? `  (${detail})` : ''}`); return true; }
  ++fails;
  console.log(`  FAIL ${name}${detail ? `  (${detail})` : ''}`);
  return false;
}

// The default world seed, `Config.ts`'s `0x0bf00d01`. It is only ever used here
// to build a body handle; nothing in the stamp depends on which seed it is,
// which §2 asserts rather than assumes.
const SEED_LO = 0x0bf00d01 >>> 0;
const SEED_HI = 0;

const M = await createCore();

/** A handle on the SHIPPED field, and one on the PRE-SWELL field beside it. */
function bodyPair(kind) {
  const mk = kind === 'moon' ? M._of_body_create_cinder : M._of_body_create_forge;
  const live = mk.call(M, SEED_LO, SEED_HI);
  const pre = mk.call(M, SEED_LO, SEED_HI);
  M._of_body_set_swell_scale(pre, 0);
  return { live, pre };
}

console.log('===== §1 the instrument: the stamp moves with the field and with nothing else');
{
  // A synthetic field, so the claim is about the HASH and not about the planet.
  // `fieldStampFrom` takes the sampler for exactly this reason: a function that
  // reached for `of_base_height` itself could only be tested against the one
  // field that happens to ship, which is the trap the whole file is about.
  const flat = () => 0;
  const tilt = (x, y, z) => 1000 * x + 2000 * y - 500 * z;
  const a = fieldStampFrom(tilt);
  ok(fieldStampFrom(tilt) === a, 'the same field stamps the same twice', `${a}`);
  ok(fieldStampFrom(flat) !== a, 'a different field stamps differently');
  // Below the quantum: a rebuild that reassociates arithmetic must not
  // invalidate a world. 1e-9 m against a 1/64 m quantum.
  const noisy = (x, y, z) => tilt(x, y, z) + 1e-9;
  ok(fieldStampFrom(noisy) === a, 'arithmetic noise of 1e-9 m does not move it');
  // Above it: 0.05 m, which is three quanta and far below anything a player
  // would notice, still moves it.
  const nudged = (x, y, z) => tilt(x, y, z) + 0.05;
  ok(fieldStampFrom(nudged) !== a, 'a 0.05 m shift of the whole field does move it');
  // ONE sample moved, which is the small-region case the sample count is
  // chosen for: a change that reaches only a corner of the world is still a
  // change, and the stamp must not average it away.
  let n = 0;
  const oneMoved = (x, y, z) => { ++n; return tilt(x, y, z) + (n === 7 ? 1 : 0); };
  ok(fieldStampFrom(oneMoved) !== a, 'one sample of 216 moving by 1 m moves it');
  ok(FIELD_SAMPLES === 216, 'the sample set is the documented size', `${FIELD_SAMPLES}`);
  ok(FIELD_EPOCH === 1, 'the hand-bumped epoch is at its introduction value');
}

console.log('===== §2 the real field: WG-275, both arms, out of the shipped binary');
const forge = bodyPair('planet');
const cinder = bodyPair('moon');
let liveForge = 0, preForge = 0;
{
  const t0 = performance.now();
  liveForge = fieldStampFor(M, forge.live);
  const costMs = performance.now() - t0;
  preForge = fieldStampFor(M, forge.pre);
  const liveCinder = fieldStampFor(M, cinder.live);
  const preCinder = fieldStampFor(M, cinder.pre);

  // How far the ground actually moved, so the verdict below is a measurement
  // and not an assertion about a hash nobody can see behind.
  let moved = 0, worst = 0;
  for (let f = 0; f < 6; ++f) {
    for (let i = 1; i <= 6; ++i) {
      for (let j = 1; j <= 6; ++j) {
        const u = -1 + (2 * i) / 7, v = -1 + (2 * j) / 7;
        const raw = f === 0 ? [1, v, -u] : f === 1 ? [-1, v, u] : f === 2 ? [u, 1, -v]
          : f === 3 ? [u, -1, v] : f === 4 ? [u, v, 1] : [-u, v, -1];
        const s = Math.sqrt(raw[0] ** 2 + raw[1] ** 2 + raw[2] ** 2);
        const d = [raw[0] / s, raw[1] / s, raw[2] / s];
        const delta = Math.abs(M._of_base_height(forge.live, d[0], d[1], d[2])
          - M._of_base_height(forge.pre, d[0], d[1], d[2]));
        if (delta > 0) ++moved;
        if (delta > worst) worst = delta;
      }
    }
  }
  console.log(`  measured: the swell moves ${moved} of ${FIELD_SAMPLES} samples, `
    + `worst ${worst.toFixed(3)} m; one stamp costs ${costMs.toFixed(3)} ms`);

  ok(moved > 0, 'the shipped binary really carries both arms of WG-275',
    `${moved} samples moved`);
  ok(liveForge !== preForge, 'THE PLANET: the pre-swell field stamps differently',
    `live ${liveForge} vs pre-swell ${preForge}`);
  ok(fieldStampFor(M, M._of_body_create_forge(SEED_LO, SEED_HI)) === liveForge,
    'a second handle on the same body stamps identically');
  // The other half of "not too wide": WG-275 is gated to the planet stack, so a
  // moon world must not be invalidated by it. If this ever goes red, the stamp
  // has become a slot-wide version number wearing a body-scoped name.
  ok(liveCinder === preCinder, 'THE MOON: a planet-gated change does NOT move it',
    `${liveCinder}`);
  ok(liveCinder !== liveForge, 'the two bodies stamp differently from each other');
}

console.log('===== §3 the fixtures: a slot through the load-time decision');

/** A slot with all fifteen body-scoped fields non-empty and a full global half.
 *  Every body key carries something, because an empty world crosses as an empty
 *  world and that is exactly what a clear looks like (PS-52's rule). */
function fixtureSlot(fieldGen) {
  const slot = {
    // --- the global half -----------------------------------------------------
    version: 5, seed: SEED_LO, savedAt: 1_755_000_000_000, mode: 'survival',
    pack: [1, 2, 3, 4, 5], hotbar: { selected: 2, slots: [{ kind: 'drill' }] },
    vitals: { hp: 61, deaths: 2 },
    progress: { techs: [1, 4, 9], milestones: [2], worn: [11, 12, 13, 14],
      skills: [100, 200], appearance: [0, 1, 2, 3, 4] },
    vessels: [{ id: 7 }], player: { lat: -3.4, lon: 150.2, altM: 12 },
    dayT: 0.42102, stationPower: false, assisted: { cheats: ['fly'] },
    body: 0,
    others: [{ body: 1, depletion: [[3, 1]], patches: [], buildings: [],
      machines: [], voxels: { cells: [9, 9], ops: [1] }, fieldGen: 123456 }],
    // --- the body-scoped half, all fifteen ----------------------------------
    depletion: [[4, 2]], patches: [[0, 500]],
    rocks: [[1, 2, 3, 4]], trees: [[5, 6, 7, 8]],
    buildings: [{ kind: 'smelter', pos: [1, 2, 3], cell: '1:2:3', up: [0, 1, 0],
      fwd: [1, 0, 0], patch: -1, ports: true }],
    machines: [{ tier: 1, pos: [4, 5, 6], quat: [0, 0, 0, 1], ore: [1, 2],
      out: [3, 4], fuelTicks: 55 }],
    voxels: { cells: [1, 2, 3, 4, 5, 6], ops: [10, 11] },
    discovery: [7, 7, 7], poi: [1, 2],
    sites: [{ id: 1 }], structures: [{ kind: 'wall' }],
    pads: [{ id: 2 }], health: [['wall:1', 40]],
    stations: [{ pos: [1, 1, 1], quat: [0, 0, 0, 1] }],
    antennas: [{ pos: [2, 2, 2], quat: [0, 0, 0, 1] }],
  };
  if (fieldGen !== undefined) slot.fieldGen = fieldGen;
  return slot;
}

/** Every key of the fixture that is NOT body-scoped, derived from `WORLD_KEYS`
 *  rather than typed out, so a field added to either half is covered here
 *  without this file being edited. */
function globalKeys(slot) {
  return Object.keys(slot).filter((k) => !WORLD_KEYS.includes(k));
}

function globalHalfIntact(before, after, name) {
  const bad = globalKeys(before).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return ok(bad.length === 0, `${name}: the global half is untouched`,
    bad.length ? `differ: ${bad.join(', ')}` : `${globalKeys(before).length} keys equal`);
}

/** The body-scoped fields that are actually HOLDING something. `fieldGen` is
 *  excluded because it is the stamp itself and not content. */
function heldKeys(slot) {
  return WORLD_KEYS.filter((k) => {
    const v = slot[k];
    if (k === 'fieldGen') return false;
    if (v === undefined || v === null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.values(v).some((a) => a.length > 0);
    return true;
  });
}

const BODY_CONTENT_KEYS = WORLD_KEYS.length - 1;

function bodyHalfEmpty(slot, name) {
  const left = heldKeys(slot);
  return ok(left.length === 0, `${name}: every body-scoped field is empty`,
    left.length ? `still holding: ${left.join(', ')}` : `all ${BODY_CONTENT_KEYS} cleared`);
}

// --- A: the pre-swell save, which is every save that exists today -----------
{
  const stored = fixtureSlot(undefined);
  const { view } = adoptWorldFor(stored, 0);
  const verdict = fieldGenVerdict(view.fieldGen, liveForge);
  ok(verdict === 'absent', 'A stampless slot: the verdict is ABSENT, not a match', verdict);
  // THE CONTROL, IN-RUN AND NOT IN A COMMENT. The same view down the path that
  // existed before this lane (no clear at all) still holds every one of the
  // fifteen, so the emptiness asserted below is caused by the clear and not by
  // a fixture that was empty to begin with. A fixture that failed to populate
  // itself would report a pass on a build with the mechanism ripped out.
  ok(heldKeys(view).length === BODY_CONTENT_KEYS,
    'A CONTROL: unchecked, the stale world is all still there',
    `${heldKeys(view).length} of ${BODY_CONTENT_KEYS} held`);
  const cleared = clearedBodyHalf(view, 0, liveForge);
  bodyHalfEmpty(cleared, 'A cleared');
  globalHalfIntact(view, cleared, 'A cleared');
  ok(cleared.fieldGen === liveForge, 'A cleared: the new world carries the LIVE stamp');
  ok(keptWorlds().length === 1 && keptWorlds()[0].body === 1,
    'A: the OTHER body\'s world is carried through untouched by the clear',
    `kept ${JSON.stringify(keptWorlds().map((w) => w.body))}`);
  ok(keptWorlds()[0].fieldGen === 123456,
    'A: and it keeps its own stamp, so it is judged when the player goes there');
}

// --- B: a slot written after this lane, on the field that exists ------------
{
  const stored = fixtureSlot(liveForge);
  const { view } = adoptWorldFor(stored, 0);
  ok(fieldGenVerdict(view.fieldGen, liveForge) === 'match',
    'B post-change slot: the verdict is MATCH');
  ok(JSON.stringify(view) === JSON.stringify(adoptWorldFor(stored, 0).view),
    'B: the view is returned as it was read, field for field');
  ok(view.buildings.length === 1 && view.voxels.cells.length === 6,
    'B: the body-scoped half survives the round trip');
}

// --- C: the REAL mismatch, stamped with the planet that no longer exists ----
{
  const stored = fixtureSlot(preForge);
  const { view } = adoptWorldFor(stored, 0);
  ok(fieldGenVerdict(view.fieldGen, liveForge) === 'differs',
    'C pre-swell-stamped slot: the verdict is DIFFERS');
  const cleared = clearedBodyHalf(view, 0, liveForge);
  bodyHalfEmpty(cleared, 'C cleared');
  globalHalfIntact(view, cleared, 'C cleared');
}

// --- D: a mismatch from the OTHER direction, which is the future case -------
{
  const future = (liveForge + 1) >>> 0;
  const stored = fixtureSlot(future);
  const { view } = adoptWorldFor(stored, 0);
  ok(fieldGenVerdict(view.fieldGen, liveForge) === 'differs',
    'D a slot from a field this build does not have: the verdict is DIFFERS');
  const cleared = clearedBodyHalf(view, 0, liveForge);
  bodyHalfEmpty(cleared, 'D cleared');
  globalHalfIntact(view, cleared, 'D cleared');
}

// --- E: a moon world stamped before the swell is STILL VALID ----------------
{
  const preCinderStamp = fieldStampFor(M, cinder.pre);
  const stored = { ...fixtureSlot(preCinderStamp), body: 1, others: [] };
  const { view } = adoptWorldFor(stored, 1);
  ok(fieldGenVerdict(view.fieldGen, fieldStampFor(M, cinder.live)) === 'match',
    'E a moon world authored before WG-275 is NOT invalidated by it');
}

console.log('===== §4 SAVE_VERSION did not move');
{
  // A SOURCE check and it says so: the runtime one is `PersistSlot`'s receipt
  // (`version` on the save summary, PH-366), which needs a browser. This is the
  // cheap half, and the claim it guards is the one this lane must not get
  // wrong: the stamp is additive and optional, so a bump would destroy every
  // world for a field nothing misreads.
  const text = readFileSync(join(webRoot, 'src', 'game', 'SaveGame.ts'), 'utf8');
  const m = /export const SAVE_VERSION = (\d+);/.exec(text);
  ok(m !== null && m[1] === '5', 'SaveGame.ts still declares SAVE_VERSION = 5',
    m ? m[1] : 'not found');
  const types = readFileSync(join(webRoot, 'src', 'game', 'SaveGameTypes.ts'), 'utf8');
  ok(/\n  fieldGen\?: number;/.test(types), 'the stamp is an OPTIONAL field');
}

console.log(`\n${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
