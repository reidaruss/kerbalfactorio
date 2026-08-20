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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

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
  const res = spawnSync('npm', ['run', name], {
    cwd: webRoot,
    stdio: 'inherit',
    shell: true,
  });
  const ms = Date.now() - start;
  // spawnSync itself can fail to launch (res.error), which counts as a
  // failure of that link rather than crashing the whole runner.
  const code = res.error ? 1 : res.status ?? 1;
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
