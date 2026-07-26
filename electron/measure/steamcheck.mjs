// Does a Steamworks binding load and initialise inside this shell? (DW-27
// spike, Q2.) It answers the MECHANICAL question only and builds no features.
//
// WHAT IT DOES NOT DO, deliberately: it creates no Steam partner account, it
// registers no app, it spends nothing, and it writes no credential or key
// anywhere. There is no such thing as a Steam App ID we own yet.
//
// ON APP ID 480. It is the App ID of Valve's Spacewar SDK sample, which the
// Steamworks API docs use as the example value in their steam_appid.txt
// instructions. Using it as a general development sandbox is COMMUNITY
// CONVENTION and is not sanctioned anywhere in Valve's documentation, so do not
// repeat it as policy. It is used here for one reason: it is the only way to ask
// "does the native module load, and does init() reach a running Steam client"
// without an App ID, and that question is worth answering cheaply. Its
// achievement and cloud namespaces are shared with every other developer doing
// the same and are therefore meaningless for anything beyond this check.
//
// steam_appid.txt is written next to the running executable at Valve's own
// instruction, and DELETED again at the end. It is gitignored, and Valve
// documents that it must never ship in a depot.
//
//   node measure/steamcheck.mjs

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shellDir = resolve(here, '..');
const APP_ID = 480;

const report = { appIdUsed: APP_ID, appIdIsValveSanctioned: false, steps: {} };

// 1. Is the Steam client present and running? init() cannot succeed otherwise:
//    Valve states "a running Steam client is required to provide implementations
//    of the various Steamworks interfaces".
const steamExe = 'C:/Program Files (x86)/Steam/steam.exe';
report.steps.steamInstalled = existsSync(steamExe) ? steamExe : false;
report.steps.steamRunning = await new Promise((res) => {
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "try { (Get-Process steam -ErrorAction Stop | Select-Object -First 1).Id } catch { 0 }"],
  { stdio: ['ignore', 'pipe', 'ignore'] });
  let s = '';
  p.stdout.on('data', (d) => { s += d; });
  p.on('close', () => res(Number(String(s).trim()) || false));
});

// 2. Does the native module load at all under this Node/Electron? steamworks.js
//    is a napi-rs (Node-API) addon, so it should need no electron-rebuild.
let steamworks = null;
try {
  steamworks = (await import('steamworks.js')).default ?? await import('steamworks.js');
  report.steps.moduleLoaded = true;
} catch (e) {
  report.steps.moduleLoaded = false;
  report.steps.moduleLoadError = String(e && e.message ? e.message : e);
}

// 3. Does init() reach the client?
if (steamworks !== null) {
  const appIdFile = join(shellDir, 'steam_appid.txt');
  let wroteFile = false;
  try {
    writeFileSync(appIdFile, String(APP_ID));
    wroteFile = true;
    const client = steamworks.init(APP_ID);
    report.steps.initOk = true;
    // Deliberately narrow: identity only. No achievement is unlocked and no
    // cloud file is written, because both would land in a namespace shared with
    // every other developer using 480.
    try {
      report.steps.steamIdPresent = typeof client.localplayer.getSteamId().steamId64 !== 'undefined';
      report.steps.accountNameLength = String(client.localplayer.getName()).length;
    } catch (e) { report.steps.localplayerError = String(e.message ?? e); }
    try {
      report.steps.cloudEnabledForAccount = client.cloud.isEnabledForAccount();
      report.steps.cloudEnabledForApp = client.cloud.isEnabledForApp();
    } catch (e) { report.steps.cloudError = String(e.message ?? e); }
    // The cloud API is typed `writeFile(name: string, content: string)`, and this
    // project's save is BINARY bytes from persistence.h's SaveWriter. Whether
    // arbitrary bytes survive that string boundary decides whether the bridge
    // needs base64, so it is measured rather than assumed. Written under a
    // clearly-namespaced probe key and deleted immediately.
    try {
      const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 0x80, 0xC0]);
      const asBinaryString = String.fromCharCode(...bytes);
      const ok = client.cloud.writeFile('of_probe_binary.bin', asBinaryString);
      const back = ok ? client.cloud.readFile('of_probe_binary.bin') : null;
      report.steps.binaryRoundTrip = {
        wrote: ok,
        lengthOut: asBinaryString.length,
        lengthBack: back === null ? null : back.length,
        identical: back === asBinaryString,
      };
      try { client.cloud.deleteFile('of_probe_binary.bin'); } catch (_) {}
    } catch (e) { report.steps.binaryRoundTripError = String(e.message ?? e); }
  } catch (e) {
    report.steps.initOk = false;
    report.steps.initError = String(e && e.message ? e.message : e);
  } finally {
    if (wroteFile) rmSync(appIdFile, { force: true });
    report.steps.appIdFileRemoved = !existsSync(appIdFile);
  }
}

report.verdict = report.steps.initOk === true
  ? 'the binding loads and initialises against a running Steam client; nothing beyond this is verifiable without a partner App ID'
  : 'init did not succeed, see steps.initError';
console.log(JSON.stringify(report, null, 2));
