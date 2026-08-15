// GATE AUDIT (BT-40). Runs every probe that documents its own invocation and
// records what a runner that HONOURED `fails[]` and `valid` would have said.
//
// It does NOT patch run.mjs. run.mjs already prints the probe's return value as
// `report.eval`; this reads it and applies the verdict the runner throws away.
// That keeps the two signals separate, which is the whole question:
//   - exit code  -> what the runner sees today (console errors / requests / crash)
//   - eval       -> what the probe actually claimed
//
//   node probeall.mjs --url=http://127.0.0.1:4262/ --tree=<isolated tree>
//
// Resumable: one JSON line per probe appended to results.jsonl as it finishes.

import { readFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
const url = args.get('url') ?? 'http://127.0.0.1:4262/';
const tree = resolve(args.get('tree') ?? join(here, 'tree'));
const only = args.get('only');           // comma list of probe basenames
const limit = Number(args.get('limit') ?? 0);
const timeoutMs = Number(args.get('timeout') ?? 240000);
const outFile = args.get('results') ?? join(here, 'results.jsonl');
// Sharding exists to get the CENSUS quickly. It costs measurement quality:
// several probes assert frame time or draw cost, and INSTRUMENTS.md is explicit
// that timings are worthless while other work runs on the machine. Contention
// makes a probe FAIL, not pass, so a GREEN under a shard is trustworthy and a
// RED is not. Every red from a sharded sweep is re-run serially before it goes
// on the list.
const shard = Number(args.get('shard') ?? 0);
const shards = Number(args.get('shards') ?? 1);

const probeDir = join(tree, 'web', 'tools', 'smoke', 'probes');
const runner = join(tree, 'web', 'tools', 'smoke', 'run.mjs');
const webDir = join(tree, 'web');

// ---- BT-115 to BT-129: the extractCmd-null audit ---------------------------
// CE-86 found that a probe documenting no invocation returns `null` from
// extractCmd and drops SILENTLY into NO_DOCUMENTED_CMD, off by default, so
// "not on the red list" and "green" were different claims for 91 probes with
// no way to tell which from this file's own output. Two of those 91 are not
// oversights: a HELPER/FIXTURE that is genuinely not meant to run standalone
// through THIS runner (a two-phase setup probe driven by reload.mjs or
// twobody.mjs, for instance) will never carry a `run.mjs` line and should not
// be made to invent one. The fix is not to force an invocation onto every
// file; it is to make "excluded on purpose" a DIFFERENT, visible verdict from
// "nobody wrote a line yet". A probe is EXCLUDED when its header carries
//   // PROBEALL-EXCLUDE: <reason>
// anywhere in its first 60 lines. That census bucket is checked before
// extractCmd runs at all, and an excluded probe is skipped even under
// --nodocs, because running it at the runner's defaults would not be running
// the thing it was written to do either.
function excludedReason(src) {
  const lines = src.split(/\r?\n/).slice(0, 60);
  for (const l of lines) {
    const m = /^\s*\/\/\s*PROBEALL-EXCLUDE:\s*(.+?)\s*$/.exec(l);
    if (m) return m[1];
  }
  return null;
}

// ---- extract the documented invocation from the header comment -------------
// The command sits in a `//` block, one flag per token, with `\` continuations.
function extractCmd(src) {
  const lines = src.split(/\r?\n/);
  let i = lines.findIndex((l) => /^\s*\/\/.*run\.mjs/.test(l));
  if (i === -1) return null;
  const parts = [];
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!/^\s*\/\//.test(l)) break;
    const body = l.replace(/^\s*\/\/\s?/, '');
    parts.push(body.replace(/\\\s*$/, ''));
    if (!/\\\s*$/.test(body)) break;
  }
  return parts.join(' ');
}

const PLACEHOLDER = /^(\.\.\.|<.*>|\$.*|\.\.\.\.)$/;

