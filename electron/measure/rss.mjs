// PROCESS memory, not heap memory (DW-27 spike, Q1).
//
// `performance.memory` reports the renderer's JS heap and nothing else. What a
// player sees in Task Manager, and what a Steam review complains about, is the
// working set of the whole process tree: main, renderer, GPU process, network
// service and utility processes. Electron's multi-process architecture is
// exactly where a "but it is only 90 MB of JS heap" claim goes wrong, so this
// sums the real thing.
//
//   node measure/rss.mjs [--exe=out/OrbitalFoundry-win32-x64/OrbitalFoundry.exe] [--settle=45]

import { spawn, execFileSync } from 'node:child_process';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const shellDir = resolve(here, '..');
const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
const EXE = args.get('exe') ?? 'out/OrbitalFoundry-win32-x64/OrbitalFoundry.exe';
const bin = resolve(shellDir, EXE);
const SETTLE = Number(args.get('settle') ?? 45);
const name = basename(bin).replace(/\.exe$/i, '');

const sumWorkingSet = () => {
  // -ErrorAction SilentlyContinue would still fail the tool on a non-terminating
  // error, so this is written to succeed with an empty list.
  const ps = `try { $p = Get-Process -Name '${name}' -ErrorAction Stop } catch { $p = @() }; `
    + `$rows = @($p | ForEach-Object { [pscustomobject]@{ id=$_.Id; ws=$_.WorkingSet64; pm=$_.PrivateMemorySize64 } }); `
    + `ConvertTo-Json -InputObject @{ n = $rows.Count; totalWS = ($rows | Measure-Object -Property ws -Sum).Sum; `
    + `totalPM = ($rows | Measure-Object -Property pm -Sum).Sum; rows = $rows } -Depth 4 -Compress`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  return JSON.parse(out);
};

const MB = (b) => (typeof b === 'number' ? +(b / 1048576).toFixed(1) : null);

const child = spawn(bin, ['--origin=protocol', '--offscreen', '--focusable',
  `--user-data-dir=${resolve(tmpdir(), `of-rss-${Date.now()}`)}`],
{ cwd: shellDir, stdio: ['pipe', 'pipe', 'ignore'] });

let firstFrame = false;
child.stdout.on('data', (d) => { if (String(d).includes('OF_FIRSTFRAME')) firstFrame = true; });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 600 && !firstFrame; ++i) await wait(100);
await wait(1500);
const atRest = sumWorkingSet();
await wait(SETTLE * 1000);
const later = sumWorkingSet();

try { child.stdin.write('quit\n'); } catch (_) {}
await wait(600);
try { child.kill(); } catch (_) {}

console.log(JSON.stringify({
  exe: bin,
  reachedFirstFrame: firstFrame,
  processes: atRest.n,
  atRest: { workingSetMB: MB(atRest.totalWS), privateBytesMB: MB(atRest.totalPM),
    perProcessMB: (atRest.rows ?? []).map((r) => MB(r.ws)) },
  [`after${SETTLE}s`]: { workingSetMB: MB(later.totalWS), privateBytesMB: MB(later.totalPM),
    perProcessMB: (later.rows ?? []).map((r) => MB(r.ws)) },
  note: 'sum of WorkingSet64 across every process of the tree, i.e. the Task Manager number',
}, null, 2));
