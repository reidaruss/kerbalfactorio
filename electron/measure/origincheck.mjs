// Does the client survive the origin change? (DW-27 spike, question 1.)
//
// Loads the SAME capability page twice in the SAME shell binary, once over
// file:// and once over the shell's privileged of:// scheme, and prints the two
// answers side by side. Nothing here is an opinion about what file:// ought to
// do.
//
//   node measure/origincheck.mjs

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shellDir = resolve(here, '..');
const electronBin = resolve(shellDir, 'node_modules', 'electron', 'dist', 'electron.exe');

function runOnce(origin) {
  return new Promise((res) => {
    const child = spawn(electronBin, ['.', '--page=origincheck', `--origin=${origin}`, '--offscreen', '--width=640', '--height=480'], {
      cwd: shellDir, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      try { child.stdin.write('quit\n'); } catch (_) {}
      setTimeout(() => { try { child.kill(); } catch (_) {} }, 400);
      res(payload);
    };
    const onLine = (line) => {
      const i = line.indexOf('OF_ORIGINCHECK ');
      if (i >= 0) { try { finish(JSON.parse(line.slice(i + 15))); } catch (e) { finish({ parseError: String(e), line }); } }
      const f = line.indexOf('"ev":"fail-load"');
      if (f >= 0) finish({ failLoad: line.trim() });
    };
    child.stdout.on('data', (d) => {
      buf += d; const parts = buf.split('\n'); buf = parts.pop() ?? '';
      for (const p of parts) { process.stderr.write(`[${origin}] ${p}\n`); onLine(p); }
    });
    child.stderr.on('data', (d) => process.stderr.write(`[${origin}:err] ${d}`));
    child.on('exit', (code) => finish({ exited: code, note: 'process exited before reporting' }));
    setTimeout(() => finish({ timeout: true }), 45000);
  });
}

const file = await runOnce('file');
const proto = await runOnce('protocol');

const verdict = (r, k) => {
  const v = r?.[k];
  if (v === undefined || v === null) return 'n/a';
  if (typeof v !== 'object') return String(v);
  return v.ok === true ? `OK ${JSON.stringify(v.value)}` : `FAIL ${v.error}`;
};

const keys = ['origin', 'protocol', 'isSecureContext', 'crossOriginIsolated', 'hasSharedArrayBuffer',
  'hasCryptoSubtle', 'indexedDB', 'moduleWorker', 'wasmStreaming', 'localStorage', 'webgl2'];

console.log(JSON.stringify({ file, protocol: proto }, null, 2));
console.log('\n=== capability matrix ===');
for (const k of keys) console.log(`${k.padEnd(20)} file://=${String(verdict(file, k)).slice(0, 90).padEnd(92)} of://=${String(verdict(proto, k)).slice(0, 90)}`);