function flagsOf(cmd) {
  const out = [];
  const bad = [];
  for (const tok of cmd.split(/\s+/)) {
    const m = /^--([A-Za-z0-9_-]+)(?:=(.*))?$/.exec(tok);
    if (!m) continue;
    const [, k, v0] = m;
    if (k === 'url' || k === 'out' || k === 'evalfile') continue;
    // The documented command is written for a SHELL, so `--evalargs='{"a":1}'`
    // carries the shell's own quotes. spawn() without a shell passes them
    // through, run.mjs substitutes them into the probe wrapper, and OF_ARGS
    // arrives as a STRING instead of an object: every OF_ARGS.foo reads
    // undefined and the probe measures the default while the record says it
    // measured the request. That is run.mjs's own dropped-flag failure one
    // layer out, so strip one matching pair of quotes.
    const v = v0 !== undefined ? v0.replace(/^(['"])([\s\S]*)\1$/, '$2') : v0;
    if (v !== undefined && PLACEHOLDER.test(v)) { bad.push(k); continue; }
    out.push(v === undefined ? `--${k}` : `--${k}=${v}`);
  }
  return { flags: out, bad };
}

// ---- verdict ---------------------------------------------------------------
// What a gate that honoured the probe's own report would say.
// THERE ARE FOUR VERDICT CONVENTIONS, NOT TWO. `valid` and `fails[]` are the
// common pair, but seven probes carry only a boolean `ok` (animgate, padflat,
// zerog, ...) and some carry `pass`. A census that knew only two names would
// have filed those under NO_VERDICT and missed any red among them, which is the
// audit committing the defect it is auditing. The runtime `evalKeys` recorded
// below is what makes that claim checkable rather than asserted.
function verdictOf(ev) {
  if (ev === undefined || ev === null || typeof ev !== 'object') return { cls: 'NO_VERDICT', fails: [] };
  const hasFails = Array.isArray(ev.fails);
  const bools = ['valid', 'ok', 'pass'].filter((k) => typeof ev[k] === 'boolean');
  if (!hasFails && bools.length === 0) return { cls: 'NO_VERDICT', fails: [] };
  const fails = hasFails ? ev.fails.map(String) : [];
  const falseOnes = bools.filter((k) => ev[k] !== true);
  if (fails.length > 0 || falseOnes.length > 0) {
    return {
      cls: 'RED',
      fails: [...fails, ...falseOnes.map((k) => `${k}: false${ev.why ? ` (why: ${ev.why})` : ''}`)],
    };
  }
  return { cls: 'GREEN', fails: [] };
}

function run(cmd, argv, cwd) {
  return new Promise((res) => {
    const t0 = Date.now();
    // NOT shell:true. process.execPath is "C:\Program Files\nodejs\node.exe" and
    // cmd.exe splits it at the space, so every run died before the browser with
    // "'C:\Program' is not recognized" and the harness recorded NO_OUTPUT for a
    // probe it had never actually started. A harness bug that reports a uniform
    // verdict is exactly the class this audit exists to find.
    const p = spawn(cmd, argv, { cwd, shell: false });
    let so = '', se = '';
    const cap = 400000;
    p.stdout.on('data', (d) => { if (so.length < cap) so += d; });
    p.stderr.on('data', (d) => { if (se.length < cap) se += d; });
    const timer = setTimeout(() => { p.kill('SIGKILL'); res({ code: null, so, se, ms: Date.now() - t0, timedOut: true }); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); res({ code, so, se, ms: Date.now() - t0, timedOut: false }); });
    p.on('error', (e) => { clearTimeout(timer); res({ code: -1, so, se: se + String(e), ms: Date.now() - t0, timedOut: false }); });
  });
}

const done = new Set();
if (existsSync(outFile)) {
  for (const l of readFileSync(outFile, 'utf8').split(/\r?\n/)) {
    if (!l.trim()) continue;
    try { done.add(JSON.parse(l).probe); } catch { /* partial line */ }
  }
}

let files = readdirSync(probeDir).filter((f) => f.endsWith('.js')).sort();
if (only) { const set = new Set(only.split(',')); files = files.filter((f) => set.has(f) || set.has(f.replace(/\.js$/, ''))); }

const queue = [];
let idx = -1;
for (const f of files) {
  if (done.has(f)) continue;
  const src = readFileSync(join(probeDir, f), 'utf8');
  const excluded = excludedReason(src);
  if (excluded) {
    if (shard === 0) appendFileSync(outFile, JSON.stringify({ probe: f, cls: 'EXCLUDED', reason: excluded }) + '\n');
    continue;
  }
  const cmd = extractCmd(src);
  if (!cmd) {
    // --nodocs runs the probes that document NO invocation, at the runner's
    // defaults. Their verdicts are reported in their own bucket and are weaker
    // evidence than the documented set: R8 says the scene is part of the
    // measurement, so a red here may only mean the probe was shown the wrong
    // world. A GREEN at defaults is still worth having; a RED is a question.
    if (!args.has('nodocs')) {
      if (shard === 0) appendFileSync(outFile, JSON.stringify({ probe: f, cls: 'NO_DOCUMENTED_CMD' }) + '\n');
      continue;
    }
    idx++;
    if (shards > 1 && idx % shards !== shard) continue;
    queue.push({ f, flags: [], bad: [], cmd: '(defaults; probe documents no invocation)', defaults: true });
    continue;
  }
  if (args.has('nodocs')) continue;
  idx++;
  if (shards > 1 && idx % shards !== shard) continue;
  const { flags, bad } = flagsOf(cmd);
  queue.push({ f, flags, bad, cmd });
}

console.error(`probeall: ${queue.length} to run (${done.size} already recorded)`);
let n = 0;
for (const q of queue) {
  if (limit && n >= limit) break;
  n++;
  const argv = [runner, `--url=${url}`, ...q.flags, `--evalfile=${join(probeDir, q.f)}`];
  const r = await run(process.execPath, argv, webDir);
  let report = null, parseErr = null;
  try { report = JSON.parse(r.so); } catch (e) { parseErr = String(e.message).slice(0, 200); }
  const v = report ? verdictOf(report.eval) : { cls: 'NO_OUTPUT', fails: [] };
  const runnerFails = (r.se.match(/^ {2}(console\.error|pageerror|requestfailed|runner|console\.warn):.*/gm) ?? []).slice(0, 6);
  const rec = {
    probe: q.f,
    exit: r.code,
    timedOut: r.timedOut,
    ms: r.ms,
    runnerSaysPass: /smoke: PASS/.test(r.se),
    verdict: v.cls,
    evalKeys: report && report.eval && typeof report.eval === 'object' ? Object.keys(report.eval).slice(0, 30) : null,
    failCount: v.fails.length,
    fails: v.fails.slice(0, 12),
    runnerFails,
    flags: q.flags,
    atDefaults: q.defaults === true,
    parseErr,
    stderrTail: r.se.slice(-600),
  };
  appendFileSync(outFile, JSON.stringify(rec) + '\n');
  console.error(`[${n}/${queue.length}] ${q.f} exit=${r.code} runner=${rec.runnerSaysPass ? 'PASS' : 'FAIL'} verdict=${v.cls}${v.fails.length ? ` (${v.fails.length})` : ''} ${Math.round(r.ms / 1000)}s`);
}
console.error('probeall: done');
