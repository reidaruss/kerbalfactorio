// Installed size of the packaged application (DW-27 spike, Q1).
//
// @electron/packager rather than electron-builder on purpose: this spike wants
// the INSTALLED footprint, which is the unpacked application directory, and
// packager produces exactly that with no installer format, no code signing and
// no NSIS toolchain to install. Turning this into a real Steam depot build is a
// separate job and is deliberately not started here.
//
//   node measure/pack.mjs
//
// Prints a size breakdown, because "310 MB" is not actionable and "270 MB of it
// is Chromium and 7.7 MB is our game" is.

import packager from '@electron/packager';
import { readdirSync, statSync, existsSync, cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shellDir = resolve(here, '..');
const repoRoot = resolve(shellDir, '..');
const webDist = resolve(repoRoot, 'web', 'dist');
const stage = resolve(shellDir, 'out', 'stage');

if (!existsSync(webDist)) {
  process.stderr.write('pack: web/dist is missing. Run `npm --prefix ../web run build` first.\n');
  process.exit(2);
}

function dirBytes(p) {
  let total = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) total += statSync(f).size;
    }
  };
  walk(p);
  return total;
}
const MB = (b) => +(b / 1048576).toFixed(1);

// Stage exactly what ships: main.mjs, the custom-protocol server, and the built
// client. Not node_modules (electron itself is provided by the packager) and not
// the measurement scripts.
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(resolve(shellDir, 'main.mjs'), join(stage, 'main.mjs'));
cpSync(resolve(shellDir, 'shell'), join(stage, 'shell'), { recursive: true });
cpSync(webDist, join(stage, 'web', 'dist'), { recursive: true });
// A packaged app resolves web/dist relative to the app root rather than to the
// repo, so the staged manifest points main.mjs at the staged copy.
const { writeFileSync } = await import('node:fs');
writeFileSync(join(stage, 'package.json'), JSON.stringify({
  name: 'orbital-foundry', productName: 'Orbital Foundry', version: '0.1.0',
  main: 'main.mjs', type: 'module', private: true,
}, null, 2));

const t0 = Date.now();
const [appPath] = await packager({
  dir: stage,
  out: resolve(shellDir, 'out'),
  platform: 'win32',
  arch: 'x64',
  overwrite: true,
  prune: false,
  asar: true,
  appVersion: '0.1.0',
  name: 'OrbitalFoundry',
});
const packMs = Date.now() - t0;

const parts = {};
for (const e of readdirSync(appPath, { withFileTypes: true })) {
  const p = join(appPath, e.name);
  parts[e.name] = e.isDirectory() ? MB(dirBytes(p)) : MB(statSync(p).size);
}
const total = dirBytes(appPath);
const gameBytes = dirBytes(stage);

console.log(JSON.stringify({
  appPath,
  packSeconds: +(packMs / 1000).toFixed(1),
  installedSizeMB: MB(total),
  ourPayloadMB: MB(gameBytes),
  chromiumAndRuntimeMB: MB(total - gameBytes),
  webDistMB: MB(dirBytes(webDist)),
  largestEntries: Object.fromEntries(
    Object.entries(parts).sort((a, b) => b[1] - a[1]).slice(0, 12)),
  note: 'unpacked application directory, i.e. what a Steam depot would hold. '
      + 'No installer, no code signing, no delta compression.',
}, null, 2));
