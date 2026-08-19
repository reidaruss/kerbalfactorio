// RN-951. THE ROLE TABLES AGREE, PROVEN AT BUILD TIME AND OFF THE SHIPPED BYTES.
//
// WHY THIS EXISTS, and it is not because the check was missing.
//
// The client ALREADY compares its `ROLE_FAMILY` against the shipped
// `surfaces.json` (`verifyAgainstManifest`), already names the disagreeing role
// and both sides of it, and already emits a `console.error` that `run.mjs`
// turns into a failed smoke run. That check was correct and it worked: when
// `SuitGrime` was added to texgen's table and to the manifest and not to the
// client, it said so, in those words, on every single boot.
//
// It still shipped. The drift lived in main long enough for a whole night of
// work on the player's hands to be invisible in game, because:
//
//   1. The check runs in a BROWSER, at RUNTIME, after an async `fetch`. Nothing
//      in `npm run check` (`check:proxies`, `typecheck`, `check:limits`,
//      `check:boot`) reaches it, and nothing in an editor does. The only thing
//      that reads it is a smoke run someone chooses to do.
//   2. Its verdict is a `console.error` among other console output, which is a
//      thing a human scrolls past. A non-zero exit is not.
//   3. The half of it that catches an UNKNOWN role (`familyForRole`) only fires
//      if something actually renders with that role in that scenario. It is a
//      coverage-dependent check on an asset-dependent fact.
//
// The fix is not a better runtime check. It is to notice that BOTH TABLES ARE
// STATIC TEXT IN THIS REPOSITORY and comparing them needs no browser, no GPU,
// no dev server and no scenario. So this runs in `npm run check`, before the
// build, and exits non-zero.
//
// AND IT COMPARES THREE TABLES, NOT TWO, because two of them agreeing is not
// the property that matters. The property that matters is that every role the
// GAME CAN ACTUALLY ENCOUNTER is known to the client, and the authority on that
// is neither table: it is the 52 shipped `.glb` binaries, whose glTF material
// names are what `familyForRole` is handed at runtime. Measuring from the bytes
// rather than from a generator's source is the same rule the terrain lanes
// adopted tonight, and it is what makes this gate independent of `tools/blender`
// being mid-edit.
//
//   A. the shipped bytes   `assets/models/dist/**/*.glb` material names
//   B. the manifest        `assets/textures/dist/surfaces.json` roles+flat_roles
//   C. the client          `ROLE_FAMILY` in web/src/render/instancing/SurfaceRoles.ts
//   D. the SERVED manifest `web/public/assets/textures/surfaces.json`, if synced
//
// A role in A and not in B is an asset using a surface texgen has never heard
// of. A role in A and not in C draws untextured. B and C disagreeing is the
// SuitGrime defect exactly. D disagreeing with B means `sync-assets` has not
// been run, so the browser resolves roles from an older table than the one
// this gate just validated, and every verdict above it is about a file the
// game does not read. All four are one exit code.
//
// POSITIVE CONTROL (INSTRUMENTS.md). A gate that dies before its assertions is
// indistinguishable from a gate that ran them all, so this refuses to pass on
// trivial input: it asserts it actually parsed at least MIN_GLB binaries,
// MIN_ROLES manifest entries and MIN_CLIENT client entries, and it PRINTS those
// three counts on success. A regex that stopped matching, a path that moved, or
// a glob that found nothing now reads as a failure instead of as a clean sweep
// over an empty set.
//
// REFUSING CASE (INSTRUMENTS.md). `--selftest` runs the same comparison
// function over seven synthetic fixtures, one per failure mode: six must be
// REFUSED and one clean fixture must PASS. It runs in the same invocation as
// the real check by default, so the proof that this gate can say no is
// produced every time it says yes. It also refused the real repository before
// the fix landed, naming `SuitGrime` and the exact line to add, which is a
// refusing case against the real thing rather than against a fixture.
//
//   node scripts/check-roles.mjs            check the repo (and self-test)
//   node scripts/check-roles.mjs --selftest only the self-test
//   node scripts/check-roles.mjs --json     machine-readable report

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const MODELS = resolve(repoRoot, 'assets', 'models', 'dist');
const MANIFEST = resolve(repoRoot, 'assets', 'textures', 'dist', 'surfaces.json');
const CLIENT = resolve(repoRoot, 'web', 'src', 'render', 'instancing', 'SurfaceRoles.ts');
// What the browser actually FETCHES. `sync-assets.mjs` copies the source
// manifest here and the client reads `assets/textures/surfaces.json` at
// runtime, so a tree where sync-assets has not been re-run serves an older
// table than the one this gate just validated. That is not hypothetical: on
// 2026-08-03 the repository's own working tree served a manifest without
// `SuitGrime` while the source manifest had carried it since RN-859, which is
// why the runtime `verifyAgainstManifest` stayed quiet in a hand-driven dev
// server and only spoke in a freshly synced one. Checked only if present,
// because a clean checkout has not run sync-assets yet and that is fine.
const SERVED = resolve(repoRoot, 'web', 'public', 'assets', 'textures', 'surfaces.json');

