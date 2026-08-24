// RN-2740. THE SERVER CHECK FOR A LANE THAT SERVES TWO BUILDS AT ONCE.
//
// `rn2560sentinel.mjs` is the same three checks and is the right tool whenever
// there is ONE server on the tracked `web/dist`. It resolves `dist` from its
// own file location and cannot be pointed anywhere else, so a two-arm lane --
// base in one scratch directory, head in another, one `vite preview --outDir`
// per arm -- has no way to use it, and the alternative is the thing NUMBERS.md
// exists to prevent: measuring two arms against whichever build a port happens
// to be serving.
//
// SAME THREE PROPERTIES, SAME REASONS, all three of them NUMBERS.md entries:
//
//   * `vite preview` SNAPSHOTS its outDir at startup, so a rebuild under a
//     running server keeps serving the old page. The token is therefore
//     compared OVER THE WIRE against the token on disk, never by reading the
//     file twice.
//   * `vite preview` SPA-falls-back with HTTP 200 for any missing path, so a
//     status code proves nothing. Only content counts.
//   * a dead server frees its port for another lane, so the port's owning PID
//     is compared against the PID this lane started.
//
// AND ONE MORE, WHICH IS WHY THIS LANE NEEDED A SENTINEL AT ALL. The arms in
// RN-2740 differ ONLY in a texture manifest and three PNGs; the bundle hash
// moves too (SurfaceRoles.ts is in it), but the manifest is the payload. So
// `--asset=` names extra served paths to fetch and sha256-compare against the
// same file inside the served outDir, and this lane passes
// `assets/textures/surfaces.json`. A wrong-arm server whose bundle happened to
// match would still be caught by the manifest.
//
// Usage:
//   node tools/smoke/rn2740sentinel.mjs --port=5741 --pid=1234 \
//     --dist=../../../../scratch/dist-head \
//     --asset=assets/textures/surfaces.json
//
// `--dist` is resolved against THIS FILE's directory. Exit status is 0 only
// when every check agrees.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = new Map();
const assets = [];
for (const a of process.argv.slice(2)) {
  const i = a.indexOf('=');
  const k = i === -1 ? a : a.slice(0, i);
  const v = i === -1 ? '1' : a.slice(i + 1);
  if (k === '--asset') assets.push(v); else argv.set(k, v);
}
const port = Number(argv.get('--port') ?? 0);
const pid = argv.get('--pid') ?? '';
const name = argv.get('--file') ?? 'of-sentinel-rn2740.txt';
const dist = path.resolve(HERE, argv.get('--dist') ?? path.join('..', '..', 'dist'));
if (!port) {
  console.error('usage: node tools/smoke/rn2740sentinel.mjs --port= --pid= '
    + '--dist= [--asset=path ...]');
  process.exit(2);
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const lines = [];
let ok = true;
const say = (good, label, detail) => {
  ok = ok && good;
  lines.push(`  [${good ? 'ok' : 'FAIL'}] ${label.padEnd(22)} ${detail}`);
};

// 1. THE TOKEN, over the wire.
const tokenPath = path.join(dist, name);
if (!existsSync(tokenPath)) {
  say(false, 'sentinel token', `MISSING on disk: ${tokenPath}. Write one into `
    + 'the outDir before serving it; a sentinel that is absent cannot fail.');
} else {
  const want = readFileSync(tokenPath, 'utf8').trim();
  let got = '';
  try {
    got = (await (await fetch(`http://127.0.0.1:${port}/${name}`)).text()).trim();
  } catch (e) { got = `<fetch failed: ${e.message}>`; }
  say(got === want && want.length > 0, 'sentinel token',
    got === want ? `${want} over the wire` : `disk ${want} != wire ${got}`);
}

// 2. THE ENTRY CHUNK NAME, served against built.
const built = readdirSync(path.join(dist, 'assets'))
  .filter((f) => /^index-.*\.js$/.test(f)).sort();
let served = [];
try {
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  served = [...new Set([...html.matchAll(/index-[A-Za-z0-9_-]+\.js/g)]
    .map((m) => m[0]))].sort();
} catch (e) { served = [`<fetch failed: ${e.message}>`]; }
say(built.length > 0 && built.length === served.length
  && built.every((b, i) => b === served[i]), 'entry chunk',
  `built ${built.join(',')} served ${served.join(',')}`);

// 3. EVERY NAMED ASSET, byte for byte.
for (const rel of assets) {
  const onDisk = path.join(dist, rel);
  if (!existsSync(onDisk)) {
    say(false, `asset ${rel}`, `MISSING in ${dist}`);
    continue;
  }
  let wire = null;
  try {
    wire = Buffer.from(await (await fetch(`http://127.0.0.1:${port}/${rel}`))
      .arrayBuffer());
  } catch (e) { say(false, `asset ${rel}`, `fetch failed: ${e.message}`); continue; }
  const a = sha(readFileSync(onDisk));
  const b = sha(wire);
  say(a === b, `asset ${rel}`,
    a === b ? `sha ${a.slice(0, 16)} (${wire.length} B)`
      : `disk ${a.slice(0, 16)} != wire ${b.slice(0, 16)}`);
}

// 4. THE PORT'S OWNER, AND WHAT THAT PROCESS WAS ACTUALLY TOLD TO SERVE.
//
// `--pid=` alone is a WEAK check and this lane found out the honest way: the
// natural way to obtain the pid is to read it out of `netstat` and pass it
// back in, and then the comparison is against itself and can never fail. So
// the owning process's own COMMAND LINE is read and required to name this
// `--dist`, which is a fact about the server rather than about the bookkeeping.
// `--pid=` is kept beside it because a pid the lane recorded when it STARTED
// the server is real evidence, and the two together catch both a restarted
// server and a differently-pointed one. A `vite preview` with no `--outDir`
// names no directory, so `--nooutdir=1` declares that case rather than letting
// a missing match read as a pass.
let owner = '';
try {
  const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
  for (const ln of out.split(/\r?\n/)) {
    const m = /\s+TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/.exec(ln);
    if (m && Number(m[1]) === port) { owner = m[2]; break; }
  }
} catch (e) { owner = `<netstat failed: ${e.message}>`; }
say(owner !== '' && (pid === '' || owner === pid), 'port owner',
  `port ${port} is owned by pid ${owner || '<none>'}`
  + (pid === '' ? ' (no --pid given, so this leg only proves the port is live)'
    : `, lane started ${pid}`));

const noOutDir = argv.get('--nooutdir') === '1';
let cmdline = '';
try {
  cmdline = execFileSync('powershell', ['-NoProfile', '-Command',
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${owner}").CommandLine`],
  { encoding: 'utf8' }).trim();
} catch (e) { cmdline = `<query failed: ${e.message}>`; }
const names = cmdline.toLowerCase().includes(dist.toLowerCase());
say(noOutDir ? !/--outdir/i.test(cmdline) : names, 'server points here',
  noOutDir
    ? `no --outDir on the owner's command line, so it serves its cwd's dist: `
      + `${cmdline.slice(0, 120)}`
    : (names ? `the owner's command line names ${dist}`
      : `the owner's command line does NOT name ${dist}: ${cmdline.slice(0, 200)}`));

for (const ln of lines) console.log(ln);
console.log(`\n${ok ? 'SENTINEL PASS' : 'SENTINEL FAIL'}  ${lines.length} check(s), `
  + `dist ${dist}`);
process.exit(ok ? 0 : 1);
