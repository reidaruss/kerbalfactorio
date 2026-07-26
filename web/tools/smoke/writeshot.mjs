// Decode a `png` data URL out of a run.mjs JSON report on stdin and write it.
//
//   node tools/smoke/run.mjs ... --evalfile=tools/smoke/probes/popshot.js \
//     | node tools/smoke/writeshot.mjs docs/screenshots/W3_pop_before.png
//
// This exists because run.mjs's --out screenshot is taken after settle(), which
// waits for the world to STOP changing and therefore can never photograph a
// transition. A probe that wants a mid-transition frame has to grab the canvas
// itself, in the same task as the render.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = process.argv[2];
if (!out) { console.error('writeshot: usage: writeshot.mjs <out.png>'); process.exit(2); }

let raw = '';
process.stdin.setEncoding('utf8');
for await (const c of process.stdin) raw += c;

let report;
try { report = JSON.parse(raw); } catch (e) {
  console.error('writeshot: stdin was not the JSON report'); process.exit(1);
}
const url = report?.eval?.png;
if (typeof url !== 'string' || !url.startsWith('data:image/png;base64,')) {
  console.error('writeshot: no eval.png data URL in the report'); process.exit(1);
}
const p = isAbsolute(out) ? out : resolve(repoRoot, out);
mkdirSync(dirname(p), { recursive: true });
writeFileSync(p, Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
const { png, ...rest } = report.eval;
console.error(`writeshot: wrote ${p}  ${JSON.stringify(rest)}`);