// The positive control's floors. Deliberately well under the current values
// (52 / 41 / 41) so a real asset being retired is not a false alarm, and
// deliberately well over zero so a broken parse cannot pass.
const MIN_GLB = 30;
const MIN_ROLES = 25;
const MIN_CLIENT = 25;

// ---------------------------------------------------------------------------
// A. the shipped bytes
// ---------------------------------------------------------------------------

/** Every .glb under a directory, recursively, sorted for a stable report. */
function findGlb(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.glb')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * The glTF JSON chunk of a binary .glb, parsed.
 *
 * Deliberately strict. A .glb this cannot read is a THROW and not a skip: the
 * whole value of reading the bytes is that the set is complete, and a silently
 * skipped binary is a role this gate cannot see.
 */
function gltfJson(path) {
  const b = readFileSync(path);
  if (b.length < 20 || b.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error(`${path}: not a binary glTF (magic is not 'glTF')`);
  }
  const version = b.readUInt32LE(4);
  if (version !== 2) throw new Error(`${path}: glTF version ${version}, expected 2`);
  let off = 12;
  while (off + 8 <= b.length) {
    const len = b.readUInt32LE(off);
    const type = b.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) {           // 'JSON'
      return JSON.parse(b.toString('utf8', off + 8, off + 8 + len));
    }
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  throw new Error(`${path}: no JSON chunk`);
}

/** `OF_SteelDark` -> `SteelDark`. Must match SurfaceRoles.ts roleOfMaterialName. */
const roleOfMaterialName = (n) => (n.startsWith('OF_') ? n.slice(3) : n);

function shippedRoles(files) {
  const byRole = new Map();
  for (const f of files) {
    const js = gltfJson(f);
    for (const m of js.materials ?? []) {
      const role = roleOfMaterialName(m.name ?? '');
      if (role === '') continue;
      if (!byRole.has(role)) byRole.set(role, []);
      const rel = relative(repoRoot, f).split(sep).join('/');
      if (!byRole.get(role).includes(rel)) byRole.get(role).push(rel);
    }
  }
  return byRole;
}

// ---------------------------------------------------------------------------
// C. the client table
// ---------------------------------------------------------------------------

/**
 * `ROLE_FAMILY` out of SurfaceRoles.ts, without a TypeScript parser.
 *
 * The brittleness here is real and it is handled by the positive control rather
 * than by cleverness: if this regex stops matching the file, it returns a table
 * far smaller than MIN_CLIENT and the run FAILS. It cannot return a small-but-
 * plausible table, because the object is one contiguous literal.
 *
 * Comments are stripped first, and that is load-bearing: this file's own
 * comments quote role names and family names next to each other in prose
 * (`RN-742: the HOST ROCK roles leave 'coarse'...`), so a naive match over the
 * raw text invents entries.
 */
function parseClientTable(src) {
  const start = src.indexOf('const ROLE_FAMILY');
  if (start === -1) throw new Error('SurfaceRoles.ts: no `const ROLE_FAMILY` found');
  const open = src.indexOf('{', start);
  if (open === -1) throw new Error('SurfaceRoles.ts: ROLE_FAMILY has no `{`');
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; ++i) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('SurfaceRoles.ts: ROLE_FAMILY is not closed');
  const body = src.slice(open + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const table = new Map();
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([a-z]+)'/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (table.has(m[1])) throw new Error(`SurfaceRoles.ts: role '${m[1]}' listed twice in ROLE_FAMILY`);
    table.set(m[1], m[2]);
  }
  return table;
}

