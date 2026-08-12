// `npm run check` (BT-8x, BT-41 point 6). Was `check:roles && check:proxies &&
// typecheck && check:pose && check:limits && check:boot`, an `&&` CHAIN, so a
// red link hid every link after it from EVER RUNNING for anybody. Measured at
// BT-42: `check:boot` was wired in at 2026-07-27 and `check:limits` went red
// eleven commits later, so the one gate that proves the app STARTS ran for
// eleven commits out of 415 and was decoration for the rest. This runs every
// link UNCONDITIONALLY, prints one PASS/FAIL table, and exits 1 if any link
// failed, so a red link is visible instead of silently gating what comes
// after it, and so every link's own state is known on every run.
//
//   node scripts/check-all.mjs
//
// Each link runs as its own child process (`spawnSync`), not imported: three
// of these six call `process.exit` directly (check-roles, check-proxies,
// posecheck), and importing a module that calls `process.exit` would kill
// this runner before the remaining links ever got a turn, which is exactly
// the failure this file exists to remove.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(webDir, 'node_modules', '.bin', 'tsc');

const LINKS = [
  { name: 'check:roles', argv: [process.execPath, ['scripts/check-roles.mjs']] },
  { name: 'check:proxies', argv: [process.execPath, ['scripts/check-proxies.mjs']] },
  { name: 'typecheck', argv: [tsc, ['--noEmit']] },
  { name: 'check:pose', argv: [process.execPath, ['tools/smoke/posecheck.mjs']] },
  { name: 'check:limits', argv: [process.execPath, ['scripts/check-limits.mjs']] },
  { name: 'check:boot', argv: [process.execPath, ['tools/smoke/boot.mjs']] },
];

const results = [];
for (const link of LINKS) {
  const t0 = performance.now();
  const [cmd, args] = link.argv;
  const r = spawnSync(cmd, args, { cwd: webDir, encoding: 'utf8' });
  const ms = Math.round(performance.now() - t0);
  const pass = r.status === 0;
  results.push({ name: link.name, pass, status: r.status, ms });
  console.error(`check-all: ${pass ? 'PASS' : 'FAIL'}  ${link.name}  (${ms} ms, exit ${r.status ?? '(spawn error)'})`);
  if (!pass) {
    // The link's own output, not swallowed: a table entry that says FAIL with
    // no detail is exactly the "verdict nothing acts on" BT-42 is about.
    if (r.stdout) process.stderr.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.error) console.error(`  spawn error: ${r.error.message}`);
  }
}

console.error('');
console.error('check-all: PASS/FAIL table');
const w = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  console.error(`  ${(r.pass ? 'PASS' : 'FAIL').padEnd(4)}  ${r.name.padEnd(w)}  exit ${String(r.status)}  ${r.ms} ms`);
}
const failed = results.filter((r) => !r.pass);
console.error(`check-all: ${results.length - failed.length}/${results.length} green`);
process.exit(failed.length === 0 ? 0 : 1);
