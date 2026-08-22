// BT-250 to BT-254: `npm run check` was an && chain, so the first red link
// (check:limits, red since BT-42, 54 files over the 400-line cap) silently
// stopped every link after it from ever running. This runner replaces the
// && chain: every link below always runs, in order, and their results
// aggregate into one honest PASS/FAIL summary with a nonzero exit code if
// any link failed. check:limits is expected to stay red until BT-42's own
// debt is paid; that is not this runner's job to fix, hide, or skip.
//
// Each entry runs the exact `npm run <script>` a developer would run by
// hand, so `check:*` scripts stay individually invocable with unchanged
// meaning; this file only owns the ordering, the "run everything anyway",
// and the summary.
//
// Cross-platform on purpose (this repo runs on Reid's Windows box and on
// the Proxmox Linux VM, see CLAUDE.md): plain node child_process, no shell
// script of our own, no bash-only syntax. `npm` on Windows is actually
// `npm.cmd`, a batch file, and Windows cannot CreateProcess a .cmd directly
// (node's spawnSync throws EINVAL if you try) -- it needs an interpreter,
// which is what `shell: true` supplies (cmd.exe on Windows, /bin/sh on
// Linux/macOS). That is the one shell dependency here, and it is node's
// own cross-platform shell selection, not a bash-specific script.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// BT-310 to BT-314. check:roles failed once, transiently, on the first
// check-all invocation right after a merge commit, then passed standalone
// seconds later and on a full rerun -- twice, unreproduced on demand after a
// real effort (see check-roles.mjs's own header). check-roles.mjs now prints
// a DIAG_JSON line (file hashes, models-dir listing digest, git HEAD) on
// every failure path, but that only helps if it survives past the console
// scrollback. So check:roles alone runs captured instead of inherited, and
// on a nonzero exit its full output (which already carries the diagnostic,
// since check-roles.mjs is the thing that printed it) is written to a
// timestamped file under CHECK_ROLES_DIAG_DIR, gitignored, so a third
// sighting leaves a trail instead of another "did not reproduce."
const CHECK_ROLES_DIAG_DIR = join(webRoot, 'scripts', 'check-roles-diag');

function persistCheckRolesFailure(stdout, stderr, code) {
  try {
    mkdirSync(CHECK_ROLES_DIAG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(CHECK_ROLES_DIAG_DIR, `check-roles-fail-${stamp}.log`);
    const body = `exit ${code} at ${new Date().toISOString()}\n\n`
      + `----- stdout -----\n${stdout}\n----- stderr -----\n${stderr}\n`;
    writeFileSync(file, body, 'utf8');
    console.error(`check-all: check:roles failed; full output (with its DIAG_JSON `
      + `line) persisted to ${file}`);
  } catch (e) {
    // Never let the diagnostic itself take down the run; say so and move on.
    console.error(`check-all: could not persist the check:roles failure diagnostic: ${e.message}`);
  }
}

// Same order as the old && chain in package.json. Kept as data so a
// subset can be selected with --only for local debugging; the default
// (no --only) is every link, every time, which is the whole point.
const ALL_CHECKS = [
  'check:roles',
  'check:probes',
  'check:proxies',
  // RN-2200. The prop LOD ladder's grouping rule, asserted both ways against a
  // three-rung asset. It is a LINK and not a probe because the defect it guards
  // is invisible to any probe run against the shipped atlases: they ship two
  // rungs, and two rungs group identically under the broken rule and the fixed
  // one. Cheap (no build, no browser), so it runs beside the other static gates.
  'check:proplods',
  // PS-53. The field-generation stamp, both directions, against the shipped
  // wasm's own pre-swell arm. It is a LINK and not a probe for `check:proplods`'
  // reason one domain over: the decision it guards is pure data over a
  // `SaveSlot`, so a browser would be a slow test of the browser, and the
  // persistence gates that DO need one (`twobody.mjs`, `probes/bodyfields.js`,
  // `probes/fieldstamp.js`) cost minutes and cannot sit here. Cheap: no build,
  // no browser, about a second including instantiating the module.
  'check:fieldstamp',
  'typecheck',
  'check:pose',
  'check:limits',
  'check:boot',
];

function parseOnly(argv) {
  const arg = argv.find((a) => a.startsWith('--only='));
  if (!arg) return ALL_CHECKS;
  const names = arg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = names.filter((n) => !ALL_CHECKS.includes(n));
  if (unknown.length) {
    console.error(`check-all: unknown check(s) in --only: ${unknown.join(', ')}`);
    process.exit(2);
  }
  return names;
}

const checks = parseOnly(process.argv.slice(2));

const results = [];
for (const name of checks) {
  console.log(`\n----- ${name} -----`);
  const start = Date.now();
  // check:roles is captured rather than inherited so a red run's output (and
  // the DIAG_JSON line it now always prints on failure, BT-310) can be
  // persisted below instead of only ever existing as console scrollback.
  // Every other link is unchanged: live 'inherit' passthrough.
  const captureForDiag = name === 'check:roles';
  const res = spawnSync('npm', ['run', name], {
    cwd: webRoot,
    stdio: captureForDiag ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    shell: true,
    encoding: captureForDiag ? 'utf8' : undefined,
  });
  const ms = Date.now() - start;
  // spawnSync itself can fail to launch (res.error), which counts as a
  // failure of that link rather than crashing the whole runner.
  const code = res.error ? 1 : res.status ?? 1;
  if (captureForDiag) {
    // Echo what 'inherit' would have streamed live, so console output for a
    // developer watching check-all run is otherwise unchanged.
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    if (code !== 0) persistCheckRolesFailure(res.stdout ?? '', res.stderr ?? '', code);
  }
  results.push({ name, ok: code === 0, code, ms });
}

console.log('\n==================== check summary ====================');
for (const r of results) {
  const status = r.ok ? 'PASS' : 'FAIL';
  const seconds = (r.ms / 1000).toFixed(1);
  console.log(`${status}  ${r.name.padEnd(14)} (${seconds}s, exit ${r.code})`);
}
const failed = results.filter((r) => !r.ok);
console.log('=========================================================');
console.log(`${results.length} checks: ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((r) => r.name).join(', ')}`);
}

process.exit(failed.length ? 1 : 0);