// ---------------------------------------------------------------------------
// The comparison. One pure function, so the self-test exercises the SAME code
// the real check runs and not a paraphrase of it.
// ---------------------------------------------------------------------------

/**
 * @param {Map<string,string[]>} shipped  role -> the .glb files that use it
 * @param {{roles:Object, flat_roles:Object, families:Object}} manifest
 * @param {Map<string,string>} client     role -> family
 * @returns {string[]} one line per disagreement; empty means agreement
 */
export function compareRoleTables(shipped, manifest, client) {
  const fails = [];
  const mRoles = manifest.roles ?? {};
  const mFlat = manifest.flat_roles ?? {};
  const mFamilies = new Set(Object.keys(manifest.families ?? {}));

  // A vs B and A vs C: a role the game can actually encounter.
  for (const [role, files] of [...shipped].sort((a, b) => a[0].localeCompare(b[0]))) {
    const where = files.length > 3
      ? `${files.slice(0, 3).join(', ')} +${files.length - 3} more`
      : files.join(', ');
    if (mRoles[role] === undefined && mFlat[role] === undefined) {
      fails.push(`SHIPPED role '${role}' is in NEITHER surfaces.json roles nor `
        + `flat_roles. texgen.py has never heard of it. Used by: ${where}`);
    }
    if (!client.has(role)) {
      fails.push(`SHIPPED role '${role}' is absent from ROLE_FAMILY in `
        + `SurfaceRoles.ts, so it DRAWS UNTEXTURED in game. Used by: ${where}`);
    }
  }

  // B vs C, both directions. This is the SuitGrime defect exactly, and it is
  // kept separate from the two above because a role can drift between the
  // manifest and the client while no asset uses it yet, and catching it then
  // is cheaper than catching it when the asset lands.
  for (const [role, fam] of Object.entries(mRoles)) {
    const c = client.get(role);
    if (c === undefined) {
      fails.push(`MANIFEST role '${role}' -> '${fam}' is absent from ROLE_FAMILY `
        + `in SurfaceRoles.ts. Add \`${role}: '${fam}',\``);
    } else if (c !== fam) {
      fails.push(`role '${role}': surfaces.json says '${fam}', SurfaceRoles.ts says '${c}'`);
    }
    if (!mFamilies.has(fam)) {
      fails.push(`MANIFEST role '${role}' names family '${fam}', which surfaces.json `
        + `does not declare. Declared: ${[...mFamilies].join(', ')}`);
    }
  }
  for (const role of Object.keys(mFlat)) {
    const c = client.get(role);
    if (c === undefined) {
      fails.push(`MANIFEST flat role '${role}' is absent from ROLE_FAMILY in `
        + `SurfaceRoles.ts. Add \`${role}: 'flat',\``);
    } else if (c !== 'flat') {
      fails.push(`role '${role}': surfaces.json leaves it FLAT, SurfaceRoles.ts says '${c}'`);
    }
  }
  for (const [role, fam] of client) {
    if (mRoles[role] === undefined && mFlat[role] === undefined) {
      fails.push(`CLIENT-ONLY role '${role}' -> '${fam}' in SurfaceRoles.ts is absent `
        + `from surfaces.json entirely`);
    }
  }
  return fails;
}

// ---------------------------------------------------------------------------
// The refusing case, proven in the same invocation that proves the passing one.
// ---------------------------------------------------------------------------

function selftest() {
  const base = () => ({
    shipped: new Map([['Steel', ['a.glb']], ['Glass', ['b.glb']]]),
    manifest: {
      families: { panel: {} },
      roles: { Steel: 'panel' },
      flat_roles: { Glass: 'deliberately unmapped' },
    },
    client: new Map([['Steel', 'panel'], ['Glass', 'flat']]),
  });

  const cases = [
    ['a clean set passes', (f) => f, 0],
    // The actual SuitGrime shape: manifest and texgen moved, client did not.
    ['manifest role missing from the client', (f) => {
      f.manifest.roles.SuitGrime = 'suitfab';
      f.manifest.families.suitfab = {};
      return f;
    }, 1],
    // The same drift, but the asset has ALSO shipped, so both halves fire.
    ['a shipped role the client does not know', (f) => {
      f.shipped.set('SuitGrime', ['player_fp_arms.glb']);
      f.manifest.roles.SuitGrime = 'suitfab';
      f.manifest.families.suitfab = {};
      return f;
    }, 2],
    // An asset using a role texgen has never seen at all.
    ['a shipped role in neither table', (f) => {
      f.shipped.set('Velvet', ['sofa.glb']);
      return f;
    }, 2],
    // The two tables disagreeing on WHICH family, which no count-based check
    // would notice because both sides have the same number of rows.
    ['the two tables name different families', (f) => {
      f.client.set('Steel', 'coarse');
      return f;
    }, 1],
    // A family named by a role but never declared: a typo in texgen's table
    // that would load nothing and bind nothing.
    ['a role naming an undeclared family', (f) => {
      f.manifest.roles.Steel = 'pannel';
      f.client.set('Steel', 'pannel');
      return f;
    }, 1],
    // A client entry with no manifest counterpart: the reverse drift.
    ['a client-only role', (f) => {
      f.client.set('Ghost', 'panel');
      return f;
    }, 1],
  ];

  const lines = [];
  let bad = 0;
  for (const [name, mutate, wantMin] of cases) {
    const f = mutate(base());
    const fails = compareRoleTables(f.shipped, f.manifest, f.client);
    const ok = wantMin === 0 ? fails.length === 0 : fails.length >= wantMin;
    if (!ok) bad++;
    lines.push(`  ${ok ? 'ok  ' : 'FAIL'} ${name}: ${fails.length} refusal(s)`
      + (fails.length > 0 ? ` -> ${fails[0]}` : ''));
  }
  return { bad, lines, count: cases.length };
}

// ---------------------------------------------------------------------------

const argv = new Set(process.argv.slice(2));
const asJson = argv.has('--json');

const st = selftest();
if (!asJson) {
  console.log(`check-roles: self-test, ${st.count} fixtures `
    + `(1 must pass, ${st.count - 1} must be refused)`);
  for (const l of st.lines) console.log(l);
}
if (st.bad > 0) {
  console.error(`check-roles: SELF-TEST FAILED on ${st.bad} fixture(s). The gate `
    + `cannot be trusted to refuse, so its verdict on the repo is meaningless.`);
  process.exit(2);
}
if (argv.has('--selftest')) {
  console.log('check-roles: self-test only, PASS');
  process.exit(0);
}

let files;
let shipped;
let manifest;
let client;
try {
  files = findGlb(MODELS);
  shipped = shippedRoles(files);
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  client = parseClientTable(readFileSync(CLIENT, 'utf8'));
} catch (e) {
  console.error(`check-roles: could not read the inputs: ${e.message}`);
  process.exit(2);
}

// THE POSITIVE CONTROL. Everything below this point is a comparison over three
// sets, and a comparison over three empty sets passes. These three numbers are
// the proof that the run reached its assertions with real data in hand, and
// they are printed on success so a reader can see it did.
const counts = {
  glb: files.length,
  shippedRoles: shipped.size,
  manifestRoles: Object.keys(manifest.roles ?? {}).length
    + Object.keys(manifest.flat_roles ?? {}).length,
  clientRoles: client.size,
};
const vacuous = [];
if (counts.glb < MIN_GLB) vacuous.push(`only ${counts.glb} .glb found under ${MODELS} (expected >= ${MIN_GLB})`);
if (counts.manifestRoles < MIN_ROLES) vacuous.push(`only ${counts.manifestRoles} manifest roles (expected >= ${MIN_ROLES})`);
if (counts.clientRoles < MIN_CLIENT) vacuous.push(`only ${counts.clientRoles} roles parsed out of ROLE_FAMILY (expected >= ${MIN_CLIENT}); the parser has probably stopped matching SurfaceRoles.ts`);
if (vacuous.length > 0) {
  console.error('check-roles: REFUSING TO PASS ON TRIVIAL INPUT. A comparison over '
    + 'an empty set succeeds and means nothing:');
  for (const v of vacuous) console.error(`  ${v}`);
  process.exit(2);
}

const fails = compareRoleTables(shipped, manifest, client);

// The served copy, if `sync-assets` has been run in this tree. Compared as
// TABLES rather than as bytes: the two files are byte-identical today, but a
// byte compare would fail on a re-serialisation that changed nothing, and the
// property that matters is that the browser resolves every role the same way
// this gate just did.
let servedNote = 'not synced (web/public has no manifest yet)';
if (existsSync(SERVED)) {
  try {
    const s = JSON.parse(readFileSync(SERVED, 'utf8'));
    const drift = [];
    const all = new Set([
      ...Object.keys(manifest.roles ?? {}), ...Object.keys(manifest.flat_roles ?? {}),
      ...Object.keys(s.roles ?? {}), ...Object.keys(s.flat_roles ?? {}),
    ]);
    const fam = (m, r) => (m.roles?.[r] ?? (m.flat_roles?.[r] !== undefined ? 'flat' : 'ABSENT'));
    for (const r of [...all].sort()) {
      const a = fam(manifest, r);
      const b = fam(s, r);
      if (a !== b) drift.push(`role '${r}': assets/textures/dist says '${a}', web/public says '${b}'`);
    }
    if (drift.length > 0) {
      for (const d of drift) {
        fails.push(`STALE SERVED MANIFEST: ${d}. The browser fetches the `
          + `web/public copy, so it is the one that decides. Run \`npm run sync-assets\`.`);
      }
      servedNote = `STALE, ${drift.length} role(s) differ`;
    } else {
      servedNote = `in sync (${all.size} roles)`;
    }
  } catch (e) {
    fails.push(`the served manifest at ${SERVED} could not be read: ${e.message}`);
    servedNote = 'unreadable';
  }
}

if (asJson) {
  console.log(JSON.stringify({ counts, served: servedNote, fails, selftest: st.count, pass: fails.length === 0 }, null, 2));
  process.exit(fails.length === 0 ? 0 : 1);
}

if (fails.length > 0) {
  console.error(`check-roles: FAILED, ${fails.length} disagreement(s) between the `
    + `shipped .glb material names, assets/textures/dist/surfaces.json and `
    + `ROLE_FAMILY in web/src/render/instancing/SurfaceRoles.ts:`);
  for (const f of fails) console.error(`  ${f}`);
  console.error('check-roles: a role the client does not know draws UNTEXTURED. '
    + 'The client says so at runtime too, but only in a browser console, which is '
    + 'why this runs in `npm run check`.');
  process.exit(1);
}

console.log(`check-roles: PASS. ${counts.glb} .glb -> ${counts.shippedRoles} shipped `
  + `roles; ${counts.manifestRoles} in surfaces.json; ${counts.clientRoles} in `
  + `ROLE_FAMILY. All three agree. Served manifest: ${servedNote}.`);
